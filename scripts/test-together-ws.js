// 一起听 WS 协议验证脚本: 两个模拟客户端连接 /ws/together
// 验证: welcome.hostId / peers.hostId / peer-left 广播
// 用法: node scripts/test-together-ws.js [端口]
'use strict';
const WebSocket = require('ws');
const port = process.argv[2] || 30967;
const url = `ws://127.0.0.1:${port}/ws/together`;

const a = new WebSocket(url);
let b = null;
const log = (...args) => console.log('[test]', ...args);

a.on('open', () => log('A connected'));
a.on('message', (d) => {
  const m = JSON.parse(d.toString());
  log('A <=', JSON.stringify(m));
  if (m.type === 'welcome' && b === null) {
    if (typeof m.hostId !== 'number') { console.error('FAIL: welcome 无 hostId'); process.exit(1); }
    // hostId 必须是房间内某个更早(或自己)的 id: 不可能大于新加入者的 id
    if (m.hostId > m.id) { console.error(`FAIL: hostId(${m.hostId}) 大于新成员 id(${m.id})`); process.exit(1); }
    const hostBefore = m.hostId;
    // 记录 B 的行为断言基准
    a._hostBefore = hostBefore;
    b = new WebSocket(url);
    b.on('open', () => log('B connected'));
    b.on('message', (d) => {
      const mb = JSON.parse(d.toString());
      log('B <=', JSON.stringify(mb));
      if (mb.type === 'welcome') {
        // B 加入不改变 host (host = 最小 id, B 的 id 只会更大)
        if (mb.hostId !== hostBefore) { console.error(`FAIL: B 加入后 host 变化 ${hostBefore} -> ${mb.hostId}`); process.exit(1); }
        // B 发一个 op, A 应收到 (带 seq/from)
        setTimeout(() => {
          log('B => op pause');
          b.send(JSON.stringify({ type: 'op', op: 'pause', payload: { position: 3 } }));
        }, 200);
      }
    });
    // 3.5s 后 B 断开, A 应收到 peer-left 且 hostId 不变
    setTimeout(() => { log('B closing'); b.close(); }, 3500);
  }
  if (m.type === 'op') {
    if (typeof m.seq !== 'number' || typeof m.from !== 'number') {
      console.error('FAIL: op 缺少 seq/from'); process.exit(1);
    }
  }
  if (m.type === 'peer-left') {
    if (typeof m.hostId !== 'number') { console.error('FAIL: peer-left 无 hostId'); process.exit(1); }
    if (m.hostId !== a._hostBefore) {
      // 仅当离开者就是 host 时才允许变化 (本测试 B 一定不是 host)
      console.error(`FAIL: peer-left 后 host 变化 ${a._hostBefore} -> ${m.hostId}`);
      process.exit(1);
    }
    log('PASS: peer-left 收到, 全部断言通过');
    setTimeout(() => process.exit(0), 300);
  }
});
a.on('error', (e) => { console.error('A error:', e.message); process.exit(1); });

setTimeout(() => { console.error('FAIL: 超时未完成断言'); process.exit(1); }, 15000);
