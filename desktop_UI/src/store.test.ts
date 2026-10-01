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

beforeEach(() => {
  vi.resetModules(); vi.useFakeTimers();
  const storage = new Map<string,string>();
  vi.stubGlobal('localStorage',{getItem:(key:string) => storage.get(key) || null,setItem:(key:string,value:string) => storage.set(key,value),removeItem:(key:string)=>storage.delete(key)});
  saved=vi.fn().mockResolvedValue(undefined);
  vi.stubGlobal('window',{musicAPI:{getSongs:vi.fn().mockResolvedValue(songs),getUserData:vi.fn().mockResolvedValue(structuredClone(source)),saveUserData:saved,saveUserDataSync:saved}});
});
afterEach(() => { vi.clearAllTimers(); vi.useRealTimers(); vi.unstubAllGlobals(); });

describe('现有用户数据迁移',() => {
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
