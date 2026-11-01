/**
 * Release preflight for TabWrit.
 *
 * Read-only. It does not run git, deploy, sign or send anything.
 * It checks that the repository is ready to be committed and deployed after
 * 2026-11-01T00:00:00Z, and that no private key was left in a tracked-style
 * file.
 *
 * Usage: pnpm release:preflight
 */
import fs from 'node:fs';
import path from 'node:path';

const root = process.cwd();
const failures = [];
const warnings = [];

function read(rel) {
  return fs.readFileSync(path.join(root, rel), 'utf8');
}

function exists(rel) {
  return fs.existsSync(path.join(root, rel));
}

function requireFile(rel) {
  if (!exists(rel)) failures.push(`missing file: ${rel}`);
}

function requireText(rel, text, label = text) {
  if (!exists(rel)) {
    failures.push(`missing file: ${rel}`);
    return;
  }
  if (!read(rel).includes(text)) {
    failures.push(`missing ${label} in ${rel}`);
  }
}

const requiredFiles = [
  'README.md',
  'JUDGE.md',
  'REPRODUCE.md',
  'LICENSE',
  'package.json',
  'pnpm-lock.yaml',
  'vercel.json',
  '.env.example',
  'apps/web/.env.example',
  'services/keeper/.env.example',
  'docs/DEMO.md',
  'docs/DEMO_VO_EN.txt',
  'docs/DEMO_VO_EN_TTS.txt',
  'docs/DEMO_TR.md',
  'docs/SCREENSHOTS.md',
  'docs/evidence/testnet-e2e.json',
  'docs/evidence/meta-tx.json',
  'docs/evidence/agent-attack.json',
  'docs/evidence/agent-x402.json',
  'docs/evidence/web-gasless.json',
  'docs/evidence/relayer-usage.json',
];

for (const file of requiredFiles) requireFile(file);

const gitignore = exists('.gitignore') ? read('.gitignore') : '';
for (const pattern of [
  '.env',
  '.env.*',
  '!.env.example',
  'node_modules/',
  'target/',
  'dist/',
  '.next/',
  '*.wasm',
  'receipts.json',
  'relay-usage.json',
  '.vercel/',
]) {
  if (!gitignore.includes(pattern)) {
    failures.push(`.gitignore does not include ${pattern}`);
  }
}

const webEnvKeys = [
  'NEXT_PUBLIC_NEAR_NETWORK',
  'NEXT_PUBLIC_TAB_VAULT_CONTRACT_ID',
  'NEXT_PUBLIC_TAB_TOKEN_ID',
  'NEXT_PUBLIC_MERCHANT_ACCOUNT_ID',
  'NEXT_PUBLIC_DEMO_ACCOUNT_ID',
  'MERCHANT_CHARGE_PRIVATE_KEY',
  'KEEPER_URL',
  'RELAYER_API_KEY',
];

const keeperEnvKeys = [
  'NEAR_NETWORK=testnet',
  'NEAR_RPC_URL',
  'TAB_VAULT_CONTRACT_ID',
  'TAB_TOKEN_ID',
  'MERCHANT_ACCOUNT_ID',
  'KEEPER_API_KEY',
  'RELAYER_ACCOUNT_ID',
  'RELAYER_PRIVATE_KEY',
  'RELAYER_API_KEY',
  'KEEPER_CORS_ORIGIN',
  'PORT',
];

if (exists('apps/web/.env.example')) {
  const webEnv = read('apps/web/.env.example');
  for (const key of webEnvKeys) {
    if (!webEnv.includes(`${key}=`)) {
      failures.push(`apps/web/.env.example is missing ${key}`);
    }
  }
}

if (exists('services/keeper/.env.example')) {
  const keeperEnv = read('services/keeper/.env.example');
  for (const key of keeperEnvKeys) {
    const needle = key.includes('=') ? key : `${key}=`;
    if (!keeperEnv.includes(needle)) {
      failures.push(`services/keeper/.env.example is missing ${key}`);
    }
  }
}

if (exists('vercel.json')) {
  try {
    const vercel = JSON.parse(read('vercel.json'));
    if (vercel.installCommand !== 'pnpm install --frozen-lockfile') {
      warnings.push('vercel.json installCommand is not "pnpm install --frozen-lockfile"');
    }
    if (vercel.buildCommand !== 'pnpm --filter web build') {
      failures.push('vercel.json buildCommand must be "pnpm --filter web build"');
    }
    if (vercel.outputDirectory !== 'apps/web/.next') {
      warnings.push('vercel.json outputDirectory is not apps/web/.next');
    }
  } catch (err) {
    failures.push(`vercel.json is not valid JSON: ${err.message}`);
  }
}

if (exists('package.json')) {
  try {
    const pkg = JSON.parse(read('package.json'));
    for (const script of ['test', 'test:mcp', 'test:mcp:charge', 'test:x402', 'build:web', 'build:keeper', 'build:sdk']) {
      if (!pkg.scripts?.[script]) failures.push(`package.json is missing script ${script}`);
    }
  } catch (err) {
    failures.push(`package.json is not valid JSON: ${err.message}`);
  }
}

const excludedDirs = new Set(['node_modules', '.git', '.next', 'target', 'dist', '.vercel']);
const privateKeyPattern = /ed25519:[1-9A-HJ-NP-Za-km-z]{80,}/;

function walk(dir) {
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) {
      if (!excludedDirs.has(entry.name)) walk(full);
      continue;
    }
    if (!/\.(md|txt|ts|tsx|mjs|js|json|yaml|yml|toml|rs|sh)$/.test(entry.name)) continue;
    const rel = path.relative(root, full).replaceAll('\\', '/');
    if (rel === '.env' || rel === 'apps/web/.env.local' || rel === 'services/keeper/.env') continue;
    if (rel.startsWith('.env.') && rel !== '.env.example') continue;
    if (rel.startsWith('apps/web/.env.') && rel !== 'apps/web/.env.example') continue;
    if (rel.startsWith('services/keeper/.env.') && rel !== 'services/keeper/.env.example') continue;
    const text = fs.readFileSync(full, 'utf8');
    if (privateKeyPattern.test(text)) {
      failures.push(`possible private key in ${rel}`);
    }
  }
}

walk(root);

for (const rel of ['docs/DEMO.md', 'docs/SCREENSHOTS.md']) {
  if (exists(rel)) {
    const text = read(rel);
    if (text.includes('[REPO_URL]') || text.includes('[HOSTED_DEMO_URL]')) {
      warnings.push(`${rel} still contains deploy-time URL placeholders`);
    }
  }
}

if (!exists('.git')) {
  warnings.push('no git repository yet; do not initialize/commit before 2026-11-01T00:00:00Z');
}

console.log('TabWrit release preflight');
console.log('========================');
console.log(`root: ${root}`);
console.log('');

for (const warning of warnings) console.log(`WARN  ${warning}`);
for (const failure of failures) console.log(`FAIL  ${failure}`);

console.log('');
if (failures.length > 0) {
  console.log(`NOT READY: ${failures.length} failure(s).`);
  process.exit(1);
}

console.log('READY for the human-gated release sequence.');
console.log('The hackathon window is open. Push/deploy/post/submit only with human approval.');
console.log('Next: follow the human-gated steps in docs/DEPLOYMENT.md and the submission notes kept locally.');
