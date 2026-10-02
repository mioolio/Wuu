import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const source = {
  likes:[{ path:'D:\\music\\one.mp3',ts:123 }], dislikes:[{path:'D:\\music\\two.mp3',ts:456}],
  collections:[{id:'saved',name:'我的歌单',songs:['D:\\music\\one.mp3'],createdAt:10}],
  stats:{'D:\\music\\one.mp3':{plays:9,duration:99}}, progress:{'D:\\music\\one.mp3':32},
  actualDuration:{'D:\\music\\one.mp3':120},lastSession:{audioPath:'D:\\music\\one.mp3',t:32},
  settings:{volume:1.25,audioFx:{preset:'vocal',eq:[1,2,3],customs:[{name:'我的音效'}]},mobileEnabled:true},
};
const songs = [{audioPath:'D:\\music\\one.mp3',songName:'第一首',artist:'歌手'},{audioPath:'D:\\music\\two.mp3',songName:'第二首',artist:'歌手'}];
let saved: ReturnType<typeof vi.fn>;
let metadataListener: (payload: unknown) => void;
function deferred<T>() {
  let resolve!: (value: T) => void, reject!: (error: Error) => void;
  const promise = new Promise<T>((done, fail) => { resolve = done; reject = fail; });
  return { promise, resolve, reject };
}
const flush = async () => { await Promise.resolve(); await Promise.resolve(); await Promise.resolve(); };

beforeEach(() => {
  vi.resetModules(); vi.useFakeTimers();
  const storage = new Map<string,string>();
  vi.stubGlobal('localStorage',{getItem:(key:string) => storage.get(key) || null,setItem:(key:string,value:string) => storage.set(key,value),removeItem:(key:string)=>storage.delete(key)});
  saved=vi.fn().mockResolvedValue(undefined);
  vi.stubGlobal('window',{musicAPI:{getSongs:vi.fn().mockResolvedValue(songs),getUserData:vi.fn().mockResolvedValue(structuredClone(source)),saveUserData:saved,saveUserDataSync:saved,
    onSongMetadataUpdate:vi.fn(listener=>{metadataListener=listener;return ()=>{};})}});
});

describe('启动、刷新和后台元数据', () => {
  it('歌曲和用户数据即时返回时只发布完整状态，不先显示默认偏好下的半初始化歌库', async () => {
    const {useAppStore}=await import('./store');
    const snapshots: {hydrated:boolean;loading:boolean;volume:number}[]=[];
    const unsubscribe=useAppStore.subscribe((state,previous)=>{
      if(state.songs!==previous.songs && state.songs.length) snapshots.push({hydrated:state.hydrated,loading:state.loading,volume:state.settings.volume});
    });
    await useAppStore.getState().initialize();
    expect(vi.mocked(window.musicAPI.getUserData).mock.invocationCallOrder[0]).toBeLessThan(vi.mocked(window.musicAPI.getSongs).mock.invocationCallOrder[0]);
    expect(snapshots).toEqual([{hydrated:true,loading:false,volume:source.settings.volume}]);
    expect(useAppStore.getState()).toMatchObject({songs,collections:source.collections,lastSession:source.lastSession,hydrated:true});
    unsubscribe();
  });
  it('用户数据先返回、歌曲稍后到达时仍一次合并，并保留等待期间的用户操作', async () => {
    const pendingSongs=deferred<typeof songs>();
    window.musicAPI.getSongs=vi.fn().mockReturnValue(pendingSongs.promise);
    const {useAppStore,serializeUserData}=await import('./store');
    const snapshots: boolean[]=[];
    const unsubscribe=useAppStore.subscribe((state,previous)=>{
      if(state.songs!==previous.songs && state.songs.length) snapshots.push(state.hydrated);
    });
    const initializing=useAppStore.getState().initialize(); await flush();
    expect(useAppStore.getState()).toMatchObject({songs:[],loading:true,hydrated:false});
    useAppStore.getState().setSettings({volume:.4});
    pendingSongs.resolve(songs); await initializing;
    expect(snapshots).toEqual([true]);
    expect(serializeUserData()).toMatchObject({settings:{volume:.4,mobileEnabled:true},collections:source.collections,lastSession:source.lastSession});
    unsubscribe();
  });
  it('基础列表先显示，完整用户数据晚到后合并早期设置、歌单、曲风、播放记录与删除', async () => {
    const userData=deferred<typeof source>();
    window.musicAPI.getUserData=vi.fn().mockReturnValue(userData.promise);
    const {useAppStore,applyUserDataChange,persistNow,serializeUserData}=await import('./store');
    const initializing=useAppStore.getState().initialize(); await flush();
    expect(useAppStore.getState()).toMatchObject({songs,loading:false,hydrated:false});
    useAppStore.getState().setSettings({volume:.4,currentLyricSize:42});
    const id=useAppStore.getState().createCollection('启动时的歌单');
    useAppStore.getState().setCollectionSong(id,songs[0].audioPath,true);
    useAppStore.getState().renameCollection(id,'早期操作已保存');
    useAppStore.getState().toggleLike(songs[0].audioPath);
    useAppStore.getState().setSongGenres(songs[0].audioPath,[' Jazz ']);
    applyUserDataChange(state=>({stats:{...state.stats,[songs[0].audioPath]:{...state.stats[songs[0].audioPath],plays:(state.stats[songs[0].audioPath]?.plays||0)+1,duration:state.stats[songs[0].audioPath]?.duration||0}},progress:{...state.progress,[songs[0].audioPath]:42},lastSession:{audioPath:songs[0].audioPath,t:42}}));
    useAppStore.getState().removeSong(songs[1].audioPath);
    await vi.advanceTimersByTimeAsync(700); expect(saved).not.toHaveBeenCalled();
    userData.resolve(structuredClone(source)); await initializing;
    const data=serializeUserData();
    expect(data.settings).toMatchObject({volume:.4,currentLyricSize:42,mobileEnabled:true});
    expect(data.settings.audioFx).toEqual(source.settings.audioFx);
    expect(data.collections).toContainEqual(source.collections[0]);
    expect(data.collections.find(collection=>collection.id===id)).toMatchObject({name:'早期操作已保存',songs:[songs[0].audioPath]});
    expect(data.stats[songs[0].audioPath]).toEqual({plays:10,duration:99});
    expect(data.progress[songs[0].audioPath]).toBe(42);
    expect(data.genreOverrides[songs[0].audioPath]).toEqual(['Jazz']);
    expect(useAppStore.getState().songs).toEqual([songs[0]]);
    expect(data.dislikes).toEqual([]); expect(data.lastSession).toEqual({audioPath:songs[0].audioPath,t:42});
    expect(useAppStore.getState().hydrated).toBe(true);
    await vi.advanceTimersByTimeAsync(500); expect(saved).toHaveBeenCalled();
    await persistNow();
  });
  it('失败重试只重放一次早期增量，不写盘、不丢原数据或未知字段', async () => {
    const failing=deferred<unknown>();
    window.musicAPI.getUserData=vi.fn().mockReturnValueOnce(failing.promise).mockResolvedValue({...source,unknownPreference:{preserved:true}});
    const {useAppStore,applyUserDataChange,persistNow,serializeUserData}=await import('./store');
    const first=useAppStore.getState().initialize(); await flush();
    applyUserDataChange(state=>({stats:{...state.stats,[songs[0].audioPath]:{plays:(state.stats[songs[0].audioPath]?.plays||0)+1,duration:state.stats[songs[0].audioPath]?.duration||0}}}));
    failing.reject(new Error('用户数据暂时不可读')); await first;
    persistNow(true); expect(saved).not.toHaveBeenCalled(); expect(useAppStore.getState().hydrated).toBe(false);
    await useAppStore.getState().initialize();
    expect(serializeUserData().stats[songs[0].audioPath].plays).toBe(10);
    expect(serializeUserData()).toMatchObject({unknownPreference:{preserved:true}});
    await useAppStore.getState().initialize(); expect(serializeUserData().stats[songs[0].audioPath].plays).toBe(10);
  });
  it('同步元数据订阅首次抛错后清理失败任务，下一次初始化可以真正重试', async () => {
    window.musicAPI.onSongMetadataUpdate=vi.fn()
      .mockImplementationOnce(()=>{throw new Error('订阅暂时不可用');})
      .mockImplementation(listener=>{metadataListener=listener;return ()=>{};});
    const {useAppStore,persistNow}=await import('./store');
    await useAppStore.getState().initialize();
    expect(useAppStore.getState()).toMatchObject({songs:[],loading:false,hydrated:false,error:'订阅暂时不可用'});
    expect(window.musicAPI.getSongs).not.toHaveBeenCalled();
    persistNow(true); expect(saved).not.toHaveBeenCalled();
    await useAppStore.getState().initialize();
    expect(useAppStore.getState()).toMatchObject({songs,loading:false,hydrated:true,error:''});
    expect(window.musicAPI.onSongMetadataUpdate).toHaveBeenCalledTimes(2);
    expect(window.musicAPI.getUserData).toHaveBeenCalledTimes(1);
    expect(window.musicAPI.getSongs).toHaveBeenCalledTimes(1);
  });
  it('元数据订阅早于首个请求，增量能越过初始化和刷新快照，手工标签始终保留', async () => {
    const initial=deferred<typeof songs>(), refresh=deferred<typeof songs>();
    window.musicAPI.getSongs=vi.fn().mockImplementationOnce(()=>{metadataListener({audioPath:songs[0].audioPath,genre:[' Pop ','Pop']});return initial.promise;}).mockReturnValueOnce(refresh.promise);
    window.musicAPI.getUserData=vi.fn().mockResolvedValue({...source,genreOverrides:{[songs[0].audioPath]:['Jazz']}});
    const {useAppStore}=await import('./store');
    const initializing=useAppStore.getState().initialize(); await flush();
    initial.resolve(songs); await initializing;
    expect(useAppStore.getState().songs[0].genre).toEqual(['Pop']);
    useAppStore.getState().setPlayer({song:useAppStore.getState().songs[0],index:0,playing:true,time:42,lyricText:'原歌词'});
    const reloading=useAppStore.getState().reloadSongs();
    metadataListener({audioPath:songs[0].audioPath,genre:['Rock']}); refresh.resolve(songs); await reloading;
    expect(useAppStore.getState().songs[0].genre).toEqual(['Rock']);
    expect(useAppStore.getState().player).toMatchObject({song:{genre:['Rock']},playing:true,time:42,lyricText:'原歌词'});
    expect(useAppStore.getState().genreOverrides[songs[0].audioPath]).toEqual(['Jazz']);
    metadataListener({audioPath:'missing.mp3',genre:['Jazz']}); metadataListener({audioPath:songs[0].audioPath,genre:'bad'});
    await vi.advanceTimersByTimeAsync(50);
    expect(useAppStore.getState().songs).toHaveLength(2);
    expect(useAppStore.getState().songs[0].genre).toEqual(['Rock']);
    expect(window.musicAPI.onSongMetadataUpdate).toHaveBeenCalledTimes(1);
  });
  it('较早刷新不能覆盖较新列表，也不能让刚删除的歌曲重新出现', async () => {
    const {useAppStore}=await import('./store'); await useAppStore.getState().initialize();
    const older=deferred<typeof songs>(), newer=deferred<typeof songs>();
    window.musicAPI.getSongs=vi.fn().mockReturnValueOnce(older.promise).mockReturnValueOnce(newer.promise);
    const first=useAppStore.getState().reloadSongs(), second=useAppStore.getState().reloadSongs();
    newer.resolve([songs[1]]); await second; older.resolve(songs); await first;
    expect(useAppStore.getState().songs).toEqual([songs[1]]);
    const deletion=deferred<typeof songs>(); window.musicAPI.getSongs=vi.fn().mockReturnValue(deletion.promise);
    const pending=useAppStore.getState().reloadSongs(); useAppStore.getState().removeSong(songs[1].audioPath);
    deletion.resolve(songs); await pending;
    expect(useAppStore.getState().songs).toEqual([]);
    metadataListener({audioPath:songs[1].audioPath,genre:['Pop']}); await vi.advanceTimersByTimeAsync(50); expect(useAppStore.getState().songs).toEqual([]);
  });
  it('失败尝试的歌曲迟到不会发布或结束新一次读取的loading', async () => {
    const oldSongs=deferred<typeof songs>(), nextSongs=deferred<typeof songs>();
    window.musicAPI.getSongs=vi.fn().mockReturnValueOnce(oldSongs.promise).mockReturnValueOnce(nextSongs.promise);
    window.musicAPI.getUserData=vi.fn().mockRejectedValueOnce(new Error('首次数据读取失败')).mockResolvedValue(source);
    const {useAppStore}=await import('./store');
    await useAppStore.getState().initialize();
    const retry=useAppStore.getState().initialize(); await flush();
    oldSongs.resolve([songs[0]]); await flush();
    expect(useAppStore.getState()).toMatchObject({songs:[],loading:true,hydrated:false,error:''});
    nextSongs.resolve([songs[1]]); await retry;
    expect(useAppStore.getState()).toMatchObject({songs:[songs[1]],loading:false,hydrated:true});
  });
  it('连续100条元数据按短批次只更新一次列表，保留无变化对象、手工曲风和播放', async () => {
    const {useAppStore}=await import('./store'); await useAppStore.getState().initialize();
    const untouched={audioPath:'untouched.mp3',songName:'不变的歌曲',artist:'歌手',genre:['Pop']};
    useAppStore.setState({songs:[...songs,untouched],genreOverrides:{[songs[0].audioPath]:['Jazz']},player:{...useAppStore.getState().player,song:songs[0],index:0,playing:true,time:42,lyricText:'原歌词'}});
    const updates=vi.fn(); const unsubscribe=useAppStore.subscribe((state,previous)=>{if(state.songs!==previous.songs)updates();});
    for(let index=0;index<50;index++) {
      metadataListener({audioPath:songs[0].audioPath,genre:['Rock',String(index)]});
      metadataListener({audioPath:songs[1].audioPath,genre:['Folk',String(index)]});
    }
    await vi.advanceTimersByTimeAsync(49); expect(updates).not.toHaveBeenCalled();
    await vi.advanceTimersByTimeAsync(1); expect(updates).toHaveBeenCalledTimes(1);
    expect(useAppStore.getState().songs.map(song=>song.genre)).toEqual([['Rock','49'],['Folk','49'],['Pop']]);
    expect(useAppStore.getState().songs[2]).toBe(untouched);
    expect(useAppStore.getState().player).toMatchObject({song:{genre:['Rock','49']},playing:true,time:42,lyricText:'原歌词'});
    expect(useAppStore.getState().genreOverrides[songs[0].audioPath]).toEqual(['Jazz']);
    const after=useAppStore.getState();
    metadataListener({audioPath:songs[0].audioPath,genre:['Rock','49']}); await vi.advanceTimersByTimeAsync(50);
    expect(useAppStore.getState()).toBe(after); expect(updates).toHaveBeenCalledTimes(1);
    unsubscribe();
  });
  it('批次等待期间删除不回插，解绑取消定时批次并拒绝陈旧事件', async () => {
    const {useAppStore,disposeSongMetadata}=await import('./store'); await useAppStore.getState().initialize();
    metadataListener({audioPath:songs[0].audioPath,genre:['Rock']});
    useAppStore.getState().removeSong(songs[0].audioPath); await vi.advanceTimersByTimeAsync(50);
    expect(useAppStore.getState().songs).toEqual([songs[1]]);
    metadataListener({audioPath:songs[1].audioPath,genre:['Jazz']}); disposeSongMetadata();
    const before=useAppStore.getState(); await vi.advanceTimersByTimeAsync(50);
    metadataListener({audioPath:songs[1].audioPath,genre:['Rock']}); await vi.advanceTimersByTimeAsync(50);
    expect(useAppStore.getState()).toBe(before); expect(useAppStore.getState().songs[0]).toBe(songs[1]);
  });
  it('保留store的解绑后重新初始化只重装一份订阅，旧批次不会漏入新生命周期', async () => {
    const {useAppStore,disposeSongMetadata}=await import('./store'); await useAppStore.getState().initialize();
    const oldListener=metadataListener;
    metadataListener({audioPath:songs[0].audioPath,genre:['Rock']}); disposeSongMetadata();
    const before=useAppStore.getState(); await vi.advanceTimersByTimeAsync(50); expect(useAppStore.getState()).toBe(before);
    await useAppStore.getState().initialize(); await useAppStore.getState().initialize();
    expect(window.musicAPI.onSongMetadataUpdate).toHaveBeenCalledTimes(2);
    expect(window.musicAPI.getSongs).toHaveBeenCalledTimes(1);
    oldListener({audioPath:songs[0].audioPath,genre:['Old']}); await vi.advanceTimersByTimeAsync(50);
    expect(useAppStore.getState()).toBe(before);
    metadataListener({audioPath:songs[0].audioPath,genre:['Jazz']}); await vi.advanceTimersByTimeAsync(50);
    expect(useAppStore.getState().songs[0].genre).toEqual(['Jazz']);
  });
});
afterEach(() => { vi.clearAllTimers(); vi.useRealTimers(); vi.unstubAllGlobals(); });

describe('现有用户数据迁移',() => {
  it.each([{lyricSize:20,current:25},{lyricSize:24,current:30},{lyricSize:36,current:45}])('旧普通字号 $lyricSize 迁移原当前行比例，不修改普通字号',async ({lyricSize,current}) => {
    window.musicAPI.getUserData=vi.fn().mockResolvedValue({...source,settings:{...source.settings,lyricSize}});
    const {useAppStore,serializeUserData}=await import('./store');
    await useAppStore.getState().initialize();
    expect(useAppStore.getState().settings).toMatchObject({lyricSize,currentLyricSize:current});
    expect(serializeUserData().collections).toEqual(source.collections);
    expect(serializeUserData().settings.audioFx).toEqual(source.settings.audioFx);
  });
  it('新用户当前字号默认28，已保存的独立当前字号不再按普通字号重算',async () => {
    window.musicAPI.getUserData=vi.fn().mockResolvedValue({});
    const {useAppStore,defaultSettings}=await import('./store');
    await useAppStore.getState().initialize();
    expect(useAppStore.getState().settings).toMatchObject({lyricSize:20,currentLyricSize:28});
    expect(defaultSettings.currentLyricSize).toBe(28);
  });
  it.each([{currentLyricSize:42,expected:42},{currentLyricSize:5,expected:24},{currentLyricSize:100,expected:60},{currentLyricSize:NaN,expected:30}])('加载独立当前字号时修复越界或损坏值 %#',async ({currentLyricSize,expected}) => {
    window.musicAPI.getUserData=vi.fn().mockResolvedValue({...source,settings:{...source.settings,lyricSize:24,currentLyricSize}});
    const {useAppStore}=await import('./store');
    await useAppStore.getState().initialize();
    expect(useAppStore.getState().settings).toMatchObject({lyricSize:24,currentLyricSize:expected});
  });
  it('当前字号即时独立保存；普通字号只在超出当前字号时抬高下限，降低后不重算',async () => {
    const {useAppStore,persistNow}=await import('./store');
    await useAppStore.getState().initialize();
    useAppStore.getState().setPlayer({song:songs[0],playing:true,time:42});
    const player=useAppStore.getState().player;
    useAppStore.getState().setSettings({currentLyricSize:42});
    expect(useAppStore.getState().settings).toMatchObject({lyricSize:20,currentLyricSize:42});
    useAppStore.getState().setSettings({lyricSize:30});
    expect(useAppStore.getState().settings.currentLyricSize).toBe(42);
    useAppStore.getState().setSettings({currentLyricSize:32});
    useAppStore.getState().setSettings({lyricSize:36});
    expect(useAppStore.getState().settings.currentLyricSize).toBe(36);
    useAppStore.getState().setSettings({lyricSize:20});
    expect(useAppStore.getState().settings.currentLyricSize).toBe(36);
    expect(useAppStore.getState().player).toBe(player);
    await persistNow();
    expect(saved.mock.calls.at(-1)?.[0].settings).toMatchObject({lyricSize:20,currentLyricSize:36});
    expect(saved.mock.calls.at(-1)?.[0].collections).toEqual(source.collections);
  });
  it('旧用户默认收起侧栏，宽度和展开偏好保存时不改动歌曲与播放',async () => {
    const {useAppStore,persistNow}=await import('./store');
    await useAppStore.getState().initialize();
    expect(useAppStore.getState().settings.sidebarCollapsed).toBe(true);
    expect(useAppStore.getState().settings.sidebarWidth).toBe(184);
    useAppStore.getState().setPlayer({song:songs[0],playing:true,time:42});
    const player=useAppStore.getState().player;
    useAppStore.getState().setSettings({sidebarCollapsed:false,sidebarWidth:232});
    await persistNow();
    expect(useAppStore.getState().player).toBe(player);
    expect(useAppStore.getState().songs).toEqual(songs);
    expect(saved.mock.calls.at(-1)?.[0].settings).toMatchObject({sidebarCollapsed:false,sidebarWidth:232,volume:1.25});
  });
  it('加载已保存的侧栏宽度与展开状态，保留原透明度和颜色强度',async () => {
    window.musicAPI.getUserData=vi.fn().mockResolvedValue({...source,settings:{...source.settings,sidebarCollapsed:false,sidebarWidth:207.6,glassOpacity:.3,colorIntensity:.95}});
    const {useAppStore}=await import('./store');
    await useAppStore.getState().initialize();
    expect(useAppStore.getState().settings).toMatchObject({sidebarCollapsed:false,sidebarWidth:208,glassOpacity:.3,colorIntensity:.95});
  });
  it.each([
    {sidebarCollapsed:'false',sidebarWidth:NaN,glassOpacity:Infinity,colorIntensity:NaN,expected:[true,184,.72,.85]},
    {sidebarCollapsed:null,sidebarWidth:500,glassOpacity:-2,colorIntensity:2,expected:[true,260,.12,1]},
    {sidebarCollapsed:false,sidebarWidth:50,glassOpacity:2,colorIntensity:-1,expected:[false,152,1,0]},
  ])('修复损坏或越界外观偏好 %#',async ({expected,...settings}) => {
    window.musicAPI.getUserData=vi.fn().mockResolvedValue({...source,settings:{...source.settings,...settings}});
    const {useAppStore}=await import('./store');
    await useAppStore.getState().initialize();
    const state=useAppStore.getState().settings;
    expect([state.sidebarCollapsed,state.sidebarWidth,state.glassOpacity,state.colorIntensity]).toEqual(expected);
  });
  it('持续播放更新期间也定期保存设置，不无限推迟写盘',async () => {
    const {useAppStore,scheduleSave}=await import('./store');
    await useAppStore.getState().initialize();
    useAppStore.getState().setSettings({lyricSize:24});
    for(let tick=0;tick<15;tick++) {
      useAppStore.setState({progress:{[songs[0].audioPath]:tick}});
      scheduleSave(); await vi.advanceTimersByTimeAsync(100);
    }
    expect(saved.mock.calls.length).toBeGreaterThanOrEqual(3);
    expect(saved.mock.calls.at(-1)?.[0].settings.lyricSize).toBe(24);
    expect(saved.mock.calls.at(-1)?.[0].progress[songs[0].audioPath]).toBe(14);
  });
  it('旧数据默认新版；保存经典界面偏好时保留播放状态和既有设置',async () => {
    const {useAppStore,serializeUserData,persistNow}=await import('./store');
    await useAppStore.getState().initialize();
    expect(useAppStore.getState().settings.interfaceMode).toBe('modern');
    useAppStore.getState().setPlayer({song:songs[0],playing:true,time:42});
    const player=useAppStore.getState().player;
    useAppStore.getState().setSettings({interfaceMode:'classic'});
    expect(useAppStore.getState().player).toBe(player);
    expect(serializeUserData().settings.volume).toBe(source.settings.volume);
    await persistNow();
    expect(saved.mock.calls.at(-1)?.[0].settings.interfaceMode).toBe('classic');
  });
  it('加载已保存的经典界面偏好',async () => {
    window.musicAPI.getUserData=vi.fn().mockResolvedValue({...source,settings:{...source.settings,interfaceMode:'classic'}});
    const {useAppStore}=await import('./store');
    await useAppStore.getState().initialize();
    expect(useAppStore.getState().settings.interfaceMode).toBe('classic');
  });
  it('兼容旧移动端数字播放次数，保留累计次数',async () => {
    window.musicAPI.getUserData=vi.fn().mockResolvedValue({stats:{[songs[0].audioPath]:7}});
    const {useAppStore,serializeUserData}=await import('./store');
    await useAppStore.getState().initialize();
    expect(serializeUserData().stats[songs[0].audioPath]).toEqual({plays:7,duration:0});
  });
  it('保存手工曲风、清空与恢复音频标签不会改动歌曲或旧统计',async () => {
    window.musicAPI.getUserData=vi.fn().mockResolvedValue({...source,genreOverrides:{[songs[1].audioPath]:['Jazz']}});
    const {useAppStore,serializeUserData}=await import('./store');
    await useAppStore.getState().initialize();
    useAppStore.getState().setSongGenres(songs[0].audioPath,[' Pop ','Pop','']);
    expect(serializeUserData().genreOverrides[songs[0].audioPath]).toEqual(['Pop']);
    expect(serializeUserData().genreOverrides[songs[1].audioPath]).toEqual(['Jazz']);
    useAppStore.getState().setSongGenres(songs[0].audioPath,[]);
    expect(serializeUserData().genreOverrides[songs[0].audioPath]).toEqual([]);
    useAppStore.getState().setSongGenres(songs[0].audioPath,null);
    expect(serializeUserData().genreOverrides).toEqual({[songs[1].audioPath]:['Jazz']});
    expect(serializeUserData().stats).toEqual(source.stats);
    expect(useAppStore.getState().songs).toEqual(songs);
    useAppStore.getState().removeSong(songs[1].audioPath);
    expect(serializeUserData().genreOverrides).toEqual({});
  });
  it('初始化前不写空数据；加载后保留收藏、进度、统计和自定义音效',async () => {
    const {useAppStore,persistNow,serializeUserData}=await import('./store');
    persistNow(true); expect(saved).not.toHaveBeenCalled();
    await useAppStore.getState().initialize();
    const data=serializeUserData();
    expect(data.collections).toEqual(source.collections);
    expect(data.likes).toEqual(source.likes);
    expect(data.dislikes).toEqual(source.dislikes);
    expect(data.lastSession).toEqual(source.lastSession);
    expect(data.stats).toEqual(source.stats);
    expect(data.progress).toEqual(source.progress);
    expect(data.settings.volume).toBe(1.25);
    expect(data.settings.audioFx).toEqual(source.settings.audioFx);
    expect(data.settings.mobileEnabled).toBe(true);
  });
  it('兼容旧字符串收藏，迁移为歌单时保留歌曲路径',async () => {
    window.musicAPI.getUserData=vi.fn().mockResolvedValue({likes:['D:\\music\\one.mp3'],settings:{}});
    const {useAppStore,serializeUserData}=await import('./store');
    await useAppStore.getState().initialize();
    expect(serializeUserData().collections[0].songs).toEqual(['D:\\music\\one.mp3']);
    expect(serializeUserData().likes[0].path).toBe('D:\\music\\one.mp3');
  });
  it('不推荐与收藏互斥，重新收藏可取消不推荐',async () => {
    const {useAppStore,isLiked}=await import('./store'); await useAppStore.getState().initialize();
    useAppStore.getState().toggleDislike(songs[0].audioPath);
    expect(isLiked(songs[0].audioPath)).toBe(false);
    expect(useAppStore.getState().dislikes[songs[0].audioPath]).toBeDefined();
    useAppStore.getState().toggleLike(songs[0].audioPath);
    expect(isLiked(songs[0].audioPath)).toBe(true);
    expect(useAppStore.getState().dislikes[songs[0].audioPath]).toBeUndefined();
  });
  it('彻底删除后清理关联元数据，并修正正在播放歌曲的索引',async () => {
    const {useAppStore,serializeUserData}=await import('./store'); await useAppStore.getState().initialize();
    useAppStore.getState().setPlayer({song:songs[1],index:1});
    useAppStore.getState().removeSong(songs[0].audioPath);
    expect(useAppStore.getState().player.index).toBe(0);
    const data=serializeUserData();
    expect(data.collections[0].songs).toEqual([]);
    expect(data.stats).toEqual({}); expect(data.progress).toEqual({}); expect(data.actualDuration).toEqual({});
    expect(data.lastSession).toBeNull();
  });
  it('切换默认收藏不会删除自建歌单中的歌曲',async () => {
    const {useAppStore}=await import('./store'); await useAppStore.getState().initialize();
    useAppStore.getState().toggleLike(songs[0].audioPath);
    useAppStore.getState().toggleLike(songs[0].audioPath);
    expect(useAppStore.getState().collections.find(collection=>collection.id==='saved')?.songs).toEqual([songs[0].audioPath]);
  });
  it('初始化失败不覆盖持久化数据，并允许重新加载',async () => {
    window.musicAPI.getSongs=vi.fn().mockRejectedValueOnce(new Error('读取失败')).mockResolvedValue(songs);
    const {useAppStore,persistNow}=await import('./store'); await useAppStore.getState().initialize();
    persistNow(true); expect(saved).not.toHaveBeenCalled(); expect(useAppStore.getState().hydrated).toBe(false);
    await useAppStore.getState().initialize(); expect(useAppStore.getState().hydrated).toBe(true);
  });
  it.each(['reject','false'])('旧浏览器收藏保存失败 (%s) 时保留恢复来源',async failure => {
    window.musicAPI.getUserData=vi.fn().mockResolvedValue({likes:[],collections:[]});
    localStorage.setItem('sqet-likes',JSON.stringify([songs[0].audioPath]));
    if (failure==='reject') saved.mockRejectedValueOnce(new Error('磁盘写入失败'));
    else saved.mockResolvedValueOnce(false);
    const log=vi.spyOn(console,'error').mockImplementation(()=>{});
    const {useAppStore,persistNow}=await import('./store');
    await useAppStore.getState().initialize();
    expect(useAppStore.getState().collections[0].songs).toEqual([songs[0].audioPath]);
    expect(localStorage.getItem('sqet-likes')).not.toBeNull();
    expect(await persistNow()).toBe(true);
    expect(localStorage.getItem('sqet-likes')).toBeNull();
    log.mockRestore();
  });
});
