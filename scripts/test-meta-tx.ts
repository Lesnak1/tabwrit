/**
 * Real NEP-366 gasless charge test on NEAR testnet.
 *
 * Flow:
 *   1. The owner creates a Tab for the merchant.
 *   2. The merchant signs a `charge` DelegateAction off-chain with its
 *      Function-Call key scoped to `<vault>::charge`.
 *   3. The keeper's relayer submits the delegate and pays the gas.
 *   4. The test verifies the token movement, the Tab counters, the merchant's
 *      unchanged NEAR balance and the relayer's gas spend.
 *
 * It also verifies that the relayer rejects:
 *   - a replay of the same delegate,
 *   - a tampered delegate signature,
 *   - a delegate signed by the merchant's FullAccess key.
 *
 * Usage: pnpm test:meta
 */
import 'dotenv/config';
import fs from 'node:fs';
import path from 'node:path';
import * as nearAPI from 'near-api-js';
import {
  createChargeDelegate,
  getAccessKeyNextNonce,
  getLatestBlockHeight,
  relayChargeDelegate,
} from '../packages/tab-sdk/src/meta-tx.js';

const { connect, keyStores, KeyPair, providers } = nearAPI;

const RPC = process.env.NEAR_RPC_URL || 'https://test.rpc.fastnear.com';
const VAULT = process.env.TAB_VAULT_CONTRACT_ID || 'tab-vault.testnet';
const TOKEN = process.env.TAB_TOKEN_ID || 'tab-usdc.testnet';
const OWNER = process.env.TESTER_ACCOUNT_ID || 'hardjava737.testnet';
const OWNER_KEY = process.env.TESTER_PRIVATE_KEY;
const MERCHANT = process.env.MERCHANT_ACCOUNT_ID || 'tab-merchant.testnet';
const MERCHANT_KEY = process.env.TESTNET_MERCHANT_CHARGE_PRIVATE_KEY;
const MERCHANT_FULL_KEY = process.env.TESTNET_MERCHANT_PRIVATE_KEY;
const AGENT = process.env.TESTNET_AGENT_ACCOUNT_ID || 'tab-agent.testnet';
const AGENT_KEY = process.env.TESTNET_AGENT_CHARGE_PRIVATE_KEY;
const RELAYER = process.env.RELAYER_ACCOUNT_ID || 'tab-relayer.testnet';
const RELAYER_KEY = process.env.RELAYER_PRIVATE_KEY;
const RELAYER_API_KEY = process.env.RELAYER_API_KEY;
const RELAYER_URL = process.env.RELAYER_URL || 'http://localhost:4000';

if (
  !OWNER_KEY ||
  !MERCHANT_KEY ||
  !MERCHANT_FULL_KEY ||
  !AGENT_KEY ||
  !RELAYER_KEY ||
  !RELAYER_API_KEY
) {
  console.error(
    'Missing TESTER_PRIVATE_KEY, TESTNET_MERCHANT_CHARGE_PRIVATE_KEY, TESTNET_MERCHANT_PRIVATE_KEY, TESTNET_AGENT_CHARGE_PRIVATE_KEY, RELAYER_PRIVATE_KEY or RELAYER_API_KEY in .env.'
  );
  process.exit(1);
}

const U = 1_000_000n;
const MIN_STORAGE = BigInt('10000000000000000000000');
const GAS_CALL = BigInt('50000000000000');
const provider = new providers.JsonRpcProvider({ url: RPC });

const results: Array<{
  id: string;
  name: string;
  pass: boolean;
  detail: string;
  tx?: string;
}> = [];

function record(id: string, name: string, pass: boolean, detail: string, tx?: string) {
  results.push({ id, name, pass, detail, tx });
  console.log(
    `[${pass ? 'PASS' : 'FAIL'}] ${id.padEnd(4)} ${name.padEnd(52)} ${detail}${
      tx ? ` tx=${tx.slice(0, 8)}...` : ''
    }`
  );
}

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

async function nearBalance(account: string): Promise<bigint> {
  const state = await provider.query({
    request_type: 'view_account',
    finality: 'final',
    account_id: account,
  });
  return BigInt((state as any).amount);
}

async function getTab(tabId: number): Promise<any> {
  for (let i = 0; i < 12; i++) {
    const tab = await view<any>(VAULT, 'get_tab', { tab_id: tabId });
    if (tab) return tab;
    await new Promise((r) => setTimeout(r, 300));
  }
  throw new Error(`Tab #${tabId} not visible`);
}

function decodeValue(outcome: any): any {
  const status = outcome?.status;
  if (status && typeof status === 'object' && 'SuccessValue' in status) {
    const raw = Buffer.from(status.SuccessValue, 'base64').toString('utf8');
    if (!raw) return null;
    try {
      return JSON.parse(raw);
    } catch {
      return raw;
    }
  }
  return null;
}

async function accountFor(accountId: string, privateKey: string) {
  const keyStore = new keyStores.InMemoryKeyStore();
  await keyStore.setKey('testnet', accountId, KeyPair.fromString(privateKey as never));
  const near = await connect({ networkId: 'testnet', nodeUrl: RPC, keyStore });
  return near.account(accountId);
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
  const ledger = await vaultBalance(OWNER);
  if (ledger < 2n * U) {
    await owner.functionCall({
      contractId: TOKEN,
      methodName: 'ft_transfer_call',
      args: { receiver_id: VAULT, amount: (3n * U).toString(), msg: '' },
      gas: GAS_CALL,
      attachedDeposit: BigInt(1),
    });
  }
}

async function createTab(owner: nearAPI.Account): Promise<number> {
  const outcome: any = await owner.functionCall({
    contractId: VAULT,
    methodName: 'create_tab',
    args: {
      spender: MERCHANT,
      token: TOKEN,
      per_charge_cap: (1n * U).toString(),
      per_period_cap: (3n * U).toString(),
      total_cap: (3n * U).toString(),
      period_secs: 3600,
      expires_at_ns: Math.floor((Date.now() + 60 * 60 * 1000) * 1_000_000),
      receiver_policy: { Allowlist: [MERCHANT] },
      label: `Gasless meta-tx ${Date.now().toString().slice(-6)}`,
    },
    gas: GAS_CALL,
    attachedDeposit: MIN_STORAGE,
  });
  const tabId = Number(decodeValue(outcome));
  if (!Number.isInteger(tabId) || tabId <= 0) {
    throw new Error(`create_tab returned ${JSON.stringify(decodeValue(outcome))}`);
  }
  console.log(`[prep] Tab #${tabId}: ${explorer(outcome.transaction.hash)}`);
  return tabId;
}

async function createAgentTab(owner: nearAPI.Account): Promise<number> {
  const outcome: any = await owner.functionCall({
    contractId: VAULT,
    methodName: 'create_tab',
    args: {
      spender: AGENT,
      token: TOKEN,
      per_charge_cap: (1n * U).toString(),
      per_period_cap: (2n * U).toString(),
      total_cap: (2n * U).toString(),
      period_secs: 3600,
      expires_at_ns: Math.floor((Date.now() + 60 * 60 * 1000) * 1_000_000),
      receiver_policy: { Allowlist: [MERCHANT] },
      label: `Gasless agent ${Date.now().toString().slice(-6)}`,
    },
    gas: GAS_CALL,
    attachedDeposit: MIN_STORAGE,
  });
  const tabId = Number(decodeValue(outcome));
  if (!Number.isInteger(tabId) || tabId <= 0) {
    throw new Error(`create_tab returned ${JSON.stringify(decodeValue(outcome))}`);
  }
  console.log(`[prep] agent Tab #${tabId}: ${explorer(outcome.transaction.hash)}`);
  return tabId;
}

async function getAccessKey(accountId: string, publicKey: string): Promise<any> {
  return provider.query({
    request_type: 'view_access_key',
    finality: 'final',
    account_id: accountId,
    public_key: publicKey,
  });
}

async function fetchTx(hash: string): Promise<any> {
  return provider.sendJsonRpc('tx', {
    tx_hash: hash,
    sender_account_id: RELAYER,
    wait_until: 'FINAL',
  });
}

async function main() {
  console.log('='.repeat(110));
  console.log(' TABWRIT — NEP-366 GASLESS MERCHANT + AGENT CHARGE (testnet only)');
  console.log(` Owner:    ${OWNER}`);
  console.log(` Merchant: ${MERCHANT}`);
  console.log(` Agent:    ${AGENT}`);
  console.log(` Relayer:  ${RELAYER}`);
  console.log(` Vault:    ${VAULT}`);
  console.log('='.repeat(110));

  const owner = await accountFor(OWNER, OWNER_KEY as string);
  await ensureOwnerFunds(owner);
  const tabId = await createTab(owner);
  const tab = await getTab(tabId);

  const merchantKeyPair = KeyPair.fromString(MERCHANT_KEY as never);
  const merchantPublicKey = merchantKeyPair.getPublicKey().toString();
  const accessKey = await getAccessKey(MERCHANT, merchantPublicKey);
  const permission = accessKey.permission;
  const scoped =
    typeof permission === 'object' &&
    permission.FunctionCall?.receiver_id === VAULT &&
    permission.FunctionCall?.method_names?.includes('charge');

  record(
    'M1',
    'Merchant delegate key is a scoped Function-Call key',
    Boolean(scoped),
    `${merchantPublicKey.slice(0, 18)}… receiver=${permission?.FunctionCall?.receiver_id || permission}`,
  );

  const accessKeyNonce = await getAccessKeyNextNonce(provider, MERCHANT, merchantPublicKey);
  const height = await getLatestBlockHeight(provider);
  const signed = createChargeDelegate({
    senderId: MERCHANT,
    privateKey: MERCHANT_KEY as string,
    vaultId: VAULT,
    tabId,
    amount: (1n * U).toString(),
    receiverId: MERCHANT,
    reference: `gasless-${tabId}-${Date.now()}`,
    tabNonce: Number(tab.next_nonce),
    accessKeyNonce,
    maxBlockHeight: height + 80,
  });

  const merchantNearBefore = await nearBalance(MERCHANT);
  const relayerNearBefore = await nearBalance(RELAYER);
  const merchantTokenBefore = await tokenBalance(MERCHANT);
  const ledgerBefore = await vaultBalance(OWNER);

  console.log('[run] Relaying the signed delegate (relayer pays gas)...');
  const relay = await relayChargeDelegate({
    keeperUrl: RELAYER_URL,
    apiKey: RELAYER_API_KEY,
    delegate: signed.delegate,
  });

  record(
    'M2',
    'Relayer submitted the delegate',
    Boolean(relay.txHash) && relay.gasPaidBy === 'relayer',
    `${relay.status} relayer=${relay.relayer}${relay.reason ? ` reason=${relay.reason}` : ''}`,
    relay.txHash,
  );

  let after: any = null;
  let merchantTokenAfter = merchantTokenBefore;
  let ledgerAfter = ledgerBefore;
  const deadline = Date.now() + 30_000;
  while (Date.now() < deadline) {
    after = await getTab(tabId);
    merchantTokenAfter = await tokenBalance(MERCHANT);
    ledgerAfter = await vaultBalance(OWNER);
    if (
      BigInt(after.spent_total) === 1n * U &&
      Number(after.charge_count) === 1 &&
      merchantTokenAfter === merchantTokenBefore + U &&
      ledgerAfter === ledgerBefore - U
    ) {
      break;
    }
    await new Promise((r) => setTimeout(r, 800));
  }

  record(
    'M3',
    'Charge executed and token moved exactly once',
    relay.status === 'executed' &&
      BigInt(after.spent_total) === 1n * U &&
      Number(after.charge_count) === 1 &&
      merchantTokenAfter === merchantTokenBefore + U &&
      ledgerAfter === ledgerBefore - U,
    `spent=${after.spent_total} count=${after.charge_count} merchant ${merchantTokenBefore}->${merchantTokenAfter} ledger ${ledgerBefore}->${ledgerAfter}`,
    relay.txHash,
  );

  const merchantNearAfter = await nearBalance(MERCHANT);
  const relayerNearAfter = await nearBalance(RELAYER);
  record(
    'M4',
    'Merchant NEAR balance unchanged',
    merchantNearAfter === merchantNearBefore,
    `${merchantNearBefore} -> ${merchantNearAfter}`,
  );
  record(
    'M5',
    'Relayer paid the gas',
    relayerNearAfter < relayerNearBefore,
    `${relayerNearBefore} -> ${relayerNearAfter} (${relayerNearBefore - relayerNearAfter} yocto)`,
  );

  try {
    const tx: any = await fetchTx(relay.txHash);
    record(
      'M6',
      'Outer transaction signer is the relayer',
      tx?.transaction?.signer_id === RELAYER && tx?.transaction?.receiver_id === MERCHANT,
      `signer=${tx?.transaction?.signer_id} receiver=${tx?.transaction?.receiver_id}`,
      relay.txHash,
    );
  } catch (err: any) {
    record('M6', 'Outer transaction signer is the relayer', false, String(err?.message || err));
  }

  // Replay: the access-key nonce was consumed, so the keeper must reject it.
  try {
    const replay = await relayChargeDelegate({
      keeperUrl: RELAYER_URL,
      apiKey: RELAYER_API_KEY,
      delegate: signed.delegate,
    });
    record('M7', 'Replayed delegate is rejected', false, `unexpected ${replay.status}`, replay.txHash);
  } catch (err: any) {
    record(
      'M7',
      'Replayed delegate is rejected',
      err?.code === 'DELEGATE_NONCE_INVALID' || /nonce/i.test(String(err?.message)),
      `${err?.code || 'ERROR'}: ${String(err?.message).slice(0, 80)}`
    );
  }

  // Tamper: change the receiver in the signed args. The signature no longer
  // matches the delegate action and the relayer must reject it.
  const tampered = JSON.parse(JSON.stringify(signed.delegate));
  const tamperedArgs = JSON.parse(
    Buffer.from(tampered.actions[0].functionCall.args, 'base64').toString('utf8')
  );
  tamperedArgs.receiver_id = 'tab-attacker.testnet';
  tampered.actions[0].functionCall.args = Buffer.from(
    JSON.stringify(tamperedArgs)
  ).toString('base64');
  try {
    const bad = await relayChargeDelegate({
      keeperUrl: RELAYER_URL,
      apiKey: RELAYER_API_KEY,
      delegate: tampered,
    });
    record('M8', 'Tampered signature is rejected', false, `unexpected ${bad.status}`, bad.txHash);
  } catch (err: any) {
    record(
      'M8',
      'Tampered signature is rejected',
      err?.code === 'INVALID_SIGNATURE' || /signature/i.test(String(err?.message)),
      `${err?.code || 'ERROR'}: ${String(err?.message).slice(0, 80)}`
    );
  }

  // FullAccess key: the relayer must refuse it even though the signature is
  // valid and the account owns the key.
  const fullAccessNonce = await getAccessKeyNextNonce(
    provider,
    MERCHANT,
    KeyPair.fromString(MERCHANT_FULL_KEY as never).getPublicKey().toString()
  );
  const fullAccessSigned = createChargeDelegate({
    senderId: MERCHANT,
    privateKey: MERCHANT_FULL_KEY as string,
    vaultId: VAULT,
    tabId,
    amount: (1n * U).toString(),
    receiverId: MERCHANT,
    reference: `fullaccess-${tabId}`,
    tabNonce: Number(after.next_nonce),
    accessKeyNonce: fullAccessNonce,
    maxBlockHeight: (await getLatestBlockHeight(provider)) + 80,
  });
  try {
    const bad = await relayChargeDelegate({
      keeperUrl: RELAYER_URL,
      apiKey: RELAYER_API_KEY,
      delegate: fullAccessSigned.delegate,
    });
    record('M9', 'FullAccess key is refused by the relayer', false, `unexpected ${bad.status}`, bad.txHash);
  } catch (err: any) {
    record(
      'M9',
      'FullAccess key is refused by the relayer',
      err?.code === 'KEY_NOT_SCOPED',
      `${err?.code || 'ERROR'}: ${String(err?.message).slice(0, 80)}`
    );
  }

  // --- Agent gasless charge + prompt-injection redirect ---
  const agentTabId = await createAgentTab(owner);
  const agentTab = await getTab(agentTabId);
  const agentKeyPair = KeyPair.fromString(AGENT_KEY as never);
  const agentPublicKey = agentKeyPair.getPublicKey().toString();
  const agentAccessKey = await getAccessKey(AGENT, agentPublicKey);
  const agentPermission = agentAccessKey.permission;
  const agentScoped =
    typeof agentPermission === 'object' &&
    agentPermission.FunctionCall?.receiver_id === VAULT &&
    agentPermission.FunctionCall?.method_names?.includes('charge');

  const agentNearBefore = await nearBalance(AGENT);
  const merchantBeforeAgent = await tokenBalance(MERCHANT);
  const agentSigned = createChargeDelegate({
    senderId: AGENT,
    privateKey: AGENT_KEY as string,
    vaultId: VAULT,
    tabId: agentTabId,
    amount: (1n * U).toString(),
    receiverId: MERCHANT,
    reference: `agent-gasless-${agentTabId}-${Date.now()}`,
    tabNonce: Number(agentTab.next_nonce),
    accessKeyNonce: await getAccessKeyNextNonce(provider, AGENT, agentPublicKey),
    maxBlockHeight: (await getLatestBlockHeight(provider)) + 80,
  });
  const agentRelay = await relayChargeDelegate({
    keeperUrl: RELAYER_URL,
    apiKey: RELAYER_API_KEY,
    delegate: agentSigned.delegate,
  });

  let agentAfter: any = agentTab;
  let merchantAfterAgent = merchantBeforeAgent;
  const agentDeadline = Date.now() + 30_000;
  while (Date.now() < agentDeadline) {
    agentAfter = await getTab(agentTabId);
    merchantAfterAgent = await tokenBalance(MERCHANT);
    if (
      BigInt(agentAfter.spent_total) === 1n * U &&
      Number(agentAfter.charge_count) === 1 &&
      merchantAfterAgent === merchantBeforeAgent + U
    ) {
      break;
    }
    await new Promise((r) => setTimeout(r, 800));
  }

  record(
    'M10',
    'Agent signs a gasless charge; relayer executes it',
    agentScoped &&
      agentRelay.status === 'executed' &&
      BigInt(agentAfter.spent_total) === 1n * U &&
      Number(agentAfter.charge_count) === 1 &&
      merchantAfterAgent === merchantBeforeAgent + U,
    `scoped=${agentScoped} status=${agentRelay.status} spent=${agentAfter.spent_total}`,
    agentRelay.txHash
  );

  const agentNearAfter = await nearBalance(AGENT);
  record(
    'M11',
    'Agent NEAR balance unchanged; relayer paid gas',
    agentNearAfter === agentNearBefore,
    `${agentNearBefore} -> ${agentNearAfter}`,
  );

  const attackDelegate = createChargeDelegate({
    senderId: AGENT,
    privateKey: AGENT_KEY as string,
    vaultId: VAULT,
    tabId: agentTabId,
    amount: (1n * U).toString(),
    receiverId: 'tab-attacker.testnet',
    reference: `agent-prompt-injection-${agentTabId}`,
    tabNonce: Number(agentAfter.next_nonce),
    accessKeyNonce: await getAccessKeyNextNonce(provider, AGENT, agentPublicKey),
    maxBlockHeight: (await getLatestBlockHeight(provider)) + 80,
  });
  const attackRelay = await relayChargeDelegate({
    keeperUrl: RELAYER_URL,
    apiKey: RELAYER_API_KEY,
    delegate: attackDelegate.delegate,
  });
  const afterAttack = await getTab(agentTabId);
  const attackerBalance = await tokenBalance('tab-attacker.testnet');
  record(
    'M12',
    'Prompt-injected agent redirect is rejected on-chain',
    attackRelay.status === 'rejected' &&
      attackRelay.reason === 'RECEIVER_NOT_ALLOWED' &&
      attackerBalance === 0n &&
      BigInt(afterAttack.spent_total) === 1n * U &&
      Number(afterAttack.next_nonce) === 1,
    `status=${attackRelay.status} reason=${attackRelay.reason} attacker=${attackerBalance} nonce=${afterAttack.next_nonce}`,
    attackRelay.txHash
  );

  const failed = results.filter((r) => !r.pass);
  console.log('\n' + '='.repeat(110));
  console.log(` RESULT: ${results.length - failed.length}/${results.length} checks passed`);
  console.log('='.repeat(110));

  const report = {
    network: 'testnet',
    vault: VAULT,
    token: TOKEN,
    owner: OWNER,
    merchant: MERCHANT,
    agent: AGENT,
    relayer: RELAYER,
    tabId,
    agentTabId,
    merchantPublicKey,
    merchantKeyPermission: permission,
    agentPublicKey,
    agentKeyPermission: agentPermission,
    generatedAt: new Date().toISOString(),
    delegateHash: signed.delegateHash,
    relayTx: relay.txHash,
    explorer: explorer(relay.txHash),
    agentRelayTx: agentRelay.txHash,
    agentAttackTx: attackRelay.txHash,
    results,
  };
  const reportJson = JSON.stringify(report, null, 2);
  fs.mkdirSync(path.resolve('docs/evidence'), { recursive: true });
  fs.writeFileSync(path.resolve('docs/evidence/meta-tx.json'), reportJson);
  fs.mkdirSync(path.resolve('apps/web/src/data'), { recursive: true });
  fs.writeFileSync(path.resolve('apps/web/src/data/meta-tx.json'), reportJson);
  console.log('Report: docs/evidence/meta-tx.json');

  if (failed.length > 0) process.exit(1);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
