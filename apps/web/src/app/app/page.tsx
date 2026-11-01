'use client';

import React, { useCallback, useEffect, useMemo, useState } from 'react';
import Link from 'next/link';
import {
  AlertCircle,
  ArrowDownCircle,
  ArrowUpCircle,
  CheckCircle2,
  Clock,
  Copy,
  ExternalLink,
  Gauge,
  KeyRound,
  Loader2,
  PauseCircle,
  PlayCircle,
  PlusCircle,
  RefreshCw,
  ShieldAlert,
  Wallet,
  XCircle,
} from 'lucide-react';
import {
  AGENT_ACCOUNT,
  CONTRACT_URL,
  IS_TESTNET,
  MERCHANT_ACCOUNT,
  MIN_TAB_STORAGE_YOCTO,
  TOKEN_DECIMALS,
  TOKEN_ID,
  TOKEN_SYMBOL,
  TOKEN_URL,
  TxLink,
  VAULT_ID,
} from '@/lib/config';
import { GAS, useWallet } from '@/lib/wallet';
import {
  formatAmount,
  formatDate,
  getConfig,
  getRemaining,
  getStats,
  getTab,
  getTabsByOwner,
  getTokenMetadata,
  getVaultBalance,
  getWalletTokenBalance,
  isExpired,
  parseAmount,
  periodDays as formatPeriod,
  policyLabel,
  rawToDecimal,
  RemainingAllowance,
  Tab,
  TokenMetadata,
  VaultConfig,
  VaultStats,
} from '@/lib/rpc';

type DashboardData = {
  config: VaultConfig;
  meta: TokenMetadata;
  walletBalance: string;
  vaultBalance: string;
  tabs: Tab[];
  remaining: Record<number, RemainingAllowance | null>;
  stats: VaultStats;
};

type Notice = {
  kind: 'success' | 'error' | 'info';
  text: string;
  txHash?: string;
};

type Modal = 'deposit' | 'withdraw' | 'create' | null;
type Preset = 'subscription' | 'agent' | 'custom';

export default function VaultDashboard() {
  const {
    ready,
    accountId,
    connecting,
    connect,
    call,
    error: walletError,
    clearError,
  } = useWallet();

  const [data, setData] = useState<DashboardData | null>(null);
  const [loading, setLoading] = useState(false);
  const [actionLoading, setActionLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<Notice | null>(null);
  const [modal, setModal] = useState<Modal>(null);

  const [depositAmount, setDepositAmount] = useState('50');
  const [withdrawAmount, setWithdrawAmount] = useState('');

  const [preset, setPreset] = useState<Preset>('subscription');
  const [label, setLabel] = useState('Merchant subscription');
  const [spender, setSpender] = useState(MERCHANT_ACCOUNT);
  const [perCharge, setPerCharge] = useState('10');
  const [perPeriod, setPerPeriod] = useState('10');
  const [total, setTotal] = useState('120');
  const [periodDays, setPeriodDays] = useState('30');
  const [expiryDays, setExpiryDays] = useState('365');
  const [policy, setPolicy] = useState<'Any' | 'Allowlist'>('Any');
  const [allowlist, setAllowlist] = useState(MERCHANT_ACCOUNT);
  const [formError, setFormError] = useState<string | null>(null);

  const symbol = data?.meta.symbol || TOKEN_SYMBOL;
  const decimals = data?.meta.decimals ?? TOKEN_DECIMALS;

  const load = useCallback(
    async (
      owner: string,
      expectTabId?: number,
      expectStatus?: { id: number; status: string }
    ) => {
      setLoading(true);
      setError(null);
      try {
        let [config, meta, walletBalance, vaultBalance, tabs, stats] =
          await Promise.all([
            getConfig(),
            getTokenMetadata(),
            getWalletTokenBalance(owner),
            getVaultBalance(owner),
            getTabsByOwner(owner),
            getStats(),
          ]);

        // The RPC load balancer can briefly return a pre-create view on one
        // node. If we know the new Tab ID, poll until the owner index sees it.
        if (expectTabId) {
          for (
            let i = 0;
            i < 10 && !tabs.some((t) => t.id === expectTabId);
            i++
          ) {
            await new Promise((r) => setTimeout(r, 400));
            tabs = await getTabsByOwner(owner);
          }
        }

        // The same load balancer can return a stale status for an existing
        // Tab immediately after pause/resume/revoke. The transaction has
        // already been confirmed by waitForTabStatus; keep the rendered card
        // consistent with the confirmed on-chain status.
        if (expectStatus) {
          tabs = tabs.map((tab) =>
            tab.id === expectStatus.id
              ? { ...tab, status: expectStatus.status as typeof tab.status }
              : tab
          );
        }

        const remainingPairs = await Promise.all(
          tabs.map(async (tab) => {
            try {
              return [tab.id, await getRemaining(tab.id)] as const;
            } catch {
              return [tab.id, null] as const;
            }
          })
        );

        setData({
          config,
          meta,
          walletBalance,
          vaultBalance,
          tabs,
          remaining: Object.fromEntries(remainingPairs),
          stats,
        });
        setWithdrawAmount((prev) => prev || rawToDecimal(vaultBalance, meta.decimals));
      } catch (err: any) {
        setError(err?.message || 'Could not load vault data.');
      } finally {
        setLoading(false);
      }
    },
    []
  );

  useEffect(() => {
    if (ready && accountId) {
      load(accountId);
    } else if (ready && !accountId) {
      setData(null);
      setLoading(false);
    }
  }, [ready, accountId, load]);

  const activeTabs = useMemo(
    () => data?.tabs.filter((t) => t.status === 'Active' && !isExpired(t)) || [],
    [data]
  );

  const openModal = (next: Modal) => {
    setFormError(null);
    setModal(next);
  };

  const refresh = () => {
    if (accountId) load(accountId);
  };

  const faucet = async () => {
    if (!accountId) return;
    setActionLoading(true);
    setNotice(null);
    try {
      const { txHash } = await call({
        receiverId: TOKEN_ID,
        methodName: 'faucet',
        args: {},
        gas: '30000000000000',
        deposit: '0',
      });
      setNotice({
        kind: 'success',
        text: `100 ${symbol} requested from the testnet faucet.`,
        txHash,
      });
      await load(accountId);
    } catch (err: any) {
      setNotice({
        kind: 'error',
        text: err?.message || 'Faucet transaction failed.',
      });
    } finally {
      setActionLoading(false);
    }
  };

  const handleDeposit = async (event: React.FormEvent) => {
    event.preventDefault();
    if (!accountId) return;
    setActionLoading(true);
    setNotice(null);
    try {
      const raw = parseAmount(depositAmount, decimals);
      if (raw <= 0n) throw new Error('Enter an amount greater than zero.');
      if (raw > BigInt(data?.walletBalance || '0')) {
        throw new Error('Amount exceeds your wallet balance.');
      }
      const { txHash } = await call({
        receiverId: TOKEN_ID,
        methodName: 'ft_transfer_call',
        args: { receiver_id: VAULT_ID, amount: raw.toString(), msg: '' },
        gas: GAS.FT_TRANSFER_CALL,
        deposit: '1',
      });
      setNotice({
        kind: 'success',
        text: `${depositAmount} ${symbol} deposited into your vault.`,
        txHash,
      });
      setModal(null);
      await load(accountId);
    } catch (err: any) {
      setNotice({
        kind: 'error',
        text: err?.message || 'Deposit failed.',
      });
    } finally {
      setActionLoading(false);
    }
  };

  const handleWithdraw = async (event: React.FormEvent) => {
    event.preventDefault();
    if (!accountId) return;
    setActionLoading(true);
    setNotice(null);
    try {
      const raw = parseAmount(withdrawAmount, decimals);
      if (raw <= 0n) throw new Error('Enter an amount greater than zero.');
      if (raw > BigInt(data?.vaultBalance || '0')) {
        throw new Error('Amount exceeds your vault balance.');
      }
      const { txHash } = await call({
        receiverId: VAULT_ID,
        methodName: 'withdraw',
        args: { token: TOKEN_ID, amount: raw.toString() },
        gas: GAS.WITHDRAW,
        deposit: '0',
      });
      setNotice({
        kind: 'success',
        text: `${withdrawAmount} ${symbol} withdrawn to your wallet.`,
        txHash,
      });
      setModal(null);
      await load(accountId);
    } catch (err: any) {
      setNotice({
        kind: 'error',
        text: err?.message || 'Withdrawal failed.',
      });
    } finally {
      setActionLoading(false);
    }
  };

  const applyPreset = (next: Preset) => {
    setPreset(next);
    setFormError(null);
    if (next === 'subscription') {
      setLabel('Merchant subscription');
      setSpender(MERCHANT_ACCOUNT);
      setPerCharge('10');
      setPerPeriod('10');
      setTotal('120');
      setPeriodDays('30');
      setExpiryDays('365');
      setPolicy('Any');
    } else if (next === 'agent') {
      setLabel('AI agent API budget');
      setSpender(AGENT_ACCOUNT);
      setPerCharge('5');
      setPerPeriod('25');
      setTotal('200');
      setPeriodDays('1');
      setExpiryDays('30');
      setPolicy('Allowlist');
      setAllowlist(MERCHANT_ACCOUNT);
    } else {
      setLabel('Custom Tab');
    }
  };

  const waitForTabVisible = async (outcome: any): Promise<number | null> => {
    let tabId: number | null = null;
    try {
      const raw = outcome?.status?.SuccessValue;
      if (raw) {
        const decoded = JSON.parse(atob(raw));
        if (typeof decoded === 'number') tabId = decoded;
      }
    } catch {
      // fall through to a short wait
    }

    if (tabId !== null) {
      for (let i = 0; i < 15; i++) {
        try {
          if (await getTab(tabId)) return tabId;
        } catch {
          // keep polling
        }
        await new Promise((r) => setTimeout(r, 400));
      }
      return tabId;
    }

    await new Promise((r) => setTimeout(r, 1200));
    return null;
  };

  const waitForTabStatus = async (
    tabId: number,
    expected: string
  ): Promise<boolean> => {
    for (let i = 0; i < 20; i++) {
      try {
        const tab = await getTab(tabId);
        if (tab?.status === expected) return true;
      } catch {
        // keep polling
      }
      await new Promise((r) => setTimeout(r, 300));
    }
    return false;
  };

  const handleCreate = async (event: React.FormEvent) => {
    event.preventDefault();
    if (!accountId) return;
    setActionLoading(true);
    setFormError(null);
    setNotice(null);
    try {
      const perChargeRaw = parseAmount(perCharge, decimals);
      const perPeriodRaw = parseAmount(perPeriod, decimals);
      const totalRaw = parseAmount(total, decimals);
      const period = Number(periodDays);
      const expiry = Number(expiryDays);

      if (!spender.trim()) throw new Error('Enter the spender account.');
      if (label.trim().length === 0 || label.length > 64) {
        throw new Error('Label must be between 1 and 64 characters.');
      }
      if (perChargeRaw <= 0n) throw new Error('Per-charge cap must be positive.');
      if (perChargeRaw > perPeriodRaw) {
        throw new Error('Per-charge cap cannot exceed the period cap.');
      }
      if (perPeriodRaw > totalRaw) {
        throw new Error('Period cap cannot exceed the lifetime cap.');
      }
      if (!Number.isFinite(period) || period <= 0) {
        throw new Error('Period must be at least one day.');
      }
      if (!Number.isFinite(expiry) || expiry <= period) {
        throw new Error('Expiry must be longer than one period.');
      }
      if (period > 3650 || expiry > 3650) {
        throw new Error('Period and expiry must be 3650 days or less.');
      }

      const periodSecs = Math.floor(period * 86400);
      const expiresAtNs = Math.floor(
        (Date.now() + expiry * 86400 * 1000) * 1_000_000
      );
      const receiverPolicy =
        policy === 'Any'
          ? 'Any'
          : { Allowlist: [allowlist.trim() || spender.trim()] };

      const { txHash, outcome } = await call({
        receiverId: VAULT_ID,
        methodName: 'create_tab',
        args: {
          spender: spender.trim(),
          token: TOKEN_ID,
          per_charge_cap: perChargeRaw.toString(),
          per_period_cap: perPeriodRaw.toString(),
          total_cap: totalRaw.toString(),
          period_secs: periodSecs,
          expires_at_ns: expiresAtNs,
          receiver_policy: receiverPolicy,
          label: label.trim(),
        },
        gas: GAS.CREATE_TAB,
        deposit: MIN_TAB_STORAGE_YOCTO,
      });
      setNotice({
        kind: 'success',
        text: 'Tab created on-chain. The spender can now charge within these caps.',
        txHash,
      });
      setModal(null);
      const newTabId = await waitForTabVisible(outcome);
      await load(accountId, newTabId ?? undefined);
    } catch (err: any) {
      setFormError(err?.message || 'Could not create the Tab.');
    } finally {
      setActionLoading(false);
    }
  };

  const changeStatus = async (tab: Tab, action: 'pause' | 'resume' | 'revoke') => {
    if (!accountId) return;
    if (
      action === 'revoke' &&
      !window.confirm(
        `Revoke Tab #${tab.id}? This is permanent and cannot be undone.`
      )
    ) {
      return;
    }
    setActionLoading(true);
    setNotice(null);
    try {
      const methodName =
        action === 'pause'
          ? 'pause_tab'
          : action === 'resume'
          ? 'resume_tab'
          : 'revoke_tab';
      const expectedStatus =
        action === 'pause' ? 'Paused' : action === 'resume' ? 'Active' : 'Revoked';
      const { txHash } = await call({
        receiverId: VAULT_ID,
        methodName,
        args: { id: tab.id },
        gas: '30000000000000',
        deposit: '0',
      });
      setNotice({
        kind: 'success',
        text: `Tab #${tab.id} ${action}d.`,
        txHash,
      });
      await waitForTabStatus(tab.id, expectedStatus);
      await load(accountId, undefined, {
        id: tab.id,
        status: expectedStatus,
      });
    } catch (err: any) {
      setNotice({
        kind: 'error',
        text: err?.message || `Could not ${action} Tab #${tab.id}.`,
      });
    } finally {
      setActionLoading(false);
    }
  };

  const copy = async (text: string) => {
    try {
      await navigator.clipboard.writeText(text);
      setNotice({ kind: 'info', text: 'Copied to clipboard.' });
    } catch {
      setNotice({ kind: 'error', text: 'Clipboard access was denied.' });
    }
  };

  if (!ready) {
    return (
      <div className="container">
        <div className="card" style={{ textAlign: 'center', padding: '3rem' }}>
          <Loader2 size={26} className="spin" />
          <p style={{ marginTop: '0.8rem', color: 'var(--text-secondary)' }}>
            Loading the NEAR wallet connector…
          </p>
        </div>
      </div>
    );
  }

  if (!accountId) {
    return (
      <div className="container" style={{ maxWidth: '900px' }}>
        <div className="page-head">
          <div>
            <h1>Your vault</h1>
            <p>Connect a NEAR testnet wallet to open spending Tabs.</p>
          </div>
        </div>

        <div className="card card-elevated" style={{ padding: '2.5rem', textAlign: 'center' }}>
          <div
            style={{
              width: 64,
              height: 64,
              borderRadius: 18,
              margin: '0 auto 1.2rem',
              display: 'grid',
              placeItems: 'center',
              background: 'rgba(0, 236, 151, 0.12)',
              color: 'var(--accent-primary)',
            }}
          >
            <Wallet size={30} />
          </div>
          <h2 style={{ fontSize: '1.35rem', marginBottom: '0.6rem' }}>
            Connect a wallet to start
          </h2>
          <p
            style={{
              color: 'var(--text-secondary)',
              maxWidth: 520,
              margin: '0 auto 1.5rem',
              lineHeight: 1.65,
            }}
          >
            The vault is non-custodial. Your wallet signs deposits, Tab
            creation and withdrawals. No server ever holds your owner key.
          </p>
          <button
            className="btn btn-primary"
            onClick={connect}
            disabled={connecting}
          >
            {connecting ? (
              <>
                <Loader2 size={16} className="spin" /> Opening wallet
              </>
            ) : (
              <>
                <Wallet size={16} /> Connect NEAR wallet
              </>
            )}
          </button>
          {walletError ? (
            <div className="alert alert-error" style={{ marginTop: '1.2rem' }}>
              {walletError}
            </div>
          ) : null}
          <div className="alert alert-info" style={{ marginTop: '1.4rem', textAlign: 'left' }}>
            <strong>Testnet only.</strong> Use a NEAR testnet account. The
            settlement token is {symbol}, a free test token with a public
            faucet. It has no monetary value.
          </div>
        </div>
      </div>
    );
  }

  return (
    <div className="container" style={{ maxWidth: '1120px' }}>
      <div className="page-head">
        <div>
          <h1>Your vault</h1>
          <p>
            Signed in as <span className="mono">{accountId}</span> ·{' '}
            <a
              className="tx-link"
              href={CONTRACT_URL}
              target="_blank"
              rel="noreferrer"
            >
              {VAULT_ID} <ExternalLink size={11} />
            </a>
          </p>
        </div>
        <div className="button-row">
          <button
            className="btn btn-secondary btn-sm"
            onClick={refresh}
            disabled={loading}
          >
            <RefreshCw size={13} className={loading ? 'spin' : ''} /> Refresh
          </button>
          <button
            className="btn btn-primary btn-sm"
            onClick={() => openModal('create')}
          >
            <PlusCircle size={14} /> Open a Tab
          </button>
        </div>
      </div>

      {walletError ? (
        <div className="alert alert-error notice" style={{ marginBottom: '1rem' }}>
          <span>{walletError}</span>
          <button className="btn btn-secondary btn-sm" onClick={clearError}>
            Dismiss
          </button>
        </div>
      ) : null}

      {error ? (
        <div className="alert alert-error" style={{ marginBottom: '1rem' }}>
          <AlertCircle size={15} /> {error}
        </div>
      ) : null}

      {notice ? (
        <div
          className={`alert ${
            notice.kind === 'success'
              ? 'alert-success'
              : notice.kind === 'error'
              ? 'alert-error'
              : 'alert-info'
          } notice`}
          style={{ marginBottom: '1rem' }}
        >
          <span style={{ display: 'inline-flex', gap: '0.45rem', alignItems: 'center' }}>
            {notice.kind === 'success' ? <CheckCircle2 size={15} /> : null}
            {notice.text}
          </span>
          {notice.txHash ? (
            <a
              className="tx-link"
              href={TxLink(notice.txHash)}
              target="_blank"
              rel="noreferrer"
            >
              View transaction <ExternalLink size={11} />
            </a>
          ) : null}
        </div>
      ) : null}

      <div className="grid-2" style={{ marginBottom: '1.4rem' }}>
        <div className="vault-card">
          <div style={{ display: 'flex', justifyContent: 'space-between', gap: '0.75rem' }}>
            <div className="preview-label">Available vault balance</div>
            <span className="tag tag-green">NEP-141 · {symbol}</span>
          </div>
          <div className="vault-balance">
            {loading && !data
              ? '…'
              : formatAmount(data?.vaultBalance, { decimals, maxFraction: 4 })}
            <span>{symbol}</span>
          </div>
          <div className="vault-meta">
            Wallet: {formatAmount(data?.walletBalance, { decimals, maxFraction: 4 })}{' '}
            {symbol} · Storage deposit: 0.01 NEAR per Tab
          </div>
          <div className="button-row">
            <button
              className="btn btn-primary btn-sm"
              onClick={() => openModal('deposit')}
              disabled={!data || loading}
            >
              <ArrowDownCircle size={15} /> Deposit
            </button>
            <button
              className="btn btn-secondary btn-sm"
              onClick={() => {
                if (data) {
                  setWithdrawAmount(rawToDecimal(data.vaultBalance, decimals));
                }
                openModal('withdraw');
              }}
              disabled={!data || BigInt(data.vaultBalance) === 0n}
            >
              <ArrowUpCircle size={15} /> Withdraw
            </button>
            {IS_TESTNET && data && BigInt(data.walletBalance) === 0n ? (
              <button
                className="btn btn-secondary btn-sm"
                onClick={faucet}
                disabled={actionLoading}
              >
                {actionLoading ? (
                  <Loader2 size={14} className="spin" />
                ) : (
                  <PlusCircle size={14} />
                )}{' '}
                Get 100 test {symbol}
              </button>
            ) : null}
          </div>
        </div>

        <div className="card">
          <div style={{ display: 'flex', justifyContent: 'space-between', gap: '0.75rem' }}>
            <h3 style={{ fontSize: '1.05rem' }}>Open a spending Tab</h3>
            <KeyRound size={17} style={{ color: 'var(--accent-primary)' }} />
          </div>
          <p
            style={{
              color: 'var(--text-secondary)',
              fontSize: '0.88rem',
              lineHeight: 1.6,
              margin: '0.6rem 0 1.1rem',
            }}
          >
            Give a merchant or AI agent a scoped Function-Call key. The contract
            caps every charge; you keep the ability to pause or revoke.
          </p>
          <button
            className="btn btn-primary"
            style={{ width: '100%' }}
            onClick={() => openModal('create')}
          >
            <PlusCircle size={16} /> Configure a Tab
          </button>
          <div
            style={{
              display: 'flex',
              gap: '0.5rem',
              flexWrap: 'wrap',
              marginTop: '1rem',
            }}
          >
            <span className="tag">Per charge</span>
            <span className="tag">Period</span>
            <span className="tag">Lifetime</span>
            <span className="tag">Expiry</span>
            <span className="tag">Allowlist</span>
          </div>
        </div>
      </div>

      <div className="stat-row" style={{ marginBottom: '2rem' }}>
        <div className="stat">
          <div className="stat-label">Active Tabs</div>
          <div className="stat-value">{activeTabs.length}</div>
        </div>
        <div className="stat">
          <div className="stat-label">Tabs opened</div>
          <div className="stat-value">{data?.stats.total_tabs ?? '—'}</div>
        </div>
        <div className="stat">
          <div className="stat-label">Charges settled</div>
          <div className="stat-value">{data?.stats.total_charges ?? '—'}</div>
        </div>
        <div className="stat">
          <div className="stat-label">Volume settled</div>
          <div className="stat-value" style={{ fontSize: '1.15rem' }}>
            {data
              ? `${formatAmount(data.stats.total_volume, {
                  decimals,
                  maxFraction: 2,
                })} ${symbol}`
              : '—'}
          </div>
        </div>
      </div>

      <div
        style={{
          display: 'flex',
          justifyContent: 'space-between',
          alignItems: 'flex-end',
          gap: '1rem',
          flexWrap: 'wrap',
          marginBottom: '1rem',
        }}
      >
        <div>
          <h2 style={{ fontSize: '1.4rem', letterSpacing: '-0.03em' }}>
            Your Tabs
          </h2>
          <p style={{ color: 'var(--text-muted)', fontSize: '0.82rem' }}>
            Loaded from <span className="mono">{VAULT_ID}</span> · no sample
            data
          </p>
        </div>
        <span className="tag">{data?.tabs.length ?? 0} total</span>
      </div>

      {loading && !data ? (
        <div className="card" style={{ textAlign: 'center', padding: '3rem' }}>
          <Loader2 size={26} className="spin" />
          <p style={{ marginTop: '0.8rem', color: 'var(--text-secondary)' }}>
            Reading your vault from NEAR…
          </p>
        </div>
      ) : !data || data.tabs.length === 0 ? (
        <div className="empty-state">
          <ShieldAlert size={26} style={{ color: 'var(--text-muted)' }} />
          <h3>No Tabs yet</h3>
          <p>
            Deposit {symbol}, then open a capped Tab for a merchant or agent.
            The first 100 demo tUSDC come from the public testnet faucet.
          </p>
          <button className="btn btn-primary" onClick={() => openModal('create')}>
            <PlusCircle size={16} /> Open your first Tab
          </button>
        </div>
      ) : (
        <div style={{ display: 'flex', flexDirection: 'column', gap: '0.9rem' }}>
          {data.tabs.map((tab) => {
            const remaining = data.remaining[tab.id];
            const periodCap = BigInt(tab.per_period_cap);
            const spentPeriod = BigInt(tab.spent_in_period);
            const periodPct =
              periodCap === 0n
                ? 0
                : Math.min(Number((spentPeriod * 100n) / periodCap), 100);
            const totalCap = BigInt(tab.total_cap);
            const spentTotal = BigInt(tab.spent_total);
            const totalPct =
              totalCap === 0n
                ? 0
                : Math.min(Number((spentTotal * 100n) / totalCap), 100);
            const expired = isExpired(tab);

            return (
              <div className="tab-card" key={tab.id}>
                <div className="tab-head">
                  <div>
                    <div className="tab-title">
                      <span className="tab-id">#{tab.id}</span>
                      <h3>{tab.label || `Tab #${tab.id}`}</h3>
                      <span
                        className={`badge ${
                          tab.status === 'Active' && !expired
                            ? 'badge-active'
                            : tab.status === 'Paused'
                            ? 'badge-paused'
                            : 'badge-revoked'
                        }`}
                      >
                        {expired && tab.status === 'Active'
                          ? 'Expired'
                          : tab.status}
                      </span>
                    </div>
                    <div className="tab-sub">
                      Spender <span className="mono">{tab.spender}</span> ·{' '}
                      {policyLabel(tab.receiver_policy)}
                    </div>
                  </div>

                  <div className="tab-actions">
                    {tab.status === 'Active' && !expired ? (
                      <button
                        className="btn btn-secondary btn-sm"
                        onClick={() => changeStatus(tab, 'pause')}
                        disabled={actionLoading}
                      >
                        <PauseCircle size={14} /> Pause
                      </button>
                    ) : null}
                    {tab.status === 'Paused' ? (
                      <button
                        className="btn btn-secondary btn-sm"
                        onClick={() => changeStatus(tab, 'resume')}
                        disabled={actionLoading}
                      >
                        <PlayCircle size={14} /> Resume
                      </button>
                    ) : null}
                    {tab.status !== 'Revoked' ? (
                      <button
                        className="btn btn-danger btn-sm"
                        onClick={() => changeStatus(tab, 'revoke')}
                        disabled={actionLoading}
                      >
                        <XCircle size={14} /> Revoke
                      </button>
                    ) : null}
                  </div>
                </div>

                <div className="cap-grid">
                  <div>
                    <div className="cap-label">Per charge</div>
                    <div className="cap-value">
                      {formatAmount(tab.per_charge_cap, { decimals })} {symbol}
                    </div>
                  </div>
                  <div>
                    <div className="cap-label">Period budget</div>
                    <div className="cap-value">
                      {formatAmount(tab.per_period_cap, { decimals })} {symbol}
                    </div>
                    <div className="form-hint">
                      every {formatPeriod(tab.period_secs)}
                    </div>
                  </div>
                  <div>
                    <div className="cap-label">Lifetime cap</div>
                    <div className="cap-value">
                      {formatAmount(tab.total_cap, { decimals })} {symbol}
                    </div>
                  </div>
                  <div>
                    <div className="cap-label">Next nonce</div>
                    <div className="cap-value">{tab.next_nonce}</div>
                  </div>
                  <div>
                    <div className="cap-label">Expires</div>
                    <div className="cap-value">{formatDate(tab.expires_at_ns)}</div>
                  </div>
                  <div>
                    <div className="cap-label">Settled</div>
                    <div className="cap-value">
                      {tab.charge_count} charges ·{' '}
                      {formatAmount(tab.spent_total, { decimals })} {symbol}
                    </div>
                  </div>
                </div>

                <div style={{ marginTop: '1rem' }}>
                  <div
                    style={{
                      display: 'flex',
                      justifyContent: 'space-between',
                      fontSize: '0.78rem',
                      color: 'var(--text-secondary)',
                    }}
                  >
                    <span>Period spent</span>
                    <span className="mono">
                      {formatAmount(tab.spent_in_period, { decimals })} /{' '}
                      {formatAmount(tab.per_period_cap, { decimals })}
                    </span>
                  </div>
                  <div className="progress-container">
                    <div className="progress-bar" style={{ width: `${periodPct}%` }} />
                  </div>
                  <div
                    style={{
                      display: 'flex',
                      justifyContent: 'space-between',
                      fontSize: '0.78rem',
                      color: 'var(--text-secondary)',
                    }}
                  >
                    <span>Lifetime spent</span>
                    <span className="mono">
                      {formatAmount(tab.spent_total, { decimals })} /{' '}
                      {formatAmount(tab.total_cap, { decimals })}
                    </span>
                  </div>
                  <div className="progress-container">
                    <div
                      className="progress-bar"
                      style={{
                        width: `${totalPct}%`,
                        background: 'linear-gradient(90deg, #8b5cf6, #06b6d4)',
                      }}
                    />
                  </div>
                  {remaining ? (
                    <div className="form-hint">
                      Remaining now: {formatAmount(remaining.remaining_in_period, {
                        decimals,
                      })}{' '}
                      {symbol} this period ·{' '}
                      {formatAmount(remaining.remaining_total, { decimals })}{' '}
                      {symbol} lifetime
                    </div>
                  ) : null}
                </div>

                <div
                  style={{
                    display: 'flex',
                    justifyContent: 'space-between',
                    alignItems: 'center',
                    gap: '0.75rem',
                    flexWrap: 'wrap',
                    marginTop: '0.9rem',
                    paddingTop: '0.9rem',
                    borderTop: '1px solid var(--border-subtle)',
                  }}
                >
                  <div style={{ display: 'flex', gap: '0.4rem', flexWrap: 'wrap' }}>
                    <span className="tag">
                      <Clock size={11} /> {formatDate(tab.expires_at_ns)}
                    </span>
                    <span className="tag">
                      <Gauge size={11} /> Nonce {tab.next_nonce}
                    </span>
                  </div>
                  <div style={{ display: 'flex', gap: '0.5rem' }}>
                    <button
                      className="btn btn-secondary btn-sm"
                      onClick={() => copy(tab.spender)}
                    >
                      <Copy size={12} /> Copy spender
                    </button>
                    <Link
                      href={`/merchant?tab=${tab.id}`}
                      className="btn btn-secondary btn-sm"
                    >
                      Merchant checkout <ExternalLink size={11} />
                    </Link>
                  </div>
                </div>
              </div>
            );
          })}
        </div>
      )}

      <div className="alert alert-info" style={{ marginTop: '2rem' }}>
        <strong>How the security works:</strong> your wallet signs deposits,
        Tab creation, pauses and withdrawals. The merchant or agent receives a
        NEAR Function-Call Access Key scoped to{' '}
        <code>{VAULT_ID}::charge</code>; the protocol does not allow that key to
        attach a deposit, and the contract rejects any charge above the caps.
        {IS_TESTNET ? (
          <>
            {' '}
            {symbol} is a free test token; the contract and token are{' '}
            <a
              className="tx-link"
              href={TOKEN_URL}
              target="_blank"
              rel="noreferrer"
            >
              verifiable on NearBlocks <ExternalLink size={10} />
            </a>
            .
          </>
        ) : null}
      </div>

      {modal === 'deposit' ? (
        <div className="modal-backdrop" onClick={() => setModal(null)}>
          <div className="modal" onClick={(e) => e.stopPropagation()}>
            <div className="modal-head">
              <h2>Deposit {symbol}</h2>
              <button className="modal-close" onClick={() => setModal(null)}>
                ×
              </button>
            </div>
            <form onSubmit={handleDeposit}>
              <div className="modal-body">
                <div className="form-group">
                  <label className="form-label">Amount</label>
                  <input
                    className="form-input"
                    type="number"
                    min="0"
                    step="0.000001"
                    value={depositAmount}
                    onChange={(e) => setDepositAmount(e.target.value)}
                    required
                  />
                  <div className="form-hint">
                    Wallet balance:{' '}
                    {formatAmount(data?.walletBalance, { decimals, maxFraction: 6 })}{' '}
                    {symbol}
                  </div>
                </div>
                <div className="alert alert-info">
                  One transaction: <code>ft_transfer_call</code> on the NEP-141
                  token. The vault credits your personal balance and emits a
                  deposit event.
                </div>
              </div>
              <div className="modal-actions">
                <button
                  type="button"
                  className="btn btn-secondary"
                  onClick={() => setModal(null)}
                >
                  Cancel
                </button>
                <button className="btn btn-primary" disabled={actionLoading}>
                  {actionLoading ? (
                    <Loader2 size={15} className="spin" />
                  ) : (
                    <ArrowDownCircle size={15} />
                  )}{' '}
                  Deposit
                </button>
              </div>
            </form>
          </div>
        </div>
      ) : null}

      {modal === 'withdraw' ? (
        <div className="modal-backdrop" onClick={() => setModal(null)}>
          <div className="modal" onClick={(e) => e.stopPropagation()}>
            <div className="modal-head">
              <h2>Withdraw {symbol}</h2>
              <button className="modal-close" onClick={() => setModal(null)}>
                ×
              </button>
            </div>
            <form onSubmit={handleWithdraw}>
              <div className="modal-body">
                <div className="form-group">
                  <label className="form-label">Amount</label>
                  <input
                    className="form-input"
                    type="number"
                    min="0"
                    step="0.000001"
                    value={withdrawAmount}
                    onChange={(e) => setWithdrawAmount(e.target.value)}
                    required
                  />
                  <div className="form-hint">
                    Vault balance:{' '}
                    {formatAmount(data?.vaultBalance, { decimals, maxFraction: 6 })}{' '}
                    {symbol}
                  </div>
                </div>
                <div className="alert alert-info">
                  The contract deducts your ledger balance first and transfers
                  the tokens to your wallet. If the token transfer fails, the
                  callback restores the balance.
                </div>
              </div>
              <div className="modal-actions">
                <button
                  type="button"
                  className="btn btn-secondary"
                  onClick={() => setModal(null)}
                >
                  Cancel
                </button>
                <button className="btn btn-primary" disabled={actionLoading}>
                  {actionLoading ? (
                    <Loader2 size={15} className="spin" />
                  ) : (
                    <ArrowUpCircle size={15} />
                  )}{' '}
                  Withdraw
                </button>
              </div>
            </form>
          </div>
        </div>
      ) : null}

      {modal === 'create' ? (
        <div className="modal-backdrop" onClick={() => setModal(null)}>
          <div
            className="modal"
            style={{ maxWidth: '640px' }}
            onClick={(e) => e.stopPropagation()}
          >
            <div className="modal-head">
              <h2>Open a spending Tab</h2>
              <button className="modal-close" onClick={() => setModal(null)}>
                ×
              </button>
            </div>
            <form onSubmit={handleCreate}>
              <div className="modal-body">
                <div className="button-row" style={{ marginBottom: '1rem' }}>
                  <button
                    type="button"
                    className={`btn btn-sm ${
                      preset === 'subscription' ? 'btn-primary' : 'btn-secondary'
                    }`}
                    onClick={() => applyPreset('subscription')}
                  >
                    Subscription
                  </button>
                  <button
                    type="button"
                    className={`btn btn-sm ${
                      preset === 'agent' ? 'btn-primary' : 'btn-secondary'
                    }`}
                    onClick={() => applyPreset('agent')}
                  >
                    AI agent
                  </button>
                  <button
                    type="button"
                    className={`btn btn-sm ${
                      preset === 'custom' ? 'btn-primary' : 'btn-secondary'
                    }`}
                    onClick={() => applyPreset('custom')}
                  >
                    Custom
                  </button>
                </div>

                <div className="form-group">
                  <label className="form-label">Label</label>
                  <input
                    className="form-input"
                    value={label}
                    maxLength={64}
                    onChange={(e) => setLabel(e.target.value)}
                    required
                  />
                </div>

                <div className="form-group">
                  <label className="form-label">Spender account</label>
                  <input
                    className="form-input mono"
                    value={spender}
                    onChange={(e) => setSpender(e.target.value)}
                    required
                  />
                  <div className="form-hint">
                    The merchant or agent account that will hold the scoped
                    charge key.
                  </div>
                </div>

                <div className="form-row">
                  <div className="form-group">
                    <label className="form-label">Per-charge cap ({symbol})</label>
                    <input
                      className="form-input"
                      type="number"
                      min="0"
                      step="0.000001"
                      value={perCharge}
                      onChange={(e) => setPerCharge(e.target.value)}
                      required
                    />
                  </div>
                  <div className="form-group">
                    <label className="form-label">Period cap ({symbol})</label>
                    <input
                      className="form-input"
                      type="number"
                      min="0"
                      step="0.000001"
                      value={perPeriod}
                      onChange={(e) => setPerPeriod(e.target.value)}
                      required
                    />
                  </div>
                </div>

                <div className="form-row">
                  <div className="form-group">
                    <label className="form-label">Lifetime cap ({symbol})</label>
                    <input
                      className="form-input"
                      type="number"
                      min="0"
                      step="0.000001"
                      value={total}
                      onChange={(e) => setTotal(e.target.value)}
                      required
                    />
                  </div>
                  <div className="form-group">
                    <label className="form-label">Period length (days)</label>
                    <input
                      className="form-input"
                      type="number"
                      min="1"
                      step="1"
                      value={periodDays}
                      onChange={(e) => setPeriodDays(e.target.value)}
                      required
                    />
                  </div>
                </div>

                <div className="form-row">
                  <div className="form-group">
                    <label className="form-label">Expires after (days)</label>
                    <input
                      className="form-input"
                      type="number"
                      min="1"
                      step="1"
                      value={expiryDays}
                      onChange={(e) => setExpiryDays(e.target.value)}
                      required
                    />
                  </div>
                  <div className="form-group">
                    <label className="form-label">Receiver policy</label>
                    <select
                      className="form-select"
                      value={policy}
                      onChange={(e) =>
                        setPolicy(e.target.value as 'Any' | 'Allowlist')
                      }
                    >
                      <option value="Any">Any receiver (1Click-capable)</option>
                      <option value="Allowlist">Fixed allowlist</option>
                    </select>
                  </div>
                </div>

                {policy === 'Allowlist' ? (
                  <div className="form-group">
                    <label className="form-label">Allowed receiver</label>
                    <input
                      className="form-input mono"
                      value={allowlist}
                      onChange={(e) => setAllowlist(e.target.value)}
                      required
                    />
                    <div className="form-hint">
                      An allowlist is a fixed NEAR account. It cannot follow
                      rotating 1Click deposit addresses; use <code>Any</code>{' '}
                      for cross-chain settlement.
                    </div>
                  </div>
                ) : null}

                <div className="alert alert-info">
                  The contract enforces <code>per-charge ≤ period ≤ lifetime</code>{' '}
                  and stores the Tab with a 0.01 NEAR storage deposit. You can
                  pause or revoke at any time.
                </div>

                {formError ? (
                  <div className="alert alert-error" style={{ marginTop: '0.9rem' }}>
                    {formError}
                  </div>
                ) : null}
              </div>
              <div className="modal-actions">
                <button
                  type="button"
                  className="btn btn-secondary"
                  onClick={() => setModal(null)}
                >
                  Cancel
                </button>
                <button className="btn btn-primary" disabled={actionLoading}>
                  {actionLoading ? (
                    <Loader2 size={15} className="spin" />
                  ) : (
                    <PlusCircle size={15} />
                  )}{' '}
                  Create Tab
                </button>
              </div>
            </form>
          </div>
        </div>
      ) : null}
    </div>
  );
}
