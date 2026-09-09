// 独立运行一起听服务器 (无 Electron 桌面端): 供自动化测试使用
// 用法: node -r ./scripts/stub-electron.js scripts/run-standalone-server.js [端口]
'use strict';
const port = parseInt(process.argv[2] || '30980', 10);
const { startServer } = require('../server/index.js');
const actual = startServer(port, '127.0.0.1');
console.log('[standalone-server] listening on', actual);
setInterval(() => {}, 1 << 30);  // 保持进程存活
