/**
 * Real AI-agent charge through the MCP server.
 *
 * 1. The demo owner creates a Tab whose spender is `tab-agent.testnet` and
 *    whose allowlist is the merchant.
 * 2. The script starts the MCP server (agent's scoped Function-Call key) and
 *    calls `tab_charge_invoice`.
 * 3. It verifies the Tab counters, the vault balance and the merchant's
 *    token balance on NEAR testnet.
 *
 * Usage: pnpm test:mcp:charge
 */
import 'dotenv/config';
import { spawn } from 'node:child_process';
import * as path from 'node:path';
import * as nearAPI from 'near-api-js';

const { connect, keyStores, KeyPair, providers } = nearAPI;

const RPC = process.env.NEAR_RPC_URL || 'https://test.rpc.fastnear.com';
const VAULT = process.env.TAB_VAULT_CONTRACT_ID || 'tab-vault.testnet';
const TOKEN = process.env.TAB_TOKEN_ID || 'tab-usdc.testnet';
const DEMO = process.env.TESTNET_DEMO_ACCOUNT_ID || 'tab-demo.testnet';
const DEMO_KEY = process.env.TESTNET_DEMO_PRIVATE_KEY;
const AGENT = process.env.TESTNET_AGENT_ACCOUNT_ID || 'tab-agent.testnet';
const MERCHANT = process.env.MERCHANT_ACCOUNT_ID || 'tab-merchant.testnet';

if (!DEMO_KEY) {
  console.error('Missing TESTNET_DEMO_PRIVATE_KEY in .env.');
  process.exit(1);
}

const UA = 1_000_000n; // 1 tUSDC
const MIN_STORAGE = BigInt('10000000000000000000000'); // 0.01 NEAR
const provider = new providers.JsonRpcProvider({ url: RPC });

function explorer(tx: string) {
  return `https://testnet.nearblocks.io/txns/${tx}`;
}

async function view<T = any>(contract: string, method: string, args: Record<string, unknown> = {}): Promise<T> {
  const res: any = await provider.query({
    request_type: 'call_function',
    account_id: contract,
    method_name: method,
    args_base64: Buffer.from(JSON.stringify(args)).toString('base64'),
    finality: 'optimistic',
  });
  return JSON.parse(Buffer.from(res.result).toString('utf8')) as T;
}

async function tokenBalance(account: string): Promise<bigint> {
  return BigInt(await view<string>(TOKEN, 'ft_balance_of', { account_id: account }));
}

async function vaultBalance(owner: string): Promise<bigint> {
  return BigInt(await view<string>(VAULT, 'get_balance', { owner, token: TOKEN }));
}

async function getTab(tabId: number): Promise<any> {
  for (let i = 0; i < 8; i++) {
    const tab = await view<any>(VAULT, 'get_tab', { tab_id: tabId });
    if (tab) return tab;
    await new Promise((r) => setTimeout(r, 250));
  }
  throw new Error(`Tab #${tabId} not visible on-chain`);
}

async function ownerAccount() {
  const keyStore = new keyStores.InMemoryKeyStore();
  await keyStore.setKey('testnet', DEMO, KeyPair.fromString(DEMO_KEY as never));
  const near = await connect({ networkId: 'testnet', nodeUrl: RPC, keyStore });
  return near.account(DEMO);
}

async function ensureFunds(owner: nearAPI.Account) {
  let wallet = await tokenBalance(DEMO);
  if (wallet < 20n * UA) {
    console.log('[prep] demo tUSDC low; calling the public faucet...');
    await owner.functionCall({
      contractId: TOKEN,
      methodName: 'faucet',
      args: {},
      gas: BigInt('30000000000000'),
      attachedDeposit: BigInt(0),
    });
    wallet = await tokenBalance(DEMO);
  }

  const vault = await vaultBalance(DEMO);
  if (vault < 3n * UA) {
    console.log('[prep] depositing 10 tUSDC into the demo vault...');
    const tx = await owner.functionCall({
      contractId: TOKEN,
      methodName: 'ft_transfer_call',
      args: { receiver_id: VAULT, amount: (10n * UA).toString(), msg: '' },
      gas: BigInt('50000000000000'),
      attachedDeposit: BigInt(1),
    });
    console.log(`[prep] deposit: ${explorer(tx.transaction.hash)}`);
  }
}

async function createAgentTab(owner: nearAPI.Account): Promise<number> {
  console.log(`[1/4] Creating a Tab for spender ${AGENT}...`);
  const outcome: any = await owner.functionCall({
    contractId: VAULT,
    methodName: 'create_tab',
    args: {
      spender: AGENT,
      token: TOKEN,
      per_charge_cap: UA.toString(),
      per_period_cap: (5n * UA).toString(),
      total_cap: (10n * UA).toString(),
      period_secs: 3600,
      expires_at_ns: Math.floor((Date.now() + 24 * 60 * 60 * 1000) * 1_000_000),
      receiver_policy: { Allowlist: [MERCHANT] },
      label: 'MCP agent API budget',
    },
    gas: BigInt('50000000000000'),
    attachedDeposit: MIN_STORAGE,
  });

  const raw = Buffer.from(outcome.status.SuccessValue || '', 'base64').toString('utf8');
  const tabId = Number(JSON.parse(raw));
  if (!Number.isInteger(tabId) || tabId <= 0) {
    throw new Error(`create_tab returned ${raw}`);
  }
  console.log(`[1/4] Tab #${tabId}: ${explorer(outcome.transaction.hash)}`);
  return tabId;
}

function waitForResponse(proc: any, id: number, timeoutMs = 30000): Promise<any> {
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

async function mcpCharge(tabId: number, reference: string) {
  const serverPath = path.resolve('packages/tab-mcp/dist/index.js');
  const proc = spawn('node', [serverPath], {
    stdio: ['pipe', 'pipe', 'inherit'],
    cwd: process.cwd(),
    env: process.env,
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
          clientInfo: { name: 'Tab-Agent-Charge-Verifier', version: '1.0' },
        },
      }) + '\n'
    );
    await waitForResponse(proc, 1);

    console.log('[2/4] Calling MCP tool tab_charge_invoice with the agent key...');
    proc.stdin.write(
      JSON.stringify({
        jsonrpc: '2.0',
        id: 2,
        method: 'tools/call',
        params: {
          name: 'tab_charge_invoice',
          arguments: {
            tab_id: tabId,
            amount: UA.toString(),
            receiver_id: MERCHANT,
            reference,
          },
        },
      }) + '\n'
    );

    const response = await waitForResponse(proc, 2);
    const text = response.result?.content?.[0]?.text;
    if (!text) throw new Error(`MCP returned no text: ${JSON.stringify(response)}`);
    const parsed = JSON.parse(text);
    if (response.result?.isError) throw new Error(text);
    console.log(`[2/4] MCP submitted nonce ${parsed.nonce}`);
    console.log(`[2/4] tx: ${parsed.explorer_url}`);
    return parsed;
  } finally {
    proc.kill();
  }
}

async function main() {
  console.log('='.repeat(80));
  console.log(' TABWRIT — REAL MCP AGENT CHARGE');
  console.log(` Vault: ${VAULT}`);
  console.log(` Agent: ${AGENT} (scoped charge key)`);
  console.log(` Merchant: ${MERCHANT}`);
  console.log('='.repeat(80));

  const owner = await ownerAccount();
  await ensureFunds(owner);

  const merchantBefore = await tokenBalance(MERCHANT);
  const vaultBefore = await vaultBalance(DEMO);

  const tabId = await createAgentTab(owner);
  await new Promise((r) => setTimeout(r, 1500));

  const reference = `mcp-agent-${Date.now()}`;
  const mcp = await mcpCharge(tabId, reference);

  console.log('[3/4] Waiting for the on-chain callback...');
  const deadline = Date.now() + 30000;
  let tab: any = null;
  let merchantAfter = merchantBefore;
  let vaultAfter = vaultBefore;
  while (Date.now() < deadline) {
    tab = await getTab(tabId);
    merchantAfter = await tokenBalance(MERCHANT);
    vaultAfter = await vaultBalance(DEMO);
    if (
      BigInt(tab.spent_total) === UA &&
      Number(tab.charge_count) === 1 &&
      merchantAfter === merchantBefore + UA &&
      vaultAfter === vaultBefore - UA
    ) {
      break;
    }
    await new Promise((r) => setTimeout(r, 1000));
  }

  const checks = [
    {
      name: 'Tab spent_total == 1 tUSDC',
      pass: BigInt(tab?.spent_total || '0') === UA,
      actual: tab?.spent_total,
    },
    {
      name: 'Tab charge_count == 1',
      pass: Number(tab?.charge_count) === 1,
      actual: tab?.charge_count,
    },
    {
      name: 'Tab next_nonce == 1',
      pass: Number(tab?.next_nonce) === 1,
      actual: tab?.next_nonce,
    },
    {
      name: 'vault ledger decreased by 1 tUSDC',
      pass: vaultAfter === vaultBefore - UA,
      actual: `${vaultBefore} -> ${vaultAfter}`,
    },
    {
      name: 'merchant received 1 tUSDC',
      pass: merchantAfter === merchantBefore + UA,
      actual: `${merchantBefore} -> ${merchantAfter}`,
    },
    {
      name: 'MCP returned a real tx hash',
      pass: typeof mcp.tx_hash === 'string' && mcp.tx_hash.length > 20,
      actual: mcp.tx_hash,
    },
  ];

  console.log('\n[4/4] Results:');
  for (const check of checks) {
    console.log(`  ${check.pass ? 'PASS' : 'FAIL'}  ${check.name} (${check.actual})`);
  }

  const failed = checks.filter((c) => !c.pass);
  console.log('\n' + '='.repeat(80));
  console.log(
    failed.length === 0
      ? ' REAL MCP AGENT CHARGE PASSED: the agent paid inside its Tab.'
      : ` MCP AGENT CHARGE FAILED: ${failed.length} check(s).`
  );
  console.log('='.repeat(80));

  if (failed.length > 0) process.exit(1);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
