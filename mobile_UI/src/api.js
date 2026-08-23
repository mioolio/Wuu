// =========== 移动端 API 封装 ===========
// 所有请求走相对路径, 由桌面端 HTTP 服务器处理

// 分页获取歌单列表 (按需加载)
export async function fetchSongsPage(page, pageSize = 30) {
  const resp = await fetch(`/api/songs?page=${page}&pageSize=${pageSize}`);
  if (!resp.ok) throw new Error(`HTTP ${resp.status}`);
  const data = await resp.json();
  if (!data.ok) throw new Error(data.message || '获取歌单失败');
  return data;
}

// 获取一首随机歌曲 (推荐页首次播放用)
export async function fetchRandomSong() {
  const resp = await fetch('/api/random');
  if (!resp.ok) throw new Error(`HTTP ${resp.status}`);
  const data = await resp.json();
  if (!data.ok) throw new Error(data.message || '获取随机歌曲失败');
  return data;  // { ok, song, index, total }
}

// 音频流地址 (直接用作 <audio> src, 浏览器原生支持 Range 请求)
export function streamUrl(id) {
  return `/api/stream/${id}`;
}

// 音频流地址 (按文件路径, 用于桌面端同步, 保证音频正确)
export function streamByPath(filePath) {
  if (!filePath) return '';
  return `/api/stream-by-path?path=${encodeURIComponent(filePath)}`;
}

// 封面图地址 (按歌曲 ID)
export function coverUrl(id) {
  return `/api/cover/${id}`;
}

// 封面图地址 (按文件路径, 用于桌面端同步)
export function coverByPath(filePath) {
  if (!filePath) return '';
  return `/api/cover-by-path?path=${encodeURIComponent(filePath)}`;
}

// 获取歌词文本
export async function fetchLyric(id) {
  const resp = await fetch(`/api/lyric/${id}`);
  if (!resp.ok) {
    console.warn(`[lyric] 获取歌词失败: id=${id} status=${resp.status}`);
    return '';
  }
  const text = await resp.text();
  if (!text || !text.trim()) {
    console.warn(`[lyric] 歌词内容为空: id=${id}`);
  }
  return text;
}

// =========== 数据同步 API ===========

// 获取用户歌单 (含"我喜欢"和自建歌单)
export async function fetchCollections() {
  const resp = await fetch('/api/collections');
  if (!resp.ok) throw new Error(`HTTP ${resp.status}`);
  const data = await resp.json();
  if (!data.ok) throw new Error(data.message || '获取歌单失败');
  return data;  // { ok, collections: [{ id, name, songCount, songs, createdAt }] }
}

// 获取已喜欢的歌曲索引列表
export async function fetchLiked() {
  const resp = await fetch('/api/liked');
  if (!resp.ok) throw new Error(`HTTP ${resp.status}`);
  const data = await resp.json();
  if (!data.ok) throw new Error(data.message || '获取喜欢列表失败');
  return data;  // { ok, likedIndices: [0, 5, 12, ...] }
}

// 切换点赞 (返回 { ok, liked: true/false })
export async function toggleLike(index) {
  const resp = await fetch('/api/like', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ index }),
  });
  if (!resp.ok) throw new Error(`HTTP ${resp.status}`);
  return resp.json();
}

// 添加/移除歌曲到指定歌单
export async function likeToCollection(index, collectionId, add = true) {
  const resp = await fetch('/api/like-collection', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ index, collectionId, add }),
  });
  if (!resp.ok) throw new Error(`HTTP ${resp.status}`);
  return resp.json();
}

// 上报播放次数
export async function reportPlayCount(index) {
  try {
    await fetch('/api/play-count', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ index }),
    });
  } catch (e) {
    console.warn('[sync] 上报播放次数失败:', e.message);
  }
}

// 上报播放进度
export async function reportProgress(index, time) {
  try {
    await fetch('/api/progress', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ index, time }),
    });
  } catch (e) {
    console.warn('[sync] 上报播放进度失败:', e.message);
  }
}

// 获取歌曲播放进度
export async function fetchProgress(index) {
  try {
    const resp = await fetch(`/api/progress/${index}`);
    if (!resp.ok) return 0;
    const data = await resp.json();
    return data.ok ? (data.progress || 0) : 0;
  } catch (e) {
    return 0;
  }
}

// 获取桌面端当前播放状态 (用于移动端同步)
export async function fetchDesktopState() {
  const resp = await fetch('/api/state');
  if (!resp.ok) throw new Error(`HTTP ${resp.status}`);
  const data = await resp.json();
  if (!data.ok) throw new Error(data.message || '获取桌面状态失败');
  return data.state;  // { playMode, isPlaying, index, currentTime, duration, songInfo, updatedAt }
}

// 获取同步模式
export async function fetchSyncMode() {
  const resp = await fetch('/api/sync-mode');
  if (!resp.ok) throw new Error(`HTTP ${resp.status}`);
  return resp.json();  // { ok, mode: 'merged' | 'isolated' }
}

// 设置同步模式
export async function setSyncMode(mode) {
  const resp = await fetch('/api/sync-mode', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ mode }),
  });
  if (!resp.ok) throw new Error(`HTTP ${resp.status}`);
  return resp.json();
}
