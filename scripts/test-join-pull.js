// 加入即拉取 (join-pull) E2E: 模拟 host 正在播放, 页面手动开启一起听后应立即对齐
// 用法: node scripts/test-join-pull.js [端口]
'use strict';
const http = require('http');
const WebSocket = require('ws');
const port = process.argv[2] || 30980;
const log = (...a) => console.log('[host-sim]', ...a);

function fetchSongByIdx(idx) {
  const page = Math.floor(idx / 30) + 1;
  return new Promise((resolve, reject) => {
    http.get(`http://127.0.0.1:${port}/api/songs?page=${page}&pageSize=30`, (res) => {
      let buf = '';
      res.on('data', (c) => (buf += c));
      res.on('end', () => {
        try {
          const song = JSON.parse(buf).songs.find(s => s.id === idx);
          resolve(song || reject(new Error('song not found')));
        } catch (e) { reject(e); }
      });
    }).on('error', reject);
  });
}

(async () => {
  const song = await fetchSongByIdx(30);  // 固定选 id=30, 与页面随机播放大概率不同
  log('host 将播放:', song.id, song.songName, '-', song.artist);

  const ws = new WebSocket(`ws://127.0.0.1:${port}/ws/together`);
  ws.on('error', (e) => { console.error('WS error:', e.message); process.exit(1); });
  ws.on('message', (d) => {
    const m = JSON.parse(d.toString());
    if (m.type === 'welcome') {
      log('connected as id', m.id, 'hostId', m.hostId, 'hostSong in welcome:', !!m.hostSong);
      if (m.hostId !== m.id) {
        console.error('本脚本不是 host, 测试无效');
        process.exit(1);
      }
      // 广播 host 播放状态 (服务端注册 _togetherHostSong 供加入者拉取)
      ws.send(JSON.stringify({
        type: 'op', op: 'state',
        payload: { position: 42, isPlaying: true, rate: 1, songId: song.id, song },
      }));
      log('host state 已广播 (position=42)');
    } else if (m.type === 'op') {
      log('<= op', m.op, JSON.stringify(m.payload).slice(0, 100));
    } else if (m.type !== 'ping') {
      log('<=', m.type, m.count != null ? `count=${m.count}` : '');
    }
  });
  // 保持 45 秒供页面加入测试
  setTimeout(() => { log('done'); process.exit(0); }, 45000);
})();
