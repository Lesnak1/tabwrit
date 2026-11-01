/**
 * Prints the last real NEAR testnet Attack Lab report. No network, keys or
 * browser are required. To re-run the transactions, use `pnpm testnet:e2e`.
 */
import fs from 'node:fs';
import path from 'node:path';

type Row = {
  id: string;
  scenario: string;
  expected: string;
  actual: string;
  tx?: string;
  pass: boolean;
};

type Report = {
  network: string;
  vault: string;
  token: string;
  generatedAt: string;
  results: Row[];
};

const file = path.resolve('docs/evidence/testnet-e2e.json');
if (!fs.existsSync(file)) {
  console.error('No evidence file found at docs/evidence/testnet-e2e.json');
  console.error('Run `pnpm testnet:e2e` against a funded testnet deployment first.');
  process.exit(1);
}

const report = JSON.parse(fs.readFileSync(file, 'utf8')) as Report;
const passed = report.results.filter((r) => r.pass).length;

console.log('='.repeat(100));
console.log(' TABWRIT — LAST VERIFIED NEAR TESTNET ATTACK LAB');
console.log(` Network: ${report.network}`);
console.log(` Vault:   ${report.vault}`);
console.log(` Token:   ${report.token}`);
console.log(` Run at:  ${report.generatedAt}`);
console.log('='.repeat(100));
console.log();
console.log(
  '| #    | Scenario                                             | Expected                     | Actual                       | Result |'
);
console.log(
  '|:-----|:-----------------------------------------------------|:-----------------------------|:-----------------------------|:-------|'
);

for (const row of report.results) {
  console.log(
    `| ${row.id.padEnd(4)} | ${row.scenario.slice(0, 52).padEnd(52)} | ${String(
      row.expected
    )
      .slice(0, 28)
      .padEnd(28)} | ${String(row.actual)
      .slice(0, 28)
      .padEnd(28)} | ${row.pass ? 'PASS' : 'FAIL'}   |`
  );
}

console.log();
console.log(' Verifiable transactions:');
for (const row of report.results) {
  if (row.tx) {
    console.log(`  [${row.id}] https://testnet.nearblocks.io/txns/${row.tx}`);
  }
}
console.log();
console.log(` RESULT: ${passed}/${report.results.length} real on-chain checks passed.`);
console.log('='.repeat(100));

if (passed !== report.results.length) process.exit(1);
