'use client';

import React, { useEffect, useState } from 'react';
import Link from 'next/link';
import {
  ArrowRight,
  Bot,
  CheckCircle2,
  ExternalLink,
  Gauge,
  Globe2,
  KeyRound,
  Lock,
  ReceiptText,
  RefreshCw,
  ShieldCheck,
  Wallet,
} from 'lucide-react';
import {
  CONTRACT_URL,
  DEMO_ACCOUNT,
  TOKEN_DECIMALS,
  TOKEN_SYMBOL,
  VAULT_ID,
  TOKEN_URL,
} from '@/lib/config';
import {
  formatAmount,
  getConfig,
  getStats,
  getTokenMetadata,
  getVaultBalance,
  TokenMetadata,
  VaultConfig,
  VaultStats,
} from '@/lib/rpc';
import evidenceJson from '@/data/testnet-e2e.json';
import x402Json from '@/data/agent-x402.json';

const evidence = evidenceJson as {
  results: Array<{ pass: boolean }>;
};
const evidencePassed = evidence.results.filter((r) => r.pass).length;
const evidenceTotal = evidence.results.length;

const x402Evidence = x402Json as {
  results: Array<{ pass: boolean }>;
};
const x402Passed = x402Evidence.results.filter((r) => r.pass).length;
const x402Total = x402Evidence.results.length;

type LiveState = {
  loading: boolean;
  error: string | null;
  stats: VaultStats | null;
  meta: TokenMetadata | null;
  config: VaultConfig | null;
  demoBalance: string | null;
};

export default function LandingPage() {
  const [live, setLive] = useState<LiveState>({
    loading: true,
    error: null,
    stats: null,
    meta: null,
    config: null,
    demoBalance: null,
  });

  async function load() {
    setLive((prev) => ({ ...prev, loading: true, error: null }));
    try {
      const [stats, meta, config, demoBalance] = await Promise.all([
        getStats(),
        getTokenMetadata(),
        getConfig(),
        getVaultBalance(DEMO_ACCOUNT),
      ]);
      setLive({
        loading: false,
        error: null,
        stats,
        meta,
        config,
        demoBalance,
      });
    } catch (err: any) {
      setLive((prev) => ({
        ...prev,
        loading: false,
        error: err?.message || 'Live data is unavailable.',
      }));
    }
  }

  useEffect(() => {
    load();
  }, []);

  const symbol = live.meta?.symbol || TOKEN_SYMBOL;
  const decimals = live.meta?.decimals ?? TOKEN_DECIMALS;
  const volume = live.stats
    ? formatAmount(live.stats.total_volume, { decimals, maxFraction: 2 })
    : '—';
  const demoBalance = live.demoBalance
    ? formatAmount(live.demoBalance, { decimals, maxFraction: 2 })
    : '—';

  return (
    <div>
      <section className="hero">
        <div className="container hero-grid">
          <div>
            <span className="eyebrow">
              <span className="network-dot" />
              {live.error
                ? 'Live data unavailable'
                : 'Live on NEAR testnet'}
            </span>

            <h1 className="hero-title">
              The spending rule
              <br />
              <span className="gradient-text">
                your agent can&apos;t rewrite.
              </span>
            </h1>

            <p className="hero-sub">
              TabWrit turns a vault into capped, expiring, revocable Tabs for
              merchants and AI agents. A prompt injection hits the contract,
              not your wallet: the agent gets a budget, the owner keeps the
              keys, and every charge settles on NEAR.
            </p>

            <div className="hero-actions">
              <Link
                href="/app"
                className="btn btn-primary"
                style={{ padding: '0.8rem 1.4rem' }}
              >
                <Wallet size={17} /> Open your vault
              </Link>
              <Link
                href="/lab"
                className="btn btn-secondary"
                style={{ padding: '0.8rem 1.4rem' }}
              >
                <ShieldCheck size={17} /> Inspect the Attack Lab
              </Link>
            </div>

            <p className="hero-note">
              NEAR testnet · tUSDC has no monetary value · every charge is a
              real on-chain transaction ·{' '}
              <Link href="/docs#security" className="tx-link">
                read the threat model
              </Link>
            </p>
          </div>

          <div className="vault-preview fade-up">
            <div className="preview-top">
              <div>
                <div className="preview-label">Demo vault</div>
                <div className="mono" style={{ fontSize: '0.78rem' }}>
                  {DEMO_ACCOUNT}
                </div>
              </div>
              <span className="tag tag-green">
                <Lock size={11} /> Contract-held
              </span>
            </div>

            <div className="preview-label">Available balance</div>
            <div className="preview-balance">
              {live.loading ? '…' : demoBalance}
              <span>{symbol}</span>
            </div>

            <div className="preview-tab">
              <div className="preview-row">
                <span>Tabs opened</span>
                <strong>
                  {live.loading ? '…' : live.stats?.total_tabs ?? '—'}
                </strong>
              </div>
              <div className="preview-row">
                <span>Charges settled</span>
                <strong>
                  {live.loading ? '…' : live.stats?.total_charges ?? '—'}
                </strong>
              </div>
              <div className="preview-row">
                <span>Volume settled</span>
                <strong>
                  {live.loading ? '…' : `${volume} ${symbol}`}
                </strong>
              </div>
            </div>

            <div className="preview-flow">
              <span className="flow-chip">Your vault</span>
              <span className="flow-arrow">→</span>
              <span className="flow-chip">Capped Tab</span>
              <span className="flow-arrow">→</span>
              <span className="flow-chip">Merchant / AI agent</span>
              <span className="flow-arrow">→</span>
              <span className="flow-chip">NEAR Intents payout</span>
            </div>

            <div className="divider" />

            <div
              style={{
                display: 'flex',
                justifyContent: 'space-between',
                alignItems: 'center',
                gap: '0.75rem',
                flexWrap: 'wrap',
                fontSize: '0.78rem',
                color: 'var(--text-muted)',
              }}
            >
              <span>
                Contract{' '}
                <a
                  className="tx-link mono"
                  href={CONTRACT_URL}
                  target="_blank"
                  rel="noreferrer"
                >
                  {VAULT_ID.slice(0, 10)}… <ExternalLink size={11} />
                </a>
              </span>
              <button
                type="button"
                className="btn btn-secondary btn-sm"
                onClick={load}
                disabled={live.loading}
              >
                <RefreshCw
                  size={12}
                  className={live.loading ? 'spin' : ''}
                />
                Refresh
              </button>
            </div>

            {live.error ? (
              <div className="alert alert-error" style={{ marginTop: '0.8rem' }}>
                {live.error}
              </div>
            ) : null}
          </div>
        </div>
      </section>

      <section className="section-alt">
        <div className="container">
          <div className="stat-row">
            <div className="stat">
              <div className="stat-label">Vault contract</div>
              <div className="stat-value" style={{ fontSize: '1.1rem' }}>
                <a
                  href={CONTRACT_URL}
                  target="_blank"
                  rel="noreferrer"
                  className="tx-link mono"
                >
                  {VAULT_ID} <ExternalLink size={12} />
                </a>
              </div>
            </div>
            <div className="stat">
              <div className="stat-label">Settlement token</div>
              <div className="stat-value" style={{ fontSize: '1.1rem' }}>
                <a
                  href={TOKEN_URL}
                  target="_blank"
                  rel="noreferrer"
                  className="tx-link mono"
                >
                  {symbol} · NEP-141 <ExternalLink size={12} />
                </a>
              </div>
            </div>
            <div className="stat">
              <div className="stat-label">Attack Lab checks</div>
              <div className="stat-value">
                {evidencePassed}
                <small>/{evidenceTotal} passed</small>
              </div>
            </div>
            <div className="stat">
              <div className="stat-label">x402 agent checks</div>
              <div className="stat-value">
                {x402Passed}
                <small>/{x402Total} passed</small>
              </div>
            </div>
            <div className="stat">
              <div className="stat-label">Cross-chain route</div>
              <div className="stat-value" style={{ fontSize: '1.1rem' }}>
                NEAR Intents
              </div>
            </div>
          </div>
        </div>
      </section>

      <section className="section">
        <div className="container">
          <div className="section-head">
            <h2>Security first. Then convenience.</h2>
            <p>
              A Tab is not a subscription contract and not a wallet. It is the
              missing pull-payment authorization primitive: a spending rule
              the blockchain enforces, with an escape hatch the owner controls.
            </p>
          </div>

          <div className="grid-3">
            <div className="feature-card">
              <div className="feature-icon">
                <Gauge size={21} />
              </div>
              <h3>Caps the chain cannot ignore</h3>
              <p>
                Per-charge, per-period and lifetime caps are checked in Rust
                before any token moves. A compromised agent or a buggy
                merchant keeper cannot exceed them, even with a valid key.
              </p>
            </div>
            <div className="feature-card">
              <div className="feature-icon">
                <KeyRound size={21} />
              </div>
              <h3>Scoped keys, not raw keys</h3>
              <p>
                Merchants and agents use a NEAR Function-Call Access Key
                restricted to <code>vault.charge</code>. The protocol forbids
                such keys from attaching deposits, so they cannot sweep the
                vault or touch other contracts.
              </p>
            </div>
            <div className="feature-card">
              <div className="feature-icon">
                <ShieldCheck size={21} />
              </div>
              <h3>Prompt injection stops on-chain</h3>
              <p>
                A hijacked agent that tries to pay an attacker is rejected by
                the receiver allowlist with <code>RECEIVER_NOT_ALLOWED</code>.
                The attack is a real testnet transaction; the funds do not
                move.
              </p>
            </div>
            <div className="feature-card">
              <div className="feature-icon">
                <Globe2 size={21} />
              </div>
              <h3>Pay in the payee&apos;s chain</h3>
              <p>
                A merchant can quote an invoice in USDC on Base, Arbitrum or
                Solana. The vault sends the quoted input to a 1Click deposit
                address; NEAR Intents solvers deliver the output asset.
              </p>
            </div>
          </div>
        </div>
      </section>

      <section className="section section-alt">
        <div className="container">
          <div className="section-head">
            <h2>How it works</h2>
            <p>Three transactions. No custodian. No unlimited approval.</p>
          </div>

          <div className="grid-3">
            <div className="feature-card">
              <div className="step-number">STEP 01</div>
              <h3>Fund your vault</h3>
              <p>
                Send NEP-141 tokens with <code>ft_transfer_call</code>. The
                vault credits your personal balance. You can withdraw the
                unspent amount at any time.
              </p>
            </div>
            <div className="feature-card">
              <div className="step-number">STEP 02</div>
              <h3>Open a Tab</h3>
              <p>
                Choose a spender, token, per-charge cap, period budget,
                lifetime cap, expiry and receiver policy. The contract stores
                the rule and emits a NEP-297 <code>tab_created</code> event.
              </p>
            </div>
            <div className="feature-card">
              <div className="step-number">STEP 03</div>
              <h3>Let the payee charge</h3>
              <p>
                The merchant or agent calls <code>charge</code> with a
                monotonic nonce. The contract validates the rule, moves only
                the allowed amount, and settles the rest on the destination
                chain through 1Click.
              </p>
            </div>
          </div>
        </div>
      </section>

      <section className="section">
        <div className="container">
          <div className="grid-2">
            <div>
              <span className="eyebrow">
                <ShieldCheck size={14} /> Real-world money
              </span>
              <h2
                style={{
                  fontSize: 'clamp(1.7rem, 3vw, 2.3rem)',
                  letterSpacing: '-0.035em',
                  marginBottom: '0.8rem',
                }}
              >
                Subscriptions without unlimited approvals
              </h2>
              <p style={{ color: 'var(--text-secondary)', lineHeight: 1.7 }}>
                Crypto subscriptions force users to push every renewal or
                grant an ERC-20 allowance that can drain the wallet. A Tab
                replaces both with a capped pull authorization. The merchant
                pulls the invoice; the user keeps the rest.
              </p>
              <ul
                style={{
                  margin: '1.2rem 0 0 1.1rem',
                  color: 'var(--text-secondary)',
                  lineHeight: 1.9,
                  fontSize: '0.92rem',
                }}
              >
                <li>Monthly cap and per-charge cap are enforced on-chain.</li>
                <li>
                  Pause, resume and revoke take effect in the next block.
                </li>
                <li>
                  The receiver allowlist blocks redirected or phishing
                  charges.
                </li>
              </ul>
            </div>

            <div>
              <span className="eyebrow">
                <Bot size={14} /> Agent security
              </span>
              <h2
                style={{
                  fontSize: 'clamp(1.7rem, 3vw, 2.3rem)',
                  letterSpacing: '-0.035em',
                  marginBottom: '0.8rem',
                }}
              >
                Give an agent a budget, not a seed phrase
              </h2>
              <p style={{ color: 'var(--text-secondary)', lineHeight: 1.7 }}>
                Autonomous agents need to pay for APIs, compute and data.
                Handing them a hot wallet key makes one prompt injection a
                wallet drain. A Tab gives the agent a scoped key, a hard
                spending envelope and a receiver allowlist; the contract is
                the backstop, not the prompt.
              </p>
              <ul
                style={{
                  margin: '1.2rem 0 0 1.1rem',
                  color: 'var(--text-secondary)',
                  lineHeight: 1.9,
                  fontSize: '0.92rem',
                }}
              >
                <li>
                  The MCP server exposes read tools, a scoped charge tool and
                  an x402-style paid-fetch tool.
                </li>
                <li>
                  <code>tab_pay_and_fetch</code> pays an HTTP 402 invoice and
                  returns data only after the on-chain receipt is verified.
                </li>
                <li>
                  Every charge consumes a monotonic nonce; replays fail.
                </li>
                <li>
                  The owner can revoke without rotating the agent&apos;s key.
                </li>
                <li>
                  A prompt-injected payee outside the allowlist is rejected
                  on-chain with <code>RECEIVER_NOT_ALLOWED</code>.
                </li>
                <li>
                  NEP-366 lets the agent sign a charge off-chain and a relayer
                  pay gas; the agent needs no NEAR.
                </li>
              </ul>
            </div>
          </div>
        </div>
      </section>

      <section className="section section-alt">
        <div className="container">
          <div className="section-head">
            <h2>What is actually live today</h2>
            <p>
              We separate the shipped testnet product from the mainnet-only
              cross-chain step. No screenshots of imaginary settlements.
            </p>
          </div>

          <div className="grid-3">
            <div className="feature-card">
              <div className="feature-icon">
                <CheckCircle2 size={21} />
              </div>
              <h3>Testnet: live</h3>
              <p>
                Real TabVault contract, real NEP-141 token, real wallet-signed
                deposits, tabs, charges, pauses, revocations and withdrawals.
                The final vault has <strong>0 access keys</strong>; there is no
                deployer backdoor. The Attack Lab links every result to
                NearBlocks.
              </p>
              <div style={{ marginTop: '1rem' }}>
                <a
                  className="tx-link"
                  href={CONTRACT_URL}
                  target="_blank"
                  rel="noreferrer"
                >
                  Open the contract <ExternalLink size={12} />
                </a>
              </div>
            </div>

            <div className="feature-card">
              <div className="feature-icon">
                <Globe2 size={21} />
              </div>
              <h3>Cross-chain: quoted, not faked</h3>
              <p>
                The merchant checkout calls the live 1Click API for a real
                mainnet quote. Executing the settlement requires a funded
                mainnet vault; the testnet demo does not pretend otherwise.
              </p>
              <div style={{ marginTop: '1rem' }}>
                <Link className="tx-link" href="/merchant">
                  See a live quote <ArrowRight size={12} />
                </Link>
              </div>
            </div>

            <div className="feature-card">
              <div className="feature-icon">
                <ReceiptText size={21} />
              </div>
              <h3>Evidence: reproducible</h3>
              <p>
                <code>pnpm testnet:e2e</code> runs {evidenceTotal} real checks
                against the deployed contract: caps, allowlists, pause, revoke,
                expiry, replay, transfer rollback and conservation.{' '}
                <code>pnpm test:meta</code> adds 12 gasless checks,{' '}
                <code>pnpm test:agent-attack</code> adds 4 prompt-injection
                checks and <code>pnpm test:x402</code> adds {x402Total} x402
                agent checks.
              </p>
              <div style={{ marginTop: '1rem' }}>
                <Link className="tx-link" href="/lab">
                  Read the evidence <ArrowRight size={12} />
                </Link>
              </div>
            </div>
          </div>
        </div>
      </section>

      <section className="section">
        <div className="container" style={{ textAlign: 'center' }}>
          <h2
            style={{
              fontSize: 'clamp(1.9rem, 4vw, 2.8rem)',
              letterSpacing: '-0.04em',
              marginBottom: '0.8rem',
            }}
          >
            Stop handing out your wallet.
          </h2>
          <p
            style={{
              color: 'var(--text-secondary)',
              maxWidth: '560px',
              margin: '0 auto 1.6rem',
              lineHeight: 1.65,
            }}
          >
            Write a Tab. Set the envelope. Let the payee pull only what the
            contract allows, and revoke it the moment the agent misbehaves.
          </p>
          <Link
            href="/app"
            className="btn btn-primary"
            style={{ padding: '0.85rem 1.5rem' }}
          >
            <Wallet size={17} /> Launch the vault
          </Link>
        </div>
      </section>
    </div>
  );
}
