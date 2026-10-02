// Public catalog metadata only. Playback and downloads retain the existing
// song_url_v1/import handlers and their platform availability checks.
const CATEGORIES = ['全部', '流行', '民谣', '电子', '摇滚', '轻音乐', '爵士', '欧美'];

function shuffle(items, random) {
  const values = [...items];
  for (let index = values.length - 1; index > 0; index--) {
    const next = Math.min(index, Math.max(0, Math.floor(random() * (index + 1))));
    [values[index], values[next]] = [values[next], values[index]];
  }
  return values;
}

async function deadline(task, timeoutMs) {
  let timer;
  try {
    return await Promise.race([task, new Promise((_, reject) => {
      timer = setTimeout(() => reject(new Error('网易云公开歌单请求超时，请稍后重试')), timeoutMs);
    })]);
  } finally { clearTimeout(timer); }
}

async function fetchDiscoveryCandidates(api, { page = 0 } = {}, { random = Math.random, timeoutMs = 7000 } = {}) {
  const cursor = Number.isFinite(Number(page)) ? Math.max(0, Math.min(10000, Math.floor(Number(page)))) : 0;
  const category = CATEGORIES[cursor % CATEGORIES.length];
  const catalog = await deadline(api.top_playlist({ cat: category, order: 'hot', limit: 20,
    offset: Math.floor(cursor / CATEGORIES.length) % 6 * 20, cookie: '' }), timeoutMs);
  const body = catalog?.body;
  if (body?.code !== 200 || !Array.isArray(body.playlists)) throw new Error(body?.msg || body?.message || '网易云公开歌单暂时不可用，请重试');
  const playlists = shuffle(body.playlists.filter(item => item?.id), random).slice(0, 3);
  if (!playlists.length) throw new Error('网易云公开歌单没有返回曲目来源，请换一批重试');
  const results = await Promise.allSettled(playlists.map(playlist => deadline(
    api.playlist_track_all({ id: playlist.id, limit: 80, offset: 0, cookie: '' }), timeoutMs)));
  const songs = new Map();
  let failure;
  results.forEach(result => {
    if (result.status === 'rejected') { failure = result.reason; return; }
    const detail = result.value?.body;
    if (detail?.code !== 200 || !Array.isArray(detail.songs)) { failure = new Error(detail?.message || '公开歌单曲目读取失败'); return; }
    const privileges = new Map((Array.isArray(detail.privileges) ? detail.privileges : []).filter(item => item?.id).map(item => [String(item.id), item]));
    detail.songs.forEach(song => {
      if (!song || typeof song !== 'object') return;
      const names = song.ar || song.artists;
      const artist = (Array.isArray(names) ? names : []).map(item => item?.name).filter(Boolean).join(', ');
      const privilege = privileges.get(String(song.id));
      // Restrict discovery to ordinary/free-standard catalog entries. A public
      // listing is never treated as permission to unlock VIP or paid albums.
      if (!song.id || !song.name || !artist || ![0, 8].includes(Number(song.fee || 0)) || Number(privilege?.st || 0) < 0) return;
      songs.set(String(song.id), { id: String(song.id), source: 'netease', name: song.name, artist,
        album: song.al?.name || song.album?.name || '', cover: song.al?.picUrl || song.album?.picUrl || '',
        duration: song.dt || song.duration || 0, fee: Number(song.fee || 0), _raw: song });
    });
  });
  if (!songs.size) throw failure || new Error('这批公开歌单没有可用的免费曲目，请换一批重试');
  return shuffle([...songs.values()], random).slice(0, 180);
}

module.exports = { fetchDiscoveryCandidates };
