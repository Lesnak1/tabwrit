import {
  RPC_URL,
  TOKEN_DECIMALS,
  TOKEN_ID,
  TOKEN_SYMBOL,
  VAULT_ID,
} from './config';

export type TabStatus = 'Active' | 'Paused' | 'Revoked';
export type ReceiverPolicy = 'Any' | { Allowlist: string[] };

export interface Tab {
  id: number;
  owner: string;
  spender: string;
  token: string;
  per_charge_cap: string;
  per_period_cap: string;
  total_cap: string;
  period_secs: number;
  start_ns: number;
  expires_at_ns: number;
  receiver_policy: ReceiverPolicy;
  status: TabStatus;
  spent_total: string;
  period_index: number;
  spent_in_period: string;
  charge_count: number;
  next_nonce: number;
  label: string;
}

export interface RemainingAllowance {
  remaining_in_period: string;
  remaining_total: string;
  current_period_index: number;
}

export interface VaultStats {
  token: string;
  total_tabs: number;
  total_charges: number;
  total_volume: string;
}

export interface VaultConfig {
  allowed_tokens: string[];
  min_tab_storage_yocto: string;
  max_tabs_per_owner: number;
  max_label_len: number;
  max_reference_len: number;
  max_allowlist_len: number;
}

export interface TokenMetadata {
  spec: string;
  name: string;
  symbol: string;
  decimals: number;
  icon?: string | null;
}

function encodeArgs(args: Record<string, unknown>): string {
  const bytes = new TextEncoder().encode(JSON.stringify(args));
  let binary = '';
  for (const byte of bytes) binary += String.fromCharCode(byte);
  return btoa(binary);
}

function decodeResult(bytes: number[]): string {
  return new TextDecoder().decode(Uint8Array.from(bytes));
}

export async function rpcView<T>(
  contractId: string,
  method: string,
  args: Record<string, unknown> = {}
): Promise<T> {
  const res = await fetch(RPC_URL, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      jsonrpc: '2.0',
      id: 'tab-web',
      method: 'query',
      params: {
        request_type: 'call_function',
        account_id: contractId,
        method_name: method,
        args_base64: encodeArgs(args),
        finality: 'optimistic',
      },
    }),
  });

  const json = await res.json();
  if (json.error) {
    throw new Error(json.error.message || 'NEAR RPC error');
  }
  const text = decodeResult(json.result?.result || []);
  return (text ? JSON.parse(text) : null) as T;
}

export async function getConfig(): Promise<VaultConfig> {
  return rpcView<VaultConfig>(VAULT_ID, 'get_config');
}

export async function getTokenMetadata(): Promise<TokenMetadata> {
  return rpcView<TokenMetadata>(TOKEN_ID, 'ft_metadata');
}

export async function getVaultBalance(
  owner: string,
  token: string = TOKEN_ID
): Promise<string> {
  return rpcView<string>(VAULT_ID, 'get_balance', {
    owner,
    token,
  });
}

export async function getWalletTokenBalance(owner: string): Promise<string> {
  return rpcView<string>(TOKEN_ID, 'ft_balance_of', { account_id: owner });
}

export async function getTabsByOwner(owner: string): Promise<Tab[]> {
  return rpcView<Tab[]>(VAULT_ID, 'list_tabs_by_owner', {
    owner,
    from_index: 0,
    limit: 100,
  });
}

export async function getTab(tabId: number): Promise<Tab | null> {
  return rpcView<Tab | null>(VAULT_ID, 'get_tab', { tab_id: tabId });
}

export async function getRemaining(tabId: number): Promise<RemainingAllowance> {
  return rpcView<RemainingAllowance>(VAULT_ID, 'get_remaining', {
    tab_id: tabId,
  });
}

export async function getStats(): Promise<VaultStats> {
  return rpcView<VaultStats>(VAULT_ID, 'get_stats', { token: TOKEN_ID });
}

export function formatAmount(
  raw: string | undefined | null,
  options: { decimals?: number; maxFraction?: number } = {}
): string {
  const decimals = options.decimals ?? TOKEN_DECIMALS;
  const maxFraction = options.maxFraction ?? 2;
  if (!raw) return '0';
  const value = Number(BigInt(raw)) / 10 ** decimals;
  if (!Number.isFinite(value)) return '0';
  return value.toLocaleString('en-US', {
    minimumFractionDigits: 0,
    maximumFractionDigits: maxFraction,
  });
}

/** Plain decimal string (no grouping separators) for form inputs. */
export function rawToDecimal(
  raw: string | undefined | null,
  decimals = TOKEN_DECIMALS
): string {
  if (!raw) return '0';
  const value = BigInt(raw);
  if (value === 0n) return '0';
  const s = value.toString().padStart(decimals + 1, '0');
  const whole = s.slice(0, -decimals);
  const fraction = s.slice(-decimals).replace(/0+$/, '');
  return fraction ? `${whole}.${fraction}` : whole;
}

export function parseAmount(input: string, decimals = TOKEN_DECIMALS): bigint {
  const clean = input.trim();
  if (!/^\d+(\.\d+)?$/.test(clean)) {
    throw new Error('Enter a positive amount');
  }
  const [whole, fraction = ''] = clean.split('.');
  const padded = (fraction + '0'.repeat(decimals)).slice(0, decimals);
  return BigInt(whole || '0') * 10n ** BigInt(decimals) + BigInt(padded || '0');
}

export function formatDate(ns: number | string): string {
  const ms = Number(BigInt(ns) / 1_000_000n);
  return new Date(ms).toLocaleDateString('en-US', {
    year: 'numeric',
    month: 'short',
    day: 'numeric',
  });
}

export function formatDateTime(ns: number | string): string {
  const ms = Number(BigInt(ns) / 1_000_000n);
  return new Date(ms).toLocaleString('en-US', {
    month: 'short',
    day: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
  });
}

export function shorten(value: string, chars = 6): string {
  if (!value) return '';
  if (value.length <= chars * 2 + 1) return value;
  return `${value.slice(0, chars)}…${value.slice(-chars)}`;
}

export function tokenLabel(): string {
  return TOKEN_SYMBOL;
}

export function periodDays(seconds: number): string {
  if (seconds % 86400 === 0) return `${seconds / 86400}d`;
  if (seconds % 3600 === 0) return `${seconds / 3600}h`;
  if (seconds % 60 === 0) return `${seconds / 60}m`;
  return `${seconds}s`;
}

export function isExpired(tab: Tab): boolean {
  return Date.now() * 1_000_000 >= Number(tab.expires_at_ns);
}

export function policyLabel(policy: ReceiverPolicy): string {
  if (policy === 'Any') return 'Any receiver (cross-chain capable)';
  return `Allowlist · ${policy.Allowlist.map((a) => shorten(a, 8)).join(', ')}`;
}
