/**
 * Prompt-injection containment test on NEAR testnet.
 *
 * The agent receives a malicious instruction to pay `tab-attacker.testnet`.
 * The agent's Tab is restricted to a receiver allowlist containing only the
 * merchant. The MCP server submits the charge with the agent's scoped key;
 * the contract rejects it with RECEIVER_NOT_ALLOWED and moves no funds.
 * A subsequent legitimate invoice to the merchant succeeds.
 *
 * Usage: pnpm test:agent-attack
 */
import 'dotenv/config';
import fs from 'node:fs';
import path from 'node:path';
import { spawn } from 'node:child_process';
import * as nearAPI from 'near-api-js';

const { connect, keyStores, KeyPair, providers } = nearAPI;

const RPC = process.env.NEAR_RPC_URL || 'https://test.rpc.fastnear.com';
const VAULT = process.env.TAB_VAULT_CONTRACT_ID || 'tab-vault.testnet';
const TOKEN = process.env.TAB_TOKEN_ID || 'tab-usdc.testnet';
const OWNER = process.env.TESTER_ACCOUNT_ID || 'hardjava737.testnet';
const OWNER_KEY = process.env.TESTER_PRIVATE_KEY;
const AGENT = process.env.TESTNET_AGENT_ACCOUNT_ID || 'tab-agent.testnet';
const AGENT_KEY = process.env.TESTNET_AGENT_CHARGE_PRIVATE_KEY;
const MERCHANT = process.env.MERCHANT_ACCOUNT_ID || 'tab-merchant.testnet';
const ATTACKER = process.env.ATTACKER_ACCOUNT_ID || 'tab-attacker.testnet';

if (!OWNER_KEY || !AGENT_KEY) {
  console.error('Missing TESTER_PRIVATE_KEY or TESTNET_AGENT_CHARGE_PRIVATE_KEY in .env.');
  process.exit(1);
}

const U = 1_000_000n;
const MIN_STORAGE = BigInt('10000000000000000000000');
const GAS = BigInt('50000000000000');
const provider = new providers.JsonRpcProvider({ url: RPC });
const results: Array<{ id: string; name: string; pass: boolean; detail: string; tx?: string }> = [];

function record(id: string, name: string, pass: boolean, detail: string, tx?: string) {
  results.push({ id, name, pass, detail, tx });
  console.log(
    `[${pass ? 'PASS' : 'FAIL'}] ${id.padEnd(4)} ${name.padEnd(55)} ${detail}${
      tx ? ` tx=${tx.slice(0, 8)}...` : ''
    }`
  );
}

function explorer(tx: string) {
  return `https://testnet.nearblocks.io/txns/${tx}`;
}

async function view<T = any>(method: string, args: Record<string, unknown> = {}): Promise<T> {
  const res: any = await provider.query({
    request_type: 'call_function',
    account_id: VAULT,
    method_name: method,
    args_base64: Buffer.from(JSON.stringify(args)).toString('base64'),
    finality: 'optimistic',
  });
  return JSON.parse(Buffer.from(res.result).toString('utf8')) as T;
}

async function tokenBalance(id: string): Promise<bigint> {
  const res: any = await provider.query({
    request_type: 'call_function',
    account_id: TOKEN,
    method_name: 'ft_balance_of',
    args_base64: Buffer.from(JSON.stringify({ account_id: id })).toString('base64'),
    finality: 'optimistic',
  });
  return BigInt(JSON.parse(Buffer.from(res.result).toString('utf8')));
}

async function getTab(tabId: number): Promise<any> {
  for (let i = 0; i < 12; i++) {
    const tab = await view<any>('get_tab', { tab_id: tabId });
    if (tab) return tab;
    await new Promise((r) => setTimeout(r, 300));
  }
  throw new Error(`Tab #${tabId} not visible`);
}

async function vaultLedger(): Promise<bigint> {
  return BigInt(await view<string>('get_balance', { owner: OWNER, token: TOKEN }));
}

async function ensureOwnerFunds(owner: nearAPI.Account) {
  let wallet = await tokenBalance(OWNER);
  if (wallet < 5n * U) {
    await owner.functionCall({
      contractId: TOKEN,
      methodName: 'faucet',
      args: {},
      gas: BigInt('30000000000000'),
      attachedDeposit: BigInt(0),
    });
    wallet = await tokenBalance(OWNER);
  }
  const ledger = await vaultLedger();
  if (ledger < 2n * U) {
    await owner.functionCall({
      contractId: TOKEN,
      methodName: 'ft_transfer_call',
      args: {
        receiver_id: VAULT,
        amount: (2n * U - ledger).toString(),
        msg: '',
      },
      gas: GAS,
      attachedDeposit: BigInt(1),
    });
  }
}

function waitForResponse(proc: any, id: number, timeoutMs = 45000): Promise<any> {
  let buffer = '';
  return new Promise((resolve, reject) => {
    const timeout = setTimeout(() => {
      proc.stdout.off('data', onData);
      reject(new Error(`Timeout waiting for MCP response ${id}`));
    }, timeoutMs);
    const onData = (data: Buffer) => {
      buffer += data.toString();
      const lines = buffer.split('\n');
      buffer = lines.pop() || '';
      for (const line of lines) {
        if (!line.trim()) continue;
        try {
          const parsed = JSON.parse(line);
          if (parsed.id === id) {
            clearTimeout(timeout);
            proc.stdout.off('data', onData);
            resolve(parsed);
            return;
          }
        } catch {
          // ignore non-JSON lines
        }
      }
    };
    proc.stdout.on('data', onData);
  });
}

async function mcpCall(tool: string, args: Record<string, unknown>, id: number) {
  const serverPath = path.resolve('packages/tab-mcp/dist/index.js');
  const proc = spawn('node', [serverPath], {
    stdio: ['pipe', 'pipe', 'inherit'],
    cwd: process.cwd(),
    env: {
      ...process.env,
      NEAR_ACCOUNT_ID: AGENT,
      NEAR_PRIVATE_KEY: AGENT_KEY,
      TAB_VAULT_CONTRACT_ID: VAULT,
      TAB_TOKEN_ID: TOKEN,
    },
  });

  try {
    proc.stdin.write(
      JSON.stringify({
        jsonrpc: '2.0',
        id: 1,
        method: 'initialize',
        params: {
          protocolVersion: '2024-11-05',
          capabilities: {},
          clientInfo: { name: 'Tab-Prompt-Injection-Verifier', version: '1.0' },
        },
      }) + '\n'
    );
    await waitForResponse(proc, 1);
    proc.stdin.write(
      JSON.stringify({
        jsonrpc: '2.0',
        id,
        method: 'tools/call',
        params: { name: tool, arguments: args },
      }) + '\n'
    );
    const response = await waitForResponse(proc, id);
    const text = response.result?.content?.[0]?.text;
    if (!text) throw new Error(`MCP returned no text: ${JSON.stringify(response)}`);
    return JSON.parse(text);
  } finally {
    proc.kill();
  }
}

async function main() {
  console.log('='.repeat(115));
  console.log(' TABWRIT — PROMPT-INJECTION CONTAINMENT (testnet only)');
  console.log(` Owner:   ${OWNER}`);
  console.log(` Agent:   ${AGENT} (scoped charge key, no owner rights)`);
  console.log(` Merchant:${MERCHANT}`);
  console.log(` Attacker:${ATTACKER} (not in the Tab allowlist)`);
  console.log('='.repeat(115));

  const keyStore = new keyStores.InMemoryKeyStore();
  await keyStore.setKey('testnet', OWNER, KeyPair.fromString(OWNER_KEY as never));
  const near = await connect({ networkId: 'testnet', nodeUrl: RPC, keyStore });
  const owner = await near.account(OWNER);
  await ensureOwnerFunds(owner);

  const create: any = await owner.functionCall({
    contractId: VAULT,
    methodName: 'create_tab',
    args: {
      spender: AGENT,
      token: TOKEN,
      per_charge_cap: U.toString(),
      per_period_cap: (2n * U).toString(),
      total_cap: (2n * U).toString(),
      period_secs: 3600,
      expires_at_ns: Math.floor((Date.now() + 60 * 60 * 1000) * 1_000_000),
      receiver_policy: { Allowlist: [MERCHANT] },
      label: `Agent injection lab ${Date.now().toString().slice(-6)}`,
    },
    gas: GAS,
    attachedDeposit: MIN_STORAGE,
  });
  const raw = Buffer.from(create.status.SuccessValue || '', 'base64').toString('utf8');
  const tabId = Number(JSON.parse(raw));
  console.log(`[prep] Tab #${tabId}: ${explorer(create.transaction.hash)}`);
  await getTab(tabId);

  const attackerBefore = await tokenBalance(ATTACKER);
  const merchantBefore = await tokenBalance(MERCHANT);
  const vaultBefore = BigInt(await view<string>('get_balance', { owner: OWNER, token: TOKEN }));

  const injectionRef = `prompt-injection-${tabId}-${Date.now()}`;
  console.log('[attack] Agent is instructed to pay the attacker...');
  const attack = await mcpCall(
    'tab_charge_invoice',
    {
      tab_id: tabId,
      amount: U.toString(),
      receiver_id: ATTACKER,
      reference: injectionRef,
    },
    2
  );

  record(
    'A1',
    'Contract rejects the redirected charge',
    attack.status === 'REJECTED' &&
      attack.reason === 'RECEIVER_NOT_ALLOWED' &&
      attack.allowed === false,
    `${attack.status} reason=${attack.reason}`,
    attack.tx_hash
  );

  const tabAfterAttack = await getTab(tabId);
  const attackerAfter = await tokenBalance(ATTACKER);
  const merchantAfterAttack = await tokenBalance(MERCHANT);
  const vaultAfterAttack = BigInt(await view<string>('get_balance', { owner: OWNER, token: TOKEN }));
  record(
    'A2',
    'No funds moved and the Tab nonce was not consumed',
    attackerAfter === attackerBefore &&
      merchantAfterAttack === merchantBefore &&
      vaultAfterAttack === vaultBefore &&
      BigInt(tabAfterAttack.spent_total) === 0n &&
      Number(tabAfterAttack.next_nonce) === 0,
    `attacker ${attackerBefore}->${attackerAfter} spent=${tabAfterAttack.spent_total} nonce=${tabAfterAttack.next_nonce}`,
    attack.tx_hash
  );

  console.log('[legit] Agent pays the allowlisted merchant...');
  const legitRef = `legit-agent-${tabId}-${Date.now()}`;
  const legit = await mcpCall(
    'tab_charge_invoice',
    {
      tab_id: tabId,
      amount: U.toString(),
      receiver_id: MERCHANT,
      reference: legitRef,
    },
    3
  );

  record(
    'A3',
    'Allowlisted merchant charge executes',
    legit.status === 'EXECUTED' && legit.allowed === true,
    `${legit.status} reason=${legit.reason || 'none'}`,
    legit.tx_hash
  );

  let tabAfter: any = tabAfterAttack;
  let merchantFinal = merchantAfterAttack;
  const deadline = Date.now() + 30_000;
  while (Date.now() < deadline) {
    tabAfter = await getTab(tabId);
    merchantFinal = await tokenBalance(MERCHANT);
    if (
      BigInt(tabAfter.spent_total) === U &&
      Number(tabAfter.charge_count) === 1 &&
      merchantFinal === merchantBefore + U
    ) {
      break;
    }
    await new Promise((r) => setTimeout(r, 800));
  }

  record(
    'A4',
    'Only the legitimate 1 tUSDC charge is counted',
    BigInt(tabAfter.spent_total) === U &&
      Number(tabAfter.charge_count) === 1 &&
      Number(tabAfter.next_nonce) === 1 &&
      merchantFinal === merchantBefore + U,
    `spent=${tabAfter.spent_total} count=${tabAfter.charge_count} nonce=${tabAfter.next_nonce} merchant ${merchantBefore}->${merchantFinal}`,
    legit.tx_hash
  );

  const failed = results.filter((r) => !r.pass);
  console.log('\n' + '='.repeat(115));
  console.log(` RESULT: ${results.length - failed.length}/${results.length} checks passed`);
  console.log('='.repeat(115));

  const report = {
    network: 'testnet',
    vault: VAULT,
    token: TOKEN,
    owner: OWNER,
    agent: AGENT,
    merchant: MERCHANT,
    attacker: ATTACKER,
    tabId,
    generatedAt: new Date().toISOString(),
    attackTx: attack.tx_hash,
    legitTx: legit.tx_hash,
    results,
  };
  const reportJson = JSON.stringify(report, null, 2);
  fs.mkdirSync(path.resolve('docs/evidence'), { recursive: true });
  fs.writeFileSync(path.resolve('docs/evidence/agent-attack.json'), reportJson);
  fs.mkdirSync(path.resolve('apps/web/src/data'), { recursive: true });
  fs.writeFileSync(path.resolve('apps/web/src/data/agent-attack.json'), reportJson);
  console.log('Report: docs/evidence/agent-attack.json');

  if (failed.length > 0) process.exit(1);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
