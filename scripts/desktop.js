const fs = require('fs');
const path = require('path');
const { spawn } = require('child_process');
const root = path.join(__dirname, '..');
const desktop = path.join(root, 'desktop_UI');
const isWindows = process.platform === 'win32';
const mode = process.argv[2] || 'start';
const children = new Set();
let stopping = false;

function run(command, args, options = {}) {
  const child = spawn(command, args, { cwd: root, stdio: 'inherit', windowsHide: true, ...options });
  children.add(child);
  child.on('exit', () => children.delete(child));
  return child;
}
function npm(args) {
  return new Promise((resolve, reject) => {
    const child = run(isWindows ? 'npm.cmd' : 'npm', args, { shell: isWindows });
    child.on('error', reject);
    child.on('exit', code => code === 0 ? resolve() : reject(new Error(`npm ${args.join(' ')} exited with ${code}`)));
  });
}
async function ensureDependencies() {
  if (!fs.existsSync(path.join(desktop, 'node_modules', 'vite', 'bin', 'vite.js'))) {
    await npm(['install', '--prefix', 'desktop_UI', '--no-fund']);
  }
}
function stop(exitCode = 0) {
  if (stopping) return;
  stopping = true;
  for (const child of [...children]) {
    if (isWindows && child.pid) spawn('taskkill', ['/pid', String(child.pid), '/T', '/F'], { windowsHide: true, stdio: 'ignore' });
    else child.kill('SIGTERM');
  }
  process.exitCode = exitCode;
  setTimeout(() => process.exit(exitCode), 250).unref();
}
process.on('SIGINT', () => stop());
process.on('SIGTERM', () => stop());

async function main() {
  await ensureDependencies();
  if (mode === 'install') return;
  if (mode === 'build') { await npm(['run', 'build', '--prefix', 'desktop_UI']); return; }
  const electron = require('electron');
  if (mode === 'dev') {
    const target = 'http://127.0.0.1:5173/';
    const vite = run(process.execPath, [path.join(desktop, 'node_modules', 'vite', 'bin', 'vite.js'), '--host', '127.0.0.1'], { cwd: desktop, stdio: ['inherit', 'pipe', 'pipe'] });
    await new Promise((resolve, reject) => {
      let output = '';
      const timeout = setTimeout(() => reject(new Error('React development server did not start on port 5173.')), 15000);
      vite.stdout.on('data', data => {
        process.stdout.write(data);
        output += data.toString().replace(/\x1b\[[0-9;]*m/g, '');
        if (output.includes(target)) { clearTimeout(timeout); resolve(); }
      });
      vite.stderr.on('data', data => process.stderr.write(data));
      vite.on('error', error => { clearTimeout(timeout); reject(error); });
      vite.on('exit', code => { clearTimeout(timeout); reject(new Error(`React development server exited with ${code}`)); if (!stopping) stop(code || 1); });
    });
    const app = run(electron, [root], { env: { ...process.env, WUU_RENDERER_URL: target } });
    app.on('error', error => { console.error(error.message); stop(1); });
    app.on('exit', code => stop(code || 0));
  } else {
    await npm(['run', 'build', '--prefix', 'desktop_UI']);
    const app = run(electron, [root]);
    app.on('error', error => { console.error(error.message); stop(1); });
    app.on('exit', code => process.exit(code || 0));
  }
}
main().catch(error => { console.error(error.message); stop(1); });
