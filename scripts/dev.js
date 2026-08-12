// =========== 开发模式启动脚本 ===========
// 同时启动: Electron 桌面端 (提供后端 API) + Vite dev server (移动端 UI 热更新)
// 用法: node scripts/dev.js  或  npm run dev:all
// 退出: Ctrl+C 会同时关闭两个进程
const { spawn } = require('child_process');
const path = require('path');
const fs = require('fs');

const root = path.join(__dirname, '..');
const isWin = process.platform === 'win32';
const npmCmd = isWin ? 'npm.cmd' : 'npm';

// 颜色输出
const C = {
  reset: '\x1b[0m',
  gray: '\x1b[90m',
  cyan: '\x1b[36m',
  green: '\x1b[32m',
  yellow: '\x1b[33m',
  red: '\x1b[31m',
};

const children = [];

function spawnProc(name, cmd, args, cwd, color) {
  const prefix = `${color}[${name}]${C.reset} `;
  const p = spawn(cmd, args, { cwd, shell: isWin, env: process.env });
  children.push(p);

  let buf = '';
  p.stdout.on('data', (d) => {
    buf += d.toString();
    const lines = buf.split('\n');
    buf = lines.pop();
    for (const l of lines) process.stdout.write(prefix + l + '\n');
  });
  p.stderr.on('data', (d) => {
    buf += d.toString();
    const lines = buf.split('\n');
    buf = lines.pop();
    for (const l of lines) process.stderr.write(prefix + l + '\n');
  });
  p.on('exit', (code, sig) => {
    console.log(`${color}[${name}]${C.reset} 进程退出 code=${code} sig=${sig}`);
  });
  return p;
}

function cleanup() {
  for (const p of children) {
    try { p.kill('SIGTERM'); } catch (e) {}
    if (isWin) {
      try { spawn('taskkill', ['/pid', String(p.pid), '/T', '/F'], { shell: true }); } catch (e) {}
    }
  }
  process.exit(0);
}

process.on('SIGINT', cleanup);
process.on('SIGTERM', cleanup);

console.log(`${C.cyan}[dev]${C.reset} 启动开发模式: Electron + Vite`);

// 1. 启动 Electron 桌面端
console.log(`${C.gray}[dev] 启动 Electron 桌面端...${C.reset}`);
spawnProc('desktop', npmCmd, ['start'], root, C.cyan);

// 2. 稍延迟启动 Vite (避免端口冲突, 让 Electron 先起来)
setTimeout(() => {
  const mobileDir = path.join(root, 'mobile_UI');
  const nm = path.join(mobileDir, 'node_modules');
  if (!fs.existsSync(nm)) {
    console.log(`${C.yellow}[dev] mobile_UI/node_modules 不存在, 先安装依赖...${C.reset}`);
    const inst = spawn(npmCmd, ['install'], { cwd: mobileDir, shell: isWin, stdio: 'inherit' });
    inst.on('exit', () => {
      spawnProc('mobile', npmCmd, ['run', 'dev'], mobileDir, C.green);
    });
  } else {
    console.log(`${C.gray}[dev] 启动 Vite dev server (移动端 UI)...${C.reset}`);
    spawnProc('mobile', npmCmd, ['run', 'dev'], mobileDir, C.green);
  }
}, 1000);

console.log(`${C.yellow}[dev] 提示:${C.reset}`);
console.log(`  ${C.gray}- 桌面端窗口启动后, 在浏览器访问 http://localhost:5174/ 测试移动端 UI${C.reset}`);
console.log(`  ${C.gray}- 修改 mobile_UI/src/ 下文件自动热更新, 无需重新构建${C.reset}`);
console.log(`  ${C.gray}- 修改 server/ 或主进程代码需重启 Electron (Ctrl+C 后重新 npm run dev:all)${C.reset}`);
console.log(`  ${C.gray}- 按 Ctrl+C 退出并关闭两个进程${C.reset}`);
