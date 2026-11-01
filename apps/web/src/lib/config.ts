/**
 * Public runtime configuration for the browser.
 *
 * The defaults point at the live testnet deployment created by
 * scripts/deploy-testnet.ts. Override them with NEXT_PUBLIC_* variables
 * for a different deployment.
 */
export type NearNetwork = 'testnet' | 'mainnet';

export const NETWORK: NearNetwork =
  (process.env.NEXT_PUBLIC_NEAR_NETWORK as NearNetwork) || 'testnet';
export const IS_TESTNET = NETWORK === 'testnet';
export const RPC_URL =
  process.env.NEXT_PUBLIC_NEAR_RPC_URL || 'https://test.rpc.fastnear.com';

export const VAULT_ID =
  process.env.NEXT_PUBLIC_TAB_VAULT_CONTRACT_ID || 'tab-vault.testnet';
export const TOKEN_ID =
  process.env.NEXT_PUBLIC_TAB_TOKEN_ID || 'tab-usdc.testnet';
export const TOKEN_SYMBOL =
  process.env.NEXT_PUBLIC_TAB_TOKEN_SYMBOL || (IS_TESTNET ? 'tUSDC' : 'USDC');
export const TOKEN_DECIMALS = Number(
  process.env.NEXT_PUBLIC_TAB_TOKEN_DECIMALS || 6
);

export const MERCHANT_ACCOUNT =
  process.env.NEXT_PUBLIC_MERCHANT_ACCOUNT_ID || 'tab-merchant.testnet';
export const DEMO_ACCOUNT =
  process.env.NEXT_PUBLIC_DEMO_ACCOUNT_ID || 'tab-demo.testnet';
export const AGENT_ACCOUNT =
  process.env.NEXT_PUBLIC_AGENT_ACCOUNT_ID || 'tab-agent.testnet';
export const MERCHANT_INVOICE_AMOUNT =
  process.env.NEXT_PUBLIC_MERCHANT_INVOICE_AMOUNT || '10000000';

export const MIN_TAB_STORAGE_YOCTO =
  process.env.NEXT_PUBLIC_MIN_TAB_STORAGE_YOCTO || '10000000000000000000000';

export const EXPLORER =
  NETWORK === 'mainnet'
    ? 'https://nearblocks.io'
    : 'https://testnet.nearblocks.io';

export const KEEPER_URL =
  process.env.NEXT_PUBLIC_KEEPER_URL || '/api';

export const CONTRACT_URL = `${EXPLORER}/address/${VAULT_ID}`;
export const TOKEN_URL = `${EXPLORER}/address/${TOKEN_ID}`;
export const TxLink = (hash: string) => `${EXPLORER}/txns/${hash}`;
