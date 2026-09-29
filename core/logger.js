// =========== 调试日志 (写到 userData/wuu-debug.log, 打包后也可写) ===========
// 其他用户可能无法打开 F12, 关键错误写入日志文件便于回传诊断
// dbgLog 只写日志文件不输出终端, dbgErr(严重错误) 才输出终端
const path = require('path');
const fs = require('fs');
const { app } = require('electron');

const debugLogPath = path.join(app.getPath('userData'), 'wuu-debug.log');

function dbgLog(...args) {
  const ts = new Date().toISOString();
  const msg = args.map(a => (typeof a === 'object' ? JSON.stringify(a) : String(a))).join(' ');
  const line = `[${ts}] ${msg}\n`;
  try { fs.appendFileSync(debugLogPath, line, 'utf-8'); } catch (e) {}
}
function dbgErr(...args) {
  const ts = new Date().toISOString();
  const msg = args.map(a => (typeof a === 'object' ? JSON.stringify(a) : String(a))).join(' ');
  const line = `[${ts}] [ERROR] ${msg}\n`;
  console.error('[DBG]', msg);
  try { fs.appendFileSync(debugLogPath, line, 'utf-8'); } catch (e) {}
}

module.exports = { dbgLog, dbgErr, debugLogPath };
