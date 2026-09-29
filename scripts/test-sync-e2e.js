// 一起听失步自愈 + 点赞同步 E2E 验证
// 本脚本模拟 host 设备 (先连接拿到最小 id):
//   1. 发送 state 心跳, 携带与页面不同的歌曲 + 完整歌曲对象 → 页面应自动切到该歌
//   2. 发送 like 广播 → 页面红心应点亮
// 用法: 先启动桌面应用, 再 node scripts/test-sync-e2e.js [端口], 然后打开/刷新手机页面
'use strict';
const http = require('http');
const WebSocket = require('ws');
const port = process.argv[2] || 30967;
const log = (...a) => console.log('[host-sim]', ...a);

function fetchFirstSong() {
  return new Promise((resolve, reject) => {
    http.get(`http://127.0.0.1:${port}/api/songs?page=1&pageSize=1`, (res) => {
      let buf = '';
      res.on('data', (c) => (buf += c));
      res.on('end', () => {
        try { resolve(JSON.parse(buf).songs[0]); } catch (e) { reject(e); }
      });
    }).on('error', reject);
  });
}

(async () => {
  const song = await fetchFirstSong();
  log('将同步的歌曲:', song.id, song.songName, '-', song.artist);

  const ws = new WebSocket(`ws://127.0.0.1:${port}/ws/together`);
  ws.on('error', (e) => { console.error('WS error:', e.message); process.exit(1); });
  let sentState = false;
  ws.on('message', (d) => {
    const m = JSON.parse(d.toString());
    if (m.type === 'welcome') {
      log('connected as id', m.id, 'hostId', m.hostId);
      if (m.hostId !== m.id) {
        console.error('本脚本不是 host (房间已有更早成员), 测试无效');
        process.exit(1);
      }
      log('等待页面开始播放 (其 song 广播触发失步注入)...');
    } else if (m.type === 'op' && !sentState) {
      // 页面广播了操作 (开始播放): 立即注入"不同歌曲"的 host 心跳
      sentState = true;
      log('收到页面操作, 注入失步 state (不同歌曲, 含完整歌曲对象)');
      setTimeout(() => {
        ws.send(JSON.stringify({
          type: 'op', op: 'state',
          payload: { position: 8, isPlaying: true, rate: 1, songId: song.id, song },
        }));
      }, 300);
      // 2.5 秒后广播点赞
      setTimeout(() => {
        log('=> like', song.id);
        ws.send(JSON.stringify({ type: 'op', op: 'like', payload: { index: song.id, liked: true } }));
      }, 2800);
      // 5 秒后退出
      setTimeout(() => { log('done'); process.exit(0); }, 5000);
    }
  });
  // 60 秒兜底超时
  setTimeout(() => { console.error('FAIL: 超时未收到页面操作'); process.exit(1); }, 60000);
})();
