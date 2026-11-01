'use client';

import React, { useEffect, useMemo, useState } from 'react';
import Link from 'next/link';
import {
  ArrowRight,
  CheckCircle2,
  ExternalLink,
  Globe2,
  Loader2,
  RefreshCw,
  ShieldCheck,
  ShoppingCart,
  Wallet,
  XCircle,
} from 'lucide-react';
import {
  CONTRACT_URL,
  IS_TESTNET,
  MERCHANT_ACCOUNT,
  TOKEN_DECIMALS,
  TOKEN_ID,
  TOKEN_SYMBOL,
  VAULT_ID,
} from '@/lib/config';
import { useWallet } from '@/lib/wallet';
import {
  formatAmount,
  getTabsByOwner,
  isExpired,
  parseAmount,
  Tab,
} from '@/lib/rpc';

type MerchantConfig = {
  network: string;
  vault: string;
  token: string;
  merchant: string;
  invoiceAmount: string;
  hasMerchantKey: boolean;
  gaslessAvailable: boolean;
  explorer: string;
};

type Receipt = {
  status: 'executed' | 'rejected' | 'failed' | 'error';
  reason?: string;
  txHash?: string;
  explorerUrl?: string;
  event?: any;
  cached?: boolean;
  gasless?: boolean;
  relayer?: string;
  sender?: string;
  gasPaidBy?: string;
  config?: MerchantConfig;
};

type QuoteResult = {
  mode: 'quote-only';
  note: string;
  origin: { assetId: string; symbol: string; blockchain: string };
  destination: {
    assetId: string;
    symbol: string;
    blockchain: string;
    recipient: string;
  };
  refundTo: string;
  quote: {
    amountIn: string;
    amountInFormatted: string;
    amountInUsd: string;
    minAmountIn: string;
    amountOut: string;
    amountOutFormatted: string;
    amountOutUsd: string;
    timeEstimate: number;
    deadline: string;
  };
  correlationId: string;
};

const CHAINS = [
  { id: 'base', label: 'Base' },
  { id: 'arb', label: 'Arbitrum' },
  { id: 'eth', label: 'Ethereum' },
  { id: 'sol', label: 'Solana' },
] as const;

export default function MerchantCheckoutPage() {
  const { ready, accountId, connect, connecting } = useWallet();

  const [config, setConfig] = useState<MerchantConfig | null>(null);
  const [configError, setConfigError] = useState<string | null>(null);
  const [tabs, setTabs] = useState<Tab[]>([]);
  const [tabsLoading, setTabsLoading] = useState(false);
  const [tabsError, setTabsError] = useState<string | null>(null);
  const [selectedTab, setSelectedTab] = useState<string>('');

  const [paying, setPaying] = useState(false);
  const [receipt, setReceipt] = useState<Receipt | null>(null);
  const [payError, setPayError] = useState<string | null>(null);
  const [gasless, setGasless] = useState(false);

  const [chain, setChain] = useState<(typeof CHAINS)[number]['id']>('base');
  const [recipient, setRecipient] = useState('');
  const [quoteAmount, setQuoteAmount] = useState('10');
  const [quote, setQuote] = useState<QuoteResult | null>(null);
  const [quoteLoading, setQuoteLoading] = useState(false);
  const [quoteError, setQuoteError] = useState<string | null>(null);

  useEffect(() => {
    fetch('/api/merchant')
      .then(async (res) => {
        const json = await res.json();
        if (!res.ok) throw new Error(json.error || 'Merchant config failed');
        setConfig(json);
      })
      .catch((err) => setConfigError(err.message));
  }, []);

  useEffect(() => {
    if (config?.gaslessAvailable) setGasless(true);
  }, [config?.gaslessAvailable]);

  async function loadTabs(owner: string) {
    setTabsLoading(true);
    setTabsError(null);
    try {
      const all = await getTabsByOwner(owner);
      const merchantTabs = all.filter(
        (tab) =>
          tab.spender === (config?.merchant || MERCHANT_ACCOUNT) &&
          tab.token === (config?.token || TOKEN_ID) &&
          tab.status === 'Active' &&
          !isExpired(tab)
      );
      setTabs(merchantTabs);
      if (
        merchantTabs.length > 0 &&
        (!selectedTab ||
          !merchantTabs.some((tab) => String(tab.id) === selectedTab))
      ) {
        setSelectedTab(String(merchantTabs[0].id));
      }
    } catch (err: any) {
      setTabsError(err?.message || 'Could not load your Tabs.');
    } finally {
      setTabsLoading(false);
    }
  }

  useEffect(() => {
    if (accountId && config) loadTabs(accountId);
    if (!accountId) {
      setTabs([]);
      setSelectedTab('');
    }
  }, [accountId, config]);

  const selected = useMemo(
    () => tabs.find((t) => String(t.id) === selectedTab) || null,
    [tabs, selectedTab]
  );

  const invoiceAmount = config?.invoiceAmount || '0';
  const symbol = TOKEN_SYMBOL;
  const decimals = TOKEN_DECIMALS;

  async function pay() {
    if (!selected) return;
    setPaying(true);
    setPayError(null);
    setReceipt(null);
    try {
      const endpoint =
        gasless && config?.gaslessAvailable
          ? '/api/merchant/charge-gasless'
          : '/api/merchant/charge';
      const res = await fetch(endpoint, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          tabId: selected.id,
          reference: `invoice-${selected.id}-${Date.now()}`,
        }),
      });
      const json: any = await res.json();
      if (!res.ok && json?.error && !json?.status) {
        setPayError(json.error);
        setReceipt(null);
        return;
      }
      setReceipt(json as Receipt);
      if (accountId) await loadTabs(accountId);
    } catch (err: any) {
      setPayError(err?.message || 'Could not reach the merchant service.');
    } finally {
      setPaying(false);
    }
  }

  async function getQuote() {
    setQuoteLoading(true);
    setQuoteError(null);
    setQuote(null);
    try {
      const raw = parseAmount(quoteAmount, decimals);
      const res = await fetch('/api/quote', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          chain,
          recipient,
          amount: raw.toString(),
        }),
      });
      const json = await res.json();
      if (!res.ok) throw new Error(json.error || 'Quote failed');
      setQuote(json as QuoteResult);
    } catch (err: any) {
      setQuoteError(err?.message || '1Click quote failed.');
    } finally {
      setQuoteLoading(false);
    }
  }

  return (
    <div className="container" style={{ maxWidth: '1080px' }}>
      <div className="page-head">
        <div>
          <h1>Merchant checkout</h1>
          <p>
            The merchant charges your Tab. You signed the spending rule when
            you opened it; this step is a pull payment.
          </p>
        </div>
        <Link href="/app" className="btn btn-secondary btn-sm">
          <Wallet size={14} /> Open a Tab
        </Link>
      </div>

      {configError ? (
        <div className="alert alert-error" style={{ marginBottom: '1rem' }}>
          {configError}
        </div>
      ) : null}

      <div className="grid-2" style={{ alignItems: 'flex-start' }}>
        <div className="card card-elevated">
          <div
            style={{
              display: 'flex',
              alignItems: 'center',
              gap: '0.8rem',
              marginBottom: '1.2rem',
            }}
          >
            <div
              style={{
                width: 44,
                height: 44,
                borderRadius: 12,
                display: 'grid',
                placeItems: 'center',
                background: 'rgba(0, 236, 151, 0.12)',
                color: 'var(--accent-primary)',
              }}
            >
              <ShoppingCart size={21} />
            </div>
            <div>
              <h3 style={{ fontSize: '1.1rem' }}>Cloudline · Monthly</h3>
              <div style={{ fontSize: '0.8rem', color: 'var(--text-muted)' }}>
                Invoice #TB-2026-001 · pull payment
              </div>
            </div>
          </div>

          <div className="divider" />

          <div className="preview-row" style={{ fontSize: '0.9rem' }}>
            <span>Merchant</span>
            <strong>{config?.merchant || MERCHANT_ACCOUNT}</strong>
          </div>
          <div className="preview-row" style={{ fontSize: '0.9rem' }}>
            <span>Invoice</span>
            <strong>
              {formatAmount(invoiceAmount, { decimals })} {symbol}
            </strong>
          </div>
          <div className="preview-row" style={{ fontSize: '0.9rem' }}>
            <span>Vault</span>
            <strong>{VAULT_ID}</strong>
          </div>
          <div className="preview-row" style={{ fontSize: '0.9rem' }}>
            <span>Settlement</span>
            <strong>
              {IS_TESTNET ? 'NEAR testnet · tUSDC' : 'NEAR mainnet · USDC'}
            </strong>
          </div>

          <div className="divider" />

          {!ready ? (
            <div className="alert">Loading wallet connector…</div>
          ) : !accountId ? (
            <div>
              <p
                style={{
                  color: 'var(--text-secondary)',
                  fontSize: '0.88rem',
                  lineHeight: 1.6,
                  marginBottom: '0.9rem',
                }}
              >
                Connect the wallet that owns the Tab so the checkout can show
                your authorized Tabs.
              </p>
              <button
                className="btn btn-primary"
                onClick={connect}
                disabled={connecting}
              >
                {connecting ? (
                  <Loader2 size={15} className="spin" />
                ) : (
                  <Wallet size={15} />
                )}{' '}
                Connect wallet
              </button>
            </div>
          ) : tabsLoading ? (
            <div className="alert">
              <Loader2 size={15} className="spin" /> Loading your Tabs…
            </div>
          ) : tabsError ? (
            <div className="alert alert-error">{tabsError}</div>
          ) : tabs.length === 0 ? (
            <div className="empty-state" style={{ padding: '1.8rem' }}>
              <ShieldCheck size={22} style={{ color: 'var(--text-muted)' }} />
              <h3 style={{ fontSize: '1rem' }}>No Tab authorizes this merchant</h3>
              <p>
                Open a Tab in the vault with <code>{MERCHANT_ACCOUNT}</code> as
                the spender. Then return here to pay the invoice.
              </p>
              <Link
                href={`/app?spender=${encodeURIComponent(MERCHANT_ACCOUNT)}`}
                className="btn btn-primary btn-sm"
              >
                Open a Tab for this merchant <ArrowRight size={14} />
              </Link>
            </div>
          ) : (
            <div>
              <div className="form-group">
                <label className="form-label">Pay with Tab</label>
                <select
                  className="form-select"
                  value={selectedTab}
                  onChange={(e) => setSelectedTab(e.target.value)}
                >
                  {tabs.map((tab) => (
                    <option key={tab.id} value={tab.id}>
                      #{tab.id} · {tab.label} ·{' '}
                      {formatAmount(tab.per_charge_cap, { decimals })} {symbol}{' '}
                      per charge
                    </option>
                  ))}
                </select>
                <div className="form-hint">
                  The merchant&apos;s scoped charge key executes this step. You
                  are not asked to sign again.
                </div>
              </div>

              {config?.gaslessAvailable ? (
                <label
                  style={{
                    display: 'flex',
                    gap: '0.65rem',
                    alignItems: 'flex-start',
                    padding: '0.85rem 0.9rem',
                    marginBottom: '0.9rem',
                    border: '1px solid rgba(0, 236, 151, 0.28)',
                    borderRadius: 12,
                    background: 'rgba(0, 236, 151, 0.05)',
                    cursor: 'pointer',
                  }}
                >
                  <input
                    type="checkbox"
                    checked={gasless}
                    onChange={(e) => setGasless(e.target.checked)}
                    style={{ marginTop: 3, accentColor: 'var(--accent-primary)' }}
                  />
                  <span>
                    <strong style={{ fontSize: '0.9rem' }}>
                      Gasless via NEP-366 relayer
                    </strong>
                    <span
                      style={{
                        display: 'block',
                        color: 'var(--text-secondary)',
                        fontSize: '0.8rem',
                        lineHeight: 1.5,
                        marginTop: 2,
                      }}
                    >
                      The merchant signs off-chain with its scoped key; the
                      relayer pays NEAR gas. The merchant key cannot transfer,
                      withdraw or call any other method.
                    </span>
                  </span>
                </label>
              ) : null}

              <button
                className="btn btn-primary"
                style={{ width: '100%' }}
                onClick={pay}
                disabled={
                  paying ||
                  receipt?.status === 'executed' ||
                  !config?.hasMerchantKey ||
                  !selected ||
                  BigInt(selected.per_charge_cap) < BigInt(invoiceAmount)
                }
              >
                {paying ? (
                  <Loader2 size={16} className="spin" />
                ) : (
                  <ArrowRight size={16} />
                )}{' '}
                {paying
                  ? 'Merchant is charging…'
                  : `${
                      gasless && config?.gaslessAvailable ? 'Pay gasless ' : 'Pay '
                    }${formatAmount(invoiceAmount, { decimals })} ${symbol}`}
              </button>

              {selected &&
              BigInt(selected.per_charge_cap) < BigInt(invoiceAmount) ? (
                <div className="alert alert-error" style={{ marginTop: '0.8rem' }}>
                  This Tab&apos;s per-charge cap is below the invoice. Open a
                  Tab with a higher per-charge cap or choose another Tab.
                </div>
              ) : null}

              {config && !config.hasMerchantKey ? (
                <div className="alert alert-error" style={{ marginTop: '0.8rem' }}>
                  The merchant charge key is not configured on this
                  deployment. Set <code>MERCHANT_CHARGE_PRIVATE_KEY</code> on
                  the server.
                </div>
              ) : null}

              {payError ? (
                <div className="alert alert-error" style={{ marginTop: '0.8rem' }}>
                  {payError}
                </div>
              ) : null}
            </div>
          )}
        </div>

        <div className="card">
          <div
            style={{
              display: 'flex',
              alignItems: 'center',
              gap: '0.6rem',
              marginBottom: '0.7rem',
            }}
          >
            <Globe2 size={18} style={{ color: '#06b6d4' }} />
            <h3 style={{ fontSize: '1.05rem' }}>Cross-chain payout preview</h3>
          </div>
          <p
            style={{
              color: 'var(--text-secondary)',
              fontSize: '0.86rem',
              lineHeight: 1.6,
              marginBottom: '1rem',
            }}
          >
            Ask the live 1Click API what the merchant would receive in USDC on
            another chain. This is a real mainnet route quote; it does not move
            funds on the testnet demo.
          </p>

          <div className="form-row">
            <div className="form-group">
              <label className="form-label">Destination chain</label>
              <select
                className="form-select"
                value={chain}
                onChange={(e) =>
                  setChain(e.target.value as (typeof CHAINS)[number]['id'])
                }
              >
                {CHAINS.map((c) => (
                  <option key={c.id} value={c.id}>
                    {c.label}
                  </option>
                ))}
              </select>
            </div>
            <div className="form-group">
              <label className="form-label">Amount ({symbol})</label>
              <input
                className="form-input"
                type="number"
                min="0.000001"
                step="0.000001"
                value={quoteAmount}
                onChange={(e) => setQuoteAmount(e.target.value)}
              />
            </div>
          </div>

          <div className="form-group">
            <label className="form-label">Merchant payout address</label>
            <input
              className="form-input mono"
              value={recipient}
              onChange={(e) => setRecipient(e.target.value)}
              placeholder={
                chain === 'sol'
                  ? 'Solana base58 address'
                  : '0x… EVM address'
              }
            />
            <div className="form-hint">
              Use an address you control. The quote is generated for this exact
              recipient.
            </div>
          </div>

          <button
            className="btn btn-secondary"
            style={{ width: '100%' }}
            onClick={getQuote}
            disabled={quoteLoading || !recipient}
          >
            {quoteLoading ? (
              <Loader2 size={15} className="spin" />
            ) : (
              <Globe2 size={15} />
            )}{' '}
            Get live 1Click quote
          </button>

          {quoteError ? (
            <div className="alert alert-error" style={{ marginTop: '0.8rem' }}>
              {quoteError}
            </div>
          ) : null}

          {quote ? (
            <div style={{ marginTop: '1rem' }}>
              <div className="alert alert-info" style={{ marginBottom: '0.8rem' }}>
                <strong>Quote-only preview.</strong> {quote.note}
              </div>
              <div className="preview-row">
                <span>Pay</span>
                <strong>
                  {formatAmount(quote.quote.amountIn, {
                    decimals: 6,
                    maxFraction: 4,
                  })}{' '}
                  USDC on NEAR
                </strong>
              </div>
              <div className="preview-row">
                <span>Receive</span>
                <strong>
                  {quote.quote.amountOutFormatted} {quote.destination.symbol} on{' '}
                  {quote.destination.blockchain}
                </strong>
              </div>
              <div className="preview-row">
                <span>Minimum input</span>
                <strong>
                  {formatAmount(quote.quote.minAmountIn, {
                    decimals: 6,
                    maxFraction: 4,
                  })}{' '}
                  USDC
                </strong>
              </div>
              <div className="preview-row">
                <span>Estimated fill</span>
                <strong>{quote.quote.timeEstimate}s</strong>
              </div>
              <div className="preview-row">
                <span>Refund account</span>
                <strong>{quote.refundTo}</strong>
              </div>
              <div
                className="form-hint"
                style={{ marginTop: '0.6rem', wordBreak: 'break-all' }}
              >
                Recipient: {quote.destination.recipient}
              </div>
            </div>
          ) : null}
        </div>
      </div>

      {receipt ? (
        <div
          className="card card-elevated"
          style={{
            marginTop: '1.5rem',
            borderColor:
              receipt.status === 'executed'
                ? 'rgba(0, 236, 151, 0.45)'
                : 'rgba(239, 68, 68, 0.4)',
          }}
        >
          <div
            style={{
              display: 'flex',
              alignItems: 'center',
              gap: '0.7rem',
              marginBottom: '1rem',
            }}
          >
            {receipt.status === 'executed' ? (
              <CheckCircle2 size={22} style={{ color: 'var(--accent-primary)' }} />
            ) : (
              <XCircle size={22} style={{ color: 'var(--accent-danger)' }} />
            )}
            <div>
              <h3 style={{ fontSize: '1.1rem' }}>
                {receipt.status === 'executed'
                  ? 'Charge settled on NEAR'
                  : receipt.status === 'rejected'
                  ? 'Charge rejected by the contract'
                  : 'Charge did not settle'}
              </h3>
              <div style={{ fontSize: '0.8rem', color: 'var(--text-muted)' }}>
                {receipt.cached
                  ? 'Cached receipt from this server process'
                  : 'Real on-chain result'}
              </div>
            </div>
          </div>

          {receipt.reason ? (
            <div className="alert alert-error" style={{ marginBottom: '0.8rem' }}>
              <code>{receipt.reason}</code>
            </div>
          ) : null}

          <div className="preview-row">
            <span>Tab</span>
            <strong>#{selected?.id}</strong>
          </div>
          <div className="preview-row">
            <span>Amount</span>
            <strong>
              {formatAmount(invoiceAmount, { decimals })} {symbol}
            </strong>
          </div>
          <div className="preview-row">
            <span>Recipient</span>
            <strong>{config?.merchant || MERCHANT_ACCOUNT}</strong>
          </div>
          {receipt.event?.data?.nonce !== undefined ? (
            <div className="preview-row">
              <span>Charge nonce</span>
              <strong>{receipt.event.data.nonce}</strong>
            </div>
          ) : null}
          {receipt.gasless ? (
            <div className="preview-row">
              <span>Gas paid by</span>
              <strong className="mono">
                relayer {receipt.relayer || ''} (NEP-366)
              </strong>
            </div>
          ) : null}

          <div
            style={{
              display: 'flex',
              gap: '0.6rem',
              flexWrap: 'wrap',
              marginTop: '1rem',
            }}
          >
            {receipt.txHash ? (
              <a
                className="btn btn-secondary btn-sm"
                href={
                  receipt.explorerUrl ||
                  `https://testnet.nearblocks.io/txns/${receipt.txHash}`
                }
                target="_blank"
                rel="noreferrer"
              >
                View transaction <ExternalLink size={13} />
              </a>
            ) : null}
            <button
              className="btn btn-secondary btn-sm"
              onClick={() => {
                setReceipt(null);
                if (accountId) loadTabs(accountId);
              }}
            >
              <RefreshCw size={13} /> New payment
            </button>
          </div>

          <div className="alert alert-info" style={{ marginTop: '1rem' }}>
            This receipt is a <strong>NEAR testnet</strong> charge in {symbol}.
            The cross-chain quote above is a separate live mainnet preview; no
            mainnet funds were moved.
          </div>
        </div>
      ) : null}

      <div className="alert alert-info" style={{ marginTop: '1.5rem' }}>
        <strong>What the merchant can do:</strong> the merchant holds a
        Function-Call Access Key scoped to{' '}
        <code>{VAULT_ID}::charge</code>. It cannot withdraw, pause, revoke or
        change the Tab. The contract rejects anything above your caps.{' '}
        <a
          className="tx-link"
          href={CONTRACT_URL}
          target="_blank"
          rel="noreferrer"
        >
          Inspect the vault <ExternalLink size={10} />
        </a>
      </div>
    </div>
  );
}
