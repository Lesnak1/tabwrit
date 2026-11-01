import { spawnSync } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import { createRequire } from 'node:module';

const require = createRequire(import.meta.url);
const wasmOptCli = path.join(
  path.dirname(require.resolve('wasm-opt/package.json')),
  'dist',
  'cli.js'
);

const env = { ...process.env };

if (process.platform === 'win32') {
  const base = path.join(
    process.env.LOCALAPPDATA || '',
    'Microsoft',
    'WinGet',
    'Packages'
  );
  if (fs.existsSync(base)) {
    for (const entry of fs.readdirSync(base)) {
      const bin = path.join(base, entry, 'mingw64', 'bin');
      if (fs.existsSync(path.join(bin, 'x86_64-w64-mingw32-gcc.exe'))) {
        env.PATH = `${bin};${env.PATH}`;
        break;
      }
    }
  }
}

function cargoCommand() {
  if (process.platform === 'win32') {
    const candidate = path.join(
      process.env.USERPROFILE || '',
      '.cargo',
      'bin',
      'cargo.exe'
    );
    if (fs.existsSync(candidate)) return candidate;
  }
  return 'cargo';
}

function run(command, args, cwd, shell = false) {
  const result = spawnSync(command, args, {
    cwd,
    stdio: 'inherit',
    env,
    shell,
  });
  if (result.error) throw result.error;
  if (result.status !== 0) {
    throw new Error(`${command} ${args.join(' ')} failed with code ${result.status}`);
  }
}

function build(crate) {
  const cwd = path.resolve('contracts', crate);
  console.log(`\nBuilding ${crate}...`);
  run(cargoCommand(), ['build', '--target', 'wasm32-unknown-unknown', '--release'], cwd);
  const wasm = path.join(
    cwd,
    'target',
    'wasm32-unknown-unknown',
    'release',
    crate === 'tab-vault' ? 'tab_vault.wasm' : 'nep141_token.wasm'
  );
  if (!fs.existsSync(wasm)) {
    throw new Error(`WASM not found at ${wasm}`);
  }
  console.log(`Optimizing ${path.basename(wasm)}...`);
  run(
    process.execPath,
    [wasmOptCli, '-Oz', '--strip-debug', wasm, '-o', wasm],
    path.resolve('.')
  );
  const bytes = fs.statSync(wasm).size;
  console.log(`${path.basename(wasm)}: ${bytes} bytes (${(bytes / 1024).toFixed(1)} KB)`);
  return wasm;
}

try {
  build('tab-vault');
  build('nep141-token');
  console.log('\nContract build complete.');
} catch (err) {
  console.error(err.message || err);
  process.exit(1);
}
