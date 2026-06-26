const { copyFileSync, existsSync, mkdirSync, readdirSync, rmSync } = require('node:fs');
const { join, resolve } = require('node:path');
const { spawnSync } = require('node:child_process');

const root = resolve(__dirname, '..', '..', '..');
const sourceOut = join(__dirname, '..', 'src', 'wasm');
const distOut = join(__dirname, '..', 'dist', 'wasm');
const tempOut = join(__dirname, '..', 'dist', '.wasm-build');
const env = { ...process.env, PATH: buildPath(), CMAKE_GENERATOR: process.env.CMAKE_GENERATOR || 'Ninja' };

rmSync(tempOut, { recursive: true, force: true });
mkdirSync(tempOut, { recursive: true });

run(wasmPackCommand(), [
  'build',
  join(root, 'core'),
  '--target',
  'web',
  '--release',
  '--out-dir',
  tempOut,
  '--out-name',
  'ssk_core',
  '--no-default-features',
  '--features',
  'wasm',
]);
rmSync(join(tempOut, '.gitignore'), { force: true });

rmSync(sourceOut, { recursive: true, force: true });
copyDir(tempOut, sourceOut);

rmSync(distOut, { recursive: true, force: true });
copyDir(sourceOut, distOut);
rmSync(tempOut, { recursive: true, force: true });

function run(command, args) {
  const result = spawnSync(command, args, { stdio: 'inherit', env, shell: process.platform === 'win32' });
  if (result.status !== 0) process.exit(result.status ?? 1);
}

function wasmPackCommand() {
  if (process.env.WASM_PACK) return process.env.WASM_PACK;
  if (process.platform === 'win32' && process.env.USERPROFILE) {
    const candidate = join(process.env.USERPROFILE, '.cargo', 'bin', 'wasm-pack.exe');
    if (existsSync(candidate)) return candidate;
  }
  return process.platform === 'win32' ? 'wasm-pack.cmd' : 'wasm-pack';
}

function buildPath() {
  const parts = [];
  if (process.env.WASM_CXX_SHIM_LLVM_BIN_DIR) parts.push(process.env.WASM_CXX_SHIM_LLVM_BIN_DIR);
  if (process.platform === 'win32' && existsSync('C:\\Program Files\\LLVM\\bin')) parts.push('C:\\Program Files\\LLVM\\bin');
  for (const path of pythonScriptPaths()) parts.push(path);
  if (process.platform === 'win32' && process.env.USERPROFILE) parts.push(join(process.env.USERPROFILE, '.cargo', 'bin'));
  parts.push(process.env.PATH || '');
  return parts.join(process.platform === 'win32' ? ';' : ':');
}

function pythonScriptPaths() {
  const python = process.env.PYTHON || 'python';
  const code = "import site, sys, sysconfig; scheme='nt_user' if sys.platform.startswith('win') else 'posix_user'; print(sysconfig.get_path('scripts', scheme=scheme)); print(site.USER_BASE)";
  const result = spawnSync(python, ['-c', code], { encoding: 'utf8' });
  if (result.status !== 0) return [];
  const [scripts, userBase] = result.stdout.trim().split(/\r?\n/);
  const paths = [scripts];
  if (userBase) paths.push(join(userBase, process.platform === 'win32' ? 'Scripts' : 'bin'));
  return paths.filter(Boolean);
}

function copyDir(source, target) {
  mkdirSync(target, { recursive: true });
  for (const entry of readdirSync(source, { withFileTypes: true })) {
    const src = join(source, entry.name);
    const dst = join(target, entry.name);
    if (entry.isDirectory()) copyDir(src, dst);
    else copyFileSync(src, dst);
  }
}
