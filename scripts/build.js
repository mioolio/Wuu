const { spawnSync, spawn } = require('child_process');
const path = require('path');
const root = path.join(__dirname, '..');
const windows = process.platform === 'win32';
function npm(args) {
  const result = spawnSync(windows ? 'npm.cmd' : 'npm', args, { cwd: root, stdio: 'inherit', shell: windows, windowsHide: true });
  if (result.error) throw result.error;
  if (result.status !== 0) process.exit(result.status || 1);
}
npm(['run', 'build:desktop']);
npm(['run', 'build:mobile']);
const mode = process.argv[2];
if (mode === 'run') {
  const child = spawn(require('electron'), [root], { cwd: root, stdio: 'inherit', windowsHide: true });
  child.on('exit', code => process.exit(code || 0));
} else {
  const cli = require.resolve('electron-builder/cli.js');
  const result = spawnSync(process.execPath, [cli, ...(mode === 'dir' ? ['--dir'] : [])], { cwd: root, stdio: 'inherit', windowsHide: true });
  if (result.error) throw result.error;
  process.exit(result.status ?? 1);
}
