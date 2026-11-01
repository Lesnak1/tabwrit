/**
 * Prints a live, read-only snapshot of the testnet deployment. No keys, no
 * writes. Use it to compare the UI with the chain.
 *
 * Usage: pnpm testnet:inspect
 */
import 'dotenv/config';
import * as nearAPI from 'near-api-js';

const RPC = process.env.NEAR_RPC_URL || 'https://test.rpc.fastnear.com';
const VAULT = process.env.TAB_VAULT_CONTRACT_ID || 'tab-vault.testnet';
const TOKEN = process.env.TAB_TOKEN_ID || 'tab-usdc.testnet';
const DEMO = process.env.TESTNET_DEMO_ACCOUNT_ID || 'tab-demo.testnet';
const MERCHANT = process.env.MERCHANT_ACCOUNT_ID || 'tab-merchant.testnet';
const AGENT = process.env.TESTNET_AGENT_ACCOUNT_ID || 'tab-agent.testnet';
const TESTER = process.env.TESTER_ACCOUNT_ID;
const RELAYER = process.env.RELAYER_ACCOUNT_ID || 'tab-relayer.testnet';

const provider = new nearAPI.providers.JsonRpcProvider({ url: RPC });

async function view(contract: string, method: string, args: Record<string, unknown> = {}) {
  const res: any = await provider.query({
    request_type: 'call_function',
    account_id: contract,
    method_name: method,
    args_base64: Buffer.from(JSON.stringify(args)).toString('base64'),
    finality: 'optimistic',
  });
  return JSON.parse(Buffer.from(res.result).toString('utf8'));
}

async function nearBalance(account: string): Promise<bigint> {
  const res: any = await provider.query({
    request_type: 'view_account',
    account_id: account,
    finality: 'final',
  });
  return BigInt(res.amount);
}

async function keys(account: string) {
  const res: any = await provider.query({
    request_type: 'view_access_key_list',
    account_id: account,
    finality: 'final',
  });
  return res.keys as Array<{ public_key: string; access_key: { permission: any } }>;
}

async function main() {
  const [
    meta,
    config,
    stats,
    demoWallet,
    merchantWallet,
    agentWallet,
    demoVault,
    testerWallet,
    testerVault,
    relayerNear,
    vaultKeys,
  ] = await Promise.all([
    view(TOKEN, 'ft_metadata'),
    view(VAULT, 'get_config'),
    view(VAULT, 'get_stats', { token: TOKEN }),
    view(TOKEN, 'ft_balance_of', { account_id: DEMO }),
    view(TOKEN, 'ft_balance_of', { account_id: MERCHANT }),
    view(TOKEN, 'ft_balance_of', { account_id: AGENT }),
    view(VAULT, 'get_balance', { owner: DEMO, token: TOKEN }),
    TESTER ? view(TOKEN, 'ft_balance_of', { account_id: TESTER }) : null,
    TESTER ? view(VAULT, 'get_balance', { owner: TESTER, token: TOKEN }) : null,
    nearBalance(RELAYER).catch(() => null),
    keys(VAULT),
  ]);

  console.log('='.repeat(78));
  console.log(' TABWRIT — LIVE TESTNET SNAPSHOT (read-only)');
  console.log('='.repeat(78));
  console.log(`Vault:   ${VAULT}  https://testnet.nearblocks.io/address/${VAULT}`);
  console.log(`Token:   ${TOKEN}  ${meta.symbol} (${meta.decimals} decimals)  https://testnet.nearblocks.io/address/${TOKEN}`);
  console.log(`Vault access keys: ${vaultKeys.length}${vaultKeys.length === 0 ? '  [LOCKED — immutable]' : '  [WARNING: keys remain]'}`);
  if (vaultKeys.length > 0) {
    for (const key of vaultKeys) console.log(`  ${key.public_key} -> ${JSON.stringify(key.access_key.permission)}`);
  }
  console.log('-'.repeat(78));
  console.log(`Demo owner wallet:   ${demoWallet} atomic (${Number(demoWallet) / 10 ** meta.decimals} ${meta.symbol})`);
  console.log(`Demo vault ledger:   ${demoVault} atomic (${Number(demoVault) / 10 ** meta.decimals} ${meta.symbol})`);
  console.log(`Merchant wallet:     ${merchantWallet} atomic (${Number(merchantWallet) / 10 ** meta.decimals} ${meta.symbol})`);
  console.log(`Agent wallet:        ${agentWallet} atomic (${Number(agentWallet) / 10 ** meta.decimals} ${meta.symbol})`);
  if (TESTER) {
    console.log(`Tester wallet:       ${testerWallet} atomic (${Number(testerWallet) / 10 ** meta.decimals} ${meta.symbol})  [${TESTER}]`);
    console.log(`Tester vault ledger: ${testerVault} atomic (${Number(testerVault) / 10 ** meta.decimals} ${meta.symbol})`);
  }
  if (relayerNear !== null) {
    console.log(`Relayer gas:         ${(Number(relayerNear) / 1e24).toFixed(4)} NEAR  [${RELAYER}]`);
  }
  console.log('-'.repeat(78));
  console.log(`Stats: ${stats.total_tabs} tabs, ${stats.total_charges} confirmed charges, ${stats.total_volume} atomic volume (${Number(stats.total_volume) / 10 ** meta.decimals} ${meta.symbol})`);
  console.log(`Allowed tokens: ${config.allowed_tokens.join(', ')}`);
  console.log(`Tab storage: ${config.min_tab_storage_yocto} yoctoNEAR; max ${config.max_tabs_per_owner} tabs/owner`);
  console.log('='.repeat(78));
  console.log('This snapshot is read-only. No key was used and no transaction was sent.');
}

main().catch((err) => {
  console.error(err.message || err);
  process.exit(1);
});
