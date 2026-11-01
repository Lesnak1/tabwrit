import { spawnSync } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';

const env = { ...process.env };

// On Windows the Rust host toolchain is x86_64-pc-windows-gnu. The default
// `x86_64-w64-mingw32-gcc` on PATH may point at LLVM-MinGW, which does not
// ship libgcc_eh.a under the name the linker requests. WinLibs does. Prefer
// a WinLibs bin directory when one is installed.
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

const cwd = path.resolve('contracts/tab-vault');
console.log('Tab contract tests (real Rust VM, not a TypeScript model)');
console.log(`cwd: ${cwd}\n`);

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

const result = spawnSync(cargoCommand(), ['test'], {
  cwd,
  stdio: 'inherit',
  env,
});

if (result.error) {
  console.error(result.error.message);
  process.exit(1);
}
process.exit(result.status ?? 1);
