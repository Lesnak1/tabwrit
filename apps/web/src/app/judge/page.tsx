'use client';

import React, { useCallback, useEffect, useMemo, useState } from 'react';
import Link from 'next/link';
import {
  CheckCircle2,
  ExternalLink,
  RefreshCw,
  ShieldCheck,
  Terminal,
  XCircle,
} from 'lucide-react';
import { CONTRACT_URL, MERCHANT_ACCOUNT, TOKEN_SYMBOL, VAULT_ID } from '@/lib/config';
import {
  formatAmount,
  formatDate,
  getConfig,
  getRemaining,
  getTab,
  getVaultBalance,
  parseAmount,
  periodDays,
  policyLabel,
  rawToDecimal,
  RemainingAllowance,
  Tab,
  VaultConfig,
} from '@/lib/rpc';

type Simulation =
  | { ok: true; amount: bigint; periodLeft: bigint; totalLeft: bigint }
  | { ok: false; amount: bigint; reason: string; detail: string };

const DEFAULT_TAB = 77;

function reasonDetail(reason: string): string {
  switch (reason) {
    case 'TAB_NOT_ACTIVE':
      return 'The Tab is paused or revoked. The owner must resume it or open a new Tab.';
    case 'TAB_EXPIRED':
      return 'The on-chain expiry timestamp has passed. Open a new Tab.';
    case 'ERR_NONCE_MISMATCH':
      return 'The nonce must equal the Tab next_nonce. A replay or an out-of-order charge is refused.';
    case 'PER_CHARGE_CAP':
      return 'The amount is above the per-charge cap. This is checked before any token call.';
    case 'PERIOD_CAP':
      return 'The amount is above the remaining period budget. Wait for the next period or open a new Tab.';
    case 'TOTAL_CAP':
      return 'The amount is above the remaining lifetime cap. Open a new Tab for more budget.';
    case 'RECEIVER_NOT_ALLOWED':
      return 'The receiver is outside the Tab allowlist. A redirected or prompt-injected payee is refused.';
    case 'INSUFFICIENT_BALANCE':
      return 'The owner vault ledger does not have enough tokens for this charge.';
    default:
      return 'The contract would refuse this charge.';
  }
}

export default function PolicyCheckPage() {
  const [tabId, setTabId] = useState(String(DEFAULT_TAB));
  const [tab, setTab] = useState<Tab | null>(null);
  const [remaining, setRemaining] = useState<RemainingAllowance | null>(null);
  const [config, setConfig] = useState<VaultConfig | null>(null);
  const [balance, setBalance] = useState<string>('0');
  const [amount, setAmount] = useState('10');
  const [receiver, setReceiver] = useState(MERCHANT_ACCOUNT);
  const [nonce, setNonce] = useState('');
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [result, setResult] = useState<Simulation | null>(null);

  const loadTab = useCallback(async (id: number) => {
    setLoading(true);
    setError(null);
    setResult(null);
    try {
      const nextTab = await getTab(id);
      if (!nextTab) {
        setTab(null);
        setRemaining(null);
        setBalance('0');
        setError(`Tab #${id} was not found on ${VAULT_ID}.`);
        return;
      }
      const [nextRemaining, nextBalance, nextConfig] = await Promise.all([
        getRemaining(id),
        getVaultBalance(nextTab.owner),
        getConfig(),
      ]);
      setTab(nextTab);
      setRemaining(nextRemaining);
      setBalance(nextBalance);
      setConfig(nextConfig);
      setAmount(rawToDecimal(nextTab.per_charge_cap));
      setReceiver(
        nextTab.receiver_policy === 'Any'
          ? MERCHANT_ACCOUNT
          : nextTab.receiver_policy.Allowlist[0] || MERCHANT_ACCOUNT
      );
      setNonce(String(nextTab.next_nonce));
    } catch (err: any) {
      setTab(null);
      setRemaining(null);
      setError(err?.message || 'Could not load the Tab.');
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    loadTab(DEFAULT_TAB);
  }, [loadTab]);

  const periodLabel = useMemo(
    () => (tab ? periodDays(tab.period_secs) : '—'),
    [tab]
  );

  const simulate = useCallback(
    (event?: React.FormEvent) => {
      event?.preventDefault();
      if (!tab || !remaining) return;
      setError(null);
      setResult(null);
      try {
        const amountRaw = parseAmount(amount);
        const nonceValue = nonce.trim() === '' ? tab.next_nonce : Number(nonce);
        if (!Number.isInteger(nonceValue) || nonceValue < 0) {
          throw new Error('Nonce must be a non-negative integer.');
        }
        const recipient = receiver.trim();
        const nowNs = BigInt(Date.now()) * 1_000_000n;
        let reason = '';
        if (tab.status !== 'Active') reason = 'TAB_NOT_ACTIVE';
        else if (nowNs >= BigInt(tab.expires_at_ns)) reason = 'TAB_EXPIRED';
        else if (nonceValue !== tab.next_nonce) reason = 'ERR_NONCE_MISMATCH';
        else if (amountRaw > BigInt(tab.per_charge_cap)) reason = 'PER_CHARGE_CAP';
        else if (amountRaw > BigInt(remaining.remaining_in_period)) reason = 'PERIOD_CAP';
        else if (amountRaw > BigInt(remaining.remaining_total)) reason = 'TOTAL_CAP';
        else if (
          tab.receiver_policy !== 'Any' &&
          !tab.receiver_policy.Allowlist.includes(recipient)
        ) {
          reason = 'RECEIVER_NOT_ALLOWED';
        } else if (amountRaw > BigInt(balance)) reason = 'INSUFFICIENT_BALANCE';

        if (reason) {
          setResult({
            ok: false,
            amount: amountRaw,
            reason,
            detail: reasonDetail(reason),
          });
          return;
        }
        setResult({
          ok: true,
          amount: amountRaw,
          periodLeft: BigInt(remaining.remaining_in_period) - amountRaw,
          totalLeft: BigInt(remaining.remaining_total) - amountRaw,
        });
      } catch (err: any) {
        setError(err?.message || 'Could not simulate this charge.');
      }
    },
    [amount, balance, nonce, receiver, remaining, tab]
  );

  return (
    <div className="container" style={{ maxWidth: '1080px' }}>
      <div className="page-head">
        <div>
          <span className="eyebrow">
            <ShieldCheck size={14} /> Read-only contract check
          </span>
          <h1>Policy Check</h1>
          <p>
            Test a charge against the live Tab on NEAR testnet. No wallet, no
            signature, no transaction. The contract remains the source of truth.
          </p>
        </div>
        <div style={{ textAlign: 'right' }}>
          <span className="tag tag-green">
            <Terminal size={12} /> no wallet
          </span>
          <div className="form-hint" style={{ marginTop: '0.35rem' }}>
            {VAULT_ID}
          </div>
        </div>
      </div>

      <div className="alert alert-info" style={{ marginBottom: '1rem' }}>
        This is a read-only simulation using the vault&apos;s public view calls.
        It never signs or sends a transaction. Vault balance and token transfer
        are re-checked by the contract at execution.
      </div>

      <div className="grid-2" style={{ alignItems: 'flex-start' }}>
        <div className="card card-elevated">
          <h2 style={{ fontSize: '1.05rem', marginBottom: '1rem' }}>
            Load a Tab
          </h2>
          <form onSubmit={(e) => { e.preventDefault(); loadTab(Number(tabId)); }}>
            <div className="form-group">
              <label className="form-label">Tab ID</label>
              <input
                className="form-input"
                type="number"
                min="0"
                value={tabId}
                onChange={(e) => setTabId(e.target.value)}
              />
            </div>
            <button className="btn btn-secondary" type="submit" disabled={loading}>
              <RefreshCw size={15} className={loading ? 'spin' : ''} /> Load Tab
            </button>
          </form>

          {tab ? (
            <div style={{ marginTop: '1.2rem' }}>
              <div className="form-hint" style={{ marginBottom: '0.4rem' }}>
                #{tab.id} · {tab.label}
              </div>
              <div className="preview-row">
                <span>Status</span>
                <strong className="mono">{tab.status}</strong>
              </div>
              <div className="preview-row">
                <span>Spender</span>
                <strong className="mono">{tab.spender}</strong>
              </div>
              <div className="preview-row">
                <span>Per-charge cap</span>
                <strong className="mono">
                  {formatAmount(tab.per_charge_cap)} {TOKEN_SYMBOL}
                </strong>
              </div>
              <div className="preview-row">
                <span>Period budget</span>
                <strong className="mono">
                  {formatAmount(tab.per_period_cap)} {TOKEN_SYMBOL} / {periodLabel}
                </strong>
              </div>
              <div className="preview-row">
                <span>Lifetime cap</span>
                <strong className="mono">
                  {formatAmount(tab.total_cap)} {TOKEN_SYMBOL}
                </strong>
              </div>
              <div className="preview-row">
                <span>Receiver policy</span>
                <strong className="mono" style={{ textAlign: 'right' }}>
                  {policyLabel(tab.receiver_policy)}
                </strong>
              </div>
              <div className="preview-row">
                <span>Expires</span>
                <strong className="mono">{formatDate(tab.expires_at_ns)}</strong>
              </div>
              <div className="preview-row">
                <span>Next nonce</span>
                <strong className="mono">{tab.next_nonce}</strong>
              </div>
              <div className="preview-row">
                <span>Remaining this period</span>
                <strong className="mono">
                  {formatAmount(remaining?.remaining_in_period)} {TOKEN_SYMBOL}
                </strong>
              </div>
              <div className="preview-row">
                <span>Remaining lifetime</span>
                <strong className="mono">
                  {formatAmount(remaining?.remaining_total)} {TOKEN_SYMBOL}
                </strong>
              </div>
              <div className="preview-row">
                <span>Vault ledger</span>
                <strong className="mono">
                  {formatAmount(balance)} {TOKEN_SYMBOL}
                </strong>
              </div>
              <div className="form-hint" style={{ marginTop: '0.7rem' }}>
                Token allowlisted:{' '}
                {config?.allowed_tokens.includes(tab.token) ? 'yes' : 'no'} ·{' '}
                <a href={CONTRACT_URL} target="_blank" rel="noreferrer">
                  inspect contract <ExternalLink size={11} />
                </a>
              </div>
            </div>
          ) : null}
        </div>

        <div className="card card-elevated">
          <h2 style={{ fontSize: '1.05rem', marginBottom: '1rem' }}>
            Simulate a charge
          </h2>
          <form onSubmit={simulate}>
            <div className="form-group">
              <label className="form-label">Amount ({TOKEN_SYMBOL})</label>
              <input
                className="form-input"
                value={amount}
                onChange={(e) => setAmount(e.target.value)}
                inputMode="decimal"
              />
            </div>
            <div className="form-group">
              <label className="form-label">Receiver</label>
              <input
                className="form-input mono"
                value={receiver}
                onChange={(e) => setReceiver(e.target.value)}
                spellCheck={false}
              />
            </div>
            <div className="form-group">
              <label className="form-label">Nonce</label>
              <input
                className="form-input"
                value={nonce}
                onChange={(e) => setNonce(e.target.value)}
                inputMode="numeric"
              />
              <div className="form-hint">
                Leave as the Tab&apos;s next nonce for a valid charge.
              </div>
            </div>
            <button className="btn btn-primary" type="submit" disabled={!tab || !remaining}>
              <ShieldCheck size={15} /> Check policy
            </button>
          </form>

          <div style={{ display: 'flex', gap: '0.45rem', flexWrap: 'wrap', marginTop: '0.8rem' }}>
            <button
              type="button"
              className="btn btn-secondary btn-sm"
              onClick={() => {
                if (!tab) return;
                setResult(null);
                setAmount(rawToDecimal(tab.per_charge_cap));
                setReceiver(
                  tab.receiver_policy === 'Any'
                    ? MERCHANT_ACCOUNT
                    : tab.receiver_policy.Allowlist[0] || MERCHANT_ACCOUNT
                );
                setNonce(String(tab.next_nonce));
              }}
            >
              Allowed preset
            </button>
            <button
              type="button"
              className="btn btn-secondary btn-sm"
              onClick={() => {
                if (!tab) return;
                setResult(null);
                setAmount(String(Number(rawToDecimal(tab.per_charge_cap)) * 4));
                setNonce(String(tab.next_nonce));
              }}
            >
              Over-cap preset
            </button>
            <button
              type="button"
              className="btn btn-secondary btn-sm"
              onClick={() => {
                if (!tab) return;
                setResult(null);
                setAmount(rawToDecimal(tab.per_charge_cap));
                setReceiver('tab-attacker.testnet');
                setNonce(String(tab.next_nonce));
              }}
            >
              Redirect preset
            </button>
            <button
              type="button"
              className="btn btn-secondary btn-sm"
              onClick={() => {
                if (!tab) return;
                setResult(null);
                setAmount(rawToDecimal(tab.per_charge_cap));
                setReceiver(
                  tab.receiver_policy === 'Any'
                    ? MERCHANT_ACCOUNT
                    : tab.receiver_policy.Allowlist[0] || MERCHANT_ACCOUNT
                );
                setNonce(String(Math.max(0, tab.next_nonce - 1)));
              }}
            >
              Replay preset
            </button>
          </div>

          {error ? (
            <div className="alert alert-error" style={{ marginTop: '0.9rem' }}>
              {error}
            </div>
          ) : null}

          {result ? (
            result.ok ? (
              <div className="alert alert-success" style={{ marginTop: '0.9rem' }}>
                <CheckCircle2 size={16} /> ALLOWED
                <div style={{ marginTop: '0.3rem', fontSize: '0.85rem' }}>
                  {formatAmount(result.amount.toString())} {TOKEN_SYMBOL} would
                  pass every pre-check. Remaining period:{' '}
                  {formatAmount(result.periodLeft.toString())} {TOKEN_SYMBOL};
                  lifetime: {formatAmount(result.totalLeft.toString())}{' '}
                  {TOKEN_SYMBOL}.
                </div>
              </div>
            ) : (
              <div className="alert alert-error" style={{ marginTop: '0.9rem' }}>
                <XCircle size={16} /> DENIED — <span className="mono">{result.reason}</span>
                <div style={{ marginTop: '0.3rem', fontSize: '0.85rem' }}>
                  {result.detail}
                </div>
              </div>
            )
          ) : null}

          <div className="form-hint" style={{ marginTop: '0.9rem' }}>
            The real charge also checks the vault ledger and the NEP-141
            transfer. Use <Link href="/merchant">/merchant</Link> to see a real
            settlement or <Link href="/lab">/lab</Link> for the committed
            evidence.
          </div>
        </div>
      </div>

      <div className="card" style={{ marginTop: '1rem' }}>
        <div style={{ display: 'flex', gap: '0.6rem', alignItems: 'center' }}>
          <Terminal size={16} />
          <strong style={{ fontSize: '0.95rem' }}>Why this is not a mock</strong>
        </div>
        <p style={{ color: 'var(--text-secondary)', fontSize: '0.88rem', marginTop: '0.4rem' }}>
          The page calls <span className="mono">get_tab</span>,{' '}
          <span className="mono">get_remaining</span> and{' '}
          <span className="mono">get_balance</span> on{' '}
          <span className="mono">{VAULT_ID}</span>. It applies the same checks
          the contract applies before a token call. It does not sign, send or
          mutate anything.
        </p>
      </div>
    </div>
  );
}
