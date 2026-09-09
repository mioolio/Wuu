// Electron 桩: 让 server/index.js 可以在纯 Node 下加载
// 提供 ipcMain 空实现 + app.getPath('userData') 指向临时目录
'use strict';
const fs = require('fs');
const path = require('path');
const os = require('os');
const userData = path.join(os.tmpdir(), 'wuu-standalone-test');
fs.mkdirSync(userData, { recursive: true });
const Module = require('module');
const origLoad = Module._load;
Module._load = function (request, parent, isMain) {
  if (request === 'electron') {
    return {
      ipcMain: { handle: () => {}, on: () => {} },
      app: { getPath: (name) => (name === 'userData' ? userData : os.tmpdir()) },
    };
  }
  return origLoad.apply(this, arguments);
};
