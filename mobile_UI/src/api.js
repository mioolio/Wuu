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

// 封面图地址
export function coverUrl(id) {
  return `/api/cover/${id}`;
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
