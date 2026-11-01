'use client';

import React, { useMemo } from 'react';
import Link from 'next/link';
import {
  CheckCircle2,
  ExternalLink,
  GitBranch,
  Hash,
  Lock,
  RefreshCw,
  ShieldAlert,
  ShieldCheck,
  Terminal,
  Wallet,
  XCircle,
} from 'lucide-react';
import evidence from '@/data/testnet-e2e.json';
import metaTxEvidence from '@/data/meta-tx.json';
import webGaslessEvidence from '@/data/web-gasless.json';
import agentAttackEvidence from '@/data/agent-attack.json';
import agentX402Evidence from '@/data/agent-x402.json';
import relayerUsageEvidence from '@/data/relayer-usage.json';
import { CONTRACT_URL, TOKEN_URL, VAULT_ID } from '@/lib/config';

type Row = {
  id: string;
  scenario: string;
  expected: string;
  actual: string;
  tx?: string;
  pass: boolean;
};

type Evidence = {
  network: string;
  vault: string;
  token: string;
  demo: string;
  merchant: string;
  generatedAt: string;
  depositTx?: string;
  results: Row[];
};

const data = evidence as Evidence;
const metaTx = metaTxEvidence as any;

// Format evidence timestamps in UTC on both the server and the client so the
// rendered text hydrates without a locale/timezone mismatch.
const utcDateTime = new Intl.DateTimeFormat('en-GB', {
  dateStyle: 'medium',
  timeStyle: 'short',
  timeZone: 'UTC',
});
const utcDate = new Intl.DateTimeFormat('en-GB', {
  dateStyle: 'medium',
  timeZone: 'UTC',
});
const webGasless = webGaslessEvidence as any;
const agentAttack = agentAttackEvidence as any;
const agentX402 = agentX402Evidence as any;
const relayerUsage = relayerUsageEvidence as any;

function category(id: string): string {
  if (id === 'D0' || id.startsWith('F')) return 'Conservation';
  if (['S1', 'S2', 'S3', 'S3b'].includes(id)) return 'Caps';
  if (['S4', 'S7'].includes(id)) return 'Access control';
  if (['S5', 'S12', 'S13a', 'S13b'].includes(id)) return 'Lifecycle';
  if (id === 'S8') return 'Balance';
  if (id.startsWith('S9')) return 'Rollover';
  if (id.startsWith('S10')) return 'Transfer rollback';
  if (id.startsWith('S11')) return 'Replay';
  if (id === 'S14') return 'Withdrawal';
  return 'Other';
}

function txLink(hash?: string) {
  return hash ? `https://testnet.nearblocks.io/txns/${hash}` : undefined;
}

export default function AttackLabPage() {
  const passed = data.results.filter((r) => r.pass).length;
  const allPassed = passed === data.results.length;

  const grouped = useMemo(() => {
    const map = new Map<string, Row[]>();
    for (const row of data.results) {
      const key = category(row.id);
      if (!map.has(key)) map.set(key, []);
      map.get(key)!.push(row);
    }
    return Array.from(map.entries());
  }, []);

  return (
    <div className="container" style={{ maxWidth: '1100px' }}>
      <div className="page-head">
        <div>
          <span className="eyebrow">
            <ShieldAlert size={14} /> Real testnet evidence
          </span>
          <h1>Attack Lab</h1>
          <p>
            Every row below is a real NEAR testnet transaction against{' '}
            <span className="mono">{data.vault}</span>. Not a browser
            simulation, not a reference model.
          </p>
        </div>
        <div style={{ textAlign: 'right' }}>
          <span className={`tag ${allPassed ? 'tag-green' : 'tag-red'}`}>
            {allPassed ? <CheckCircle2 size={12} /> : <XCircle size={12} />}{' '}
            {passed}/{data.results.length} passed
          </span>
          <div className="form-hint" style={{ marginTop: '0.35rem' }}>
            Last run {utcDateTime.format(new Date(data.generatedAt))} UTC
          </div>
        </div>
      </div>

      <div className="grid-3" style={{ marginBottom: '1.4rem' }}>
        <div className="stat">
          <div className="stat-label">Contract</div>
          <div className="stat-value" style={{ fontSize: '0.98rem' }}>
            <a
              className="tx-link mono"
              href={CONTRACT_URL}
              target="_blank"
              rel="noreferrer"
            >
              {data.vault} <ExternalLink size={11} />
            </a>
          </div>
        </div>
        <div className="stat">
          <div className="stat-label">Test token</div>
          <div className="stat-value" style={{ fontSize: '0.98rem' }}>
            <a
              className="tx-link mono"
              href={TOKEN_URL}
              target="_blank"
              rel="noreferrer"
            >
              {data.token} <ExternalLink size={11} />
            </a>
          </div>
        </div>
        <div className="stat">
          <div className="stat-label">Signers</div>
          <div className="stat-value" style={{ fontSize: '0.86rem' }}>
            owner {data.demo}
            <br />
            spender {data.merchant}
          </div>
        </div>
      </div>

      <div className="alert alert-info" style={{ marginBottom: '1.4rem' }}>
        <strong>How to read this:</strong> each scenario declares an expected
        policy result, then sends a real transaction with the owner, merchant
        or attacker account. The row records the actual contract result. Open
        any transaction on NearBlocks to inspect the receipt and the NEP-297
        event. A failure would be shown as FAIL; the runner exits non-zero.
      </div>

      {grouped.map(([group, rows]) => (
        <section key={group} style={{ marginBottom: '1.6rem' }}>
          <h2
            style={{
              fontSize: '1rem',
              letterSpacing: '-0.01em',
              marginBottom: '0.6rem',
              display: 'flex',
              alignItems: 'center',
              gap: '0.45rem',
            }}
          >
            <GitBranch size={15} style={{ color: 'var(--accent-primary)' }} />
            {group}
          </h2>
          <div className="table-wrap">
            <table className="data-table">
              <thead>
                <tr>
                  <th>#</th>
                  <th>Scenario</th>
                  <th>Expected</th>
                  <th>Actual</th>
                  <th>Result</th>
                  <th>Transaction</th>
                </tr>
              </thead>
              <tbody>
                {rows.map((row) => (
                  <tr key={row.id}>
                    <td className="mono">{row.id}</td>
                    <td>
                      <strong>{row.scenario}</strong>
                    </td>
                    <td className="mono">{row.expected}</td>
                    <td className="mono">{row.actual}</td>
                    <td>
                      {row.pass ? (
                        <span className="result-pass">PASS</span>
                      ) : (
                        <span className="result-fail">FAIL</span>
                      )}
                    </td>
                    <td>
                      {row.tx ? (
                        <a
                          className="tx-link mono"
                          href={txLink(row.tx)}
                          target="_blank"
                          rel="noreferrer"
                        >
                          {row.tx.slice(0, 8)}… <ExternalLink size={10} />
                        </a>
                      ) : (
                        <span className="muted">n/a</span>
                      )}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </section>
      ))}

      <section style={{ marginTop: '2rem' }}>
        <div
          style={{
            display: 'flex',
            alignItems: 'baseline',
            justifyContent: 'space-between',
            gap: '1rem',
            flexWrap: 'wrap',
            marginBottom: '0.8rem',
          }}
        >
          <h2 style={{ fontSize: '1.05rem' }}>
            Agent, gasless and x402 evidence
          </h2>
          <span className="form-hint">
            Run {utcDate.format(new Date(metaTx.generatedAt))} · real
            testnet transactions
          </span>
        </div>
        <div className="grid-2-fixed">
          <div className="card">
            <span className="tag tag-green">NEP-366</span>
            <h3 style={{ fontSize: '1rem', margin: '0.7rem 0 0.4rem' }}>
              Gasless merchant + agent charge
            </h3>
            <p
              style={{
                color: 'var(--text-secondary)',
                fontSize: '0.84rem',
                lineHeight: 1.6,
              }}
            >
              The merchant and agent sign <code>charge</code> delegates with
              their scoped keys; the relayer pays gas. Both NEAR balances are
              unchanged. A prompt-injected agent redirect is rejected on-chain.
            </p>
            <div className="preview-row" style={{ fontSize: '0.82rem' }}>
              <span>Checks</span>
              <strong>
                {metaTx.results.filter((r: any) => r.pass).length}/
                {metaTx.results.length}
              </strong>
            </div>
            <div className="preview-row" style={{ fontSize: '0.82rem' }}>
              <span>Agent Tab</span>
              <strong>#{metaTx.agentTabId}</strong>
            </div>
            <div className="preview-row" style={{ fontSize: '0.82rem' }}>
              <span>Gas meter</span>
              <strong>
                {relayerUsage.totals.relays} relays ·{' '}
                {(Number(relayerUsage.totals.tokensBurntYocto) / 1e24).toFixed(6)}{' '}
                NEAR
              </strong>
            </div>
            <div className="preview-row" style={{ fontSize: '0.82rem' }}>
              <span>Relayer</span>
              <strong className="mono">{metaTx.relayer}</strong>
            </div>
            <div style={{ display: 'flex', gap: '0.5rem', flexWrap: 'wrap' }}>
              <a
                className="tx-link mono"
                href={txLink(metaTx.relayTx)}
                target="_blank"
                rel="noreferrer"
                style={{ fontSize: '0.78rem' }}
              >
                merchant tx <ExternalLink size={10} />
              </a>
              <a
                className="tx-link mono"
                href={txLink(metaTx.agentRelayTx)}
                target="_blank"
                rel="noreferrer"
                style={{ fontSize: '0.78rem' }}
              >
                agent tx <ExternalLink size={10} />
              </a>
            </div>
          </div>

          <div className="card">
            <span className="tag tag-green">WEB</span>
            <h3 style={{ fontSize: '1rem', margin: '0.7rem 0 0.4rem' }}>
              Gasless checkout route
            </h3>
            <p
              style={{
                color: 'var(--text-secondary)',
                fontSize: '0.84rem',
                lineHeight: 1.6,
              }}
            >
              The browser calls the merchant route; the server signs the
              delegate and the keeper relays it. This exercises the same path
              the merchant page uses with the gasless toggle.
            </p>
            <div className="preview-row" style={{ fontSize: '0.82rem' }}>
              <span>Checks</span>
              <strong>
                {webGasless.results.filter((r: any) => r.pass).length}/
                {webGasless.results.length}
              </strong>
            </div>
            <div className="preview-row" style={{ fontSize: '0.82rem' }}>
              <span>Tab</span>
              <strong>#{webGasless.tabId}</strong>
            </div>
            <a
              className="tx-link mono"
              href={txLink(webGasless.relayTx)}
              target="_blank"
              rel="noreferrer"
              style={{ fontSize: '0.78rem' }}
            >
              {String(webGasless.relayTx).slice(0, 10)}… <ExternalLink size={10} />
            </a>
          </div>

          <div className="card">
            <span className="tag tag-green">AGENT</span>
            <h3 style={{ fontSize: '1rem', margin: '0.7rem 0 0.4rem' }}>
              Prompt-injection containment
            </h3>
            <p
              style={{
                color: 'var(--text-secondary)',
                fontSize: '0.84rem',
                lineHeight: 1.6,
              }}
            >
              The agent is instructed to pay an attacker. The on-chain
              allowlist rejects it with <code>RECEIVER_NOT_ALLOWED</code> and
              moves nothing; the legitimate merchant invoice still settles.
            </p>
            <div className="preview-row" style={{ fontSize: '0.82rem' }}>
              <span>Attack</span>
              <strong style={{ color: 'var(--accent-danger)' }}>REJECTED</strong>
            </div>
            <div className="preview-row" style={{ fontSize: '0.82rem' }}>
              <span>Legitimate</span>
              <strong style={{ color: 'var(--accent-primary)' }}>EXECUTED</strong>
            </div>
            <div style={{ display: 'flex', gap: '0.5rem', flexWrap: 'wrap' }}>
              <a
                className="tx-link mono"
                href={txLink(agentAttack.attackTx)}
                target="_blank"
                rel="noreferrer"
                style={{ fontSize: '0.78rem' }}
              >
                attack tx <ExternalLink size={10} />
              </a>
              <a
                className="tx-link mono"
                href={txLink(agentAttack.legitTx)}
                target="_blank"
                rel="noreferrer"
                style={{ fontSize: '0.78rem' }}
              >
                legit tx <ExternalLink size={10} />
              </a>
            </div>
          </div>

          <div className="card">
            <span className="tag tag-green">x402</span>
            <h3 style={{ fontSize: '1rem', margin: '0.7rem 0 0.4rem' }}>
              Agent pays a paid API
            </h3>
            <p
              style={{
                color: 'var(--text-secondary)',
                fontSize: '0.84rem',
                lineHeight: 1.6,
              }}
            >
              An unpaid request returns a real HTTP 402 challenge. The MCP tool
              pays the invoice from a Tab, then the API verifies the on-chain{' '}
              <code>charge_executed</code> event before returning data. Replay,
              wrong payer, over-cap, redirected receiver and revoked Tab are
              all rejected.
            </p>
            <div className="preview-row" style={{ fontSize: '0.82rem' }}>
              <span>Checks</span>
              <strong>
                {agentX402.results.filter((r: any) => r.pass).length}/
                {agentX402.results.length}
              </strong>
            </div>
            <div className="preview-row" style={{ fontSize: '0.82rem' }}>
              <span>Invoice</span>
              <strong>0.5 tUSDC · Tab #{agentX402.tab_id}</strong>
            </div>
            <div className="preview-row" style={{ fontSize: '0.82rem' }}>
              <span>Redirect</span>
              <strong style={{ color: 'var(--accent-primary)' }}>
                RECEIVER_NOT_ALLOWED
              </strong>
            </div>
            <div style={{ display: 'flex', gap: '0.5rem', flexWrap: 'wrap' }}>
              <a
                className="tx-link mono"
                href={txLink(agentX402.transactions.success)}
                target="_blank"
                rel="noreferrer"
                style={{ fontSize: '0.78rem' }}
              >
                payment tx <ExternalLink size={10} />
              </a>
              <a
                className="tx-link mono"
                href={txLink(agentX402.transactions.attacker_rejected)}
                target="_blank"
                rel="noreferrer"
                style={{ fontSize: '0.78rem' }}
              >
                attack tx <ExternalLink size={10} />
              </a>
            </div>
          </div>
        </div>
      </section>

      <div className="grid-2" style={{ marginTop: '2rem' }}>
        <div className="card">
          <div className="feature-icon">
            <ShieldCheck size={20} />
          </div>
          <h3 style={{ fontSize: '1.05rem', marginBottom: '0.5rem' }}>
            What the contract enforces
          </h3>
          <ul
            style={{
              marginLeft: '1.1rem',
              color: 'var(--text-secondary)',
              fontSize: '0.88rem',
              lineHeight: 1.85,
            }}
          >
            <li>
              <strong>Caps:</strong> per-charge, period and lifetime limits are
              checked before the token call.
            </li>
            <li>
              <strong>Authorization:</strong> only the designated spender can
              call <code>charge</code>; the owner controls pause/revoke.
            </li>
            <li>
              <strong>Receiver policy:</strong> a fixed allowlist rejects
              redirected charges. <code>Any</code> is required for rotating
              Intent deposit addresses.
            </li>
            <li>
              <strong>Replay:</strong> each Tab has a monotonic{' '}
              <code>next_nonce</code>; a consumed nonce cannot be reused.
            </li>
            <li>
              <strong>Rollback:</strong> if the NEP-141 transfer fails, the
              callback restores the ledger and counters without erasing later
              in-flight charges.
            </li>
          </ul>
        </div>

        <div className="card">
          <div className="feature-icon">
            <Terminal size={20} />
          </div>
          <h3 style={{ fontSize: '1.05rem', marginBottom: '0.5rem' }}>
            Reproduce the run
          </h3>
          <p
            style={{
              color: 'var(--text-secondary)',
              fontSize: '0.86rem',
              lineHeight: 1.6,
              marginBottom: '0.8rem',
            }}
          >
            The runners need the funded testnet accounts, the merchant charge
            key and the gas-only relayer. The setup scripts create them and
            write secrets only to the gitignored <code>.env</code>.
          </p>
          <pre className="code-block">{`pnpm tsx scripts/create-testnet-accounts.ts
pnpm tsx scripts/deploy-testnet.ts
pnpm tsx scripts/setup-spender-key.ts merchant
pnpm tsx scripts/setup-spender-key.ts agent
pnpm testnet:e2e
pnpm test:meta
pnpm test:relayer-usage
pnpm test:agent-attack
pnpm test:x402`}</pre>
          <div className="form-hint" style={{ marginTop: '0.7rem' }}>
            The runner writes <code>docs/evidence/testnet-e2e.json</code> and
            the copy rendered on this page.
          </div>
        </div>
      </div>

      <div className="alert alert-info" style={{ marginTop: '1.5rem' }}>
        <strong>Honest scope.</strong> This evidence covers the NEAR testnet
        contract and test token. The 1Click cross-chain route is a live
        mainnet quote preview, not a settlement. Executing the cross-chain leg
        requires a funded NEAR mainnet vault and real USDC; the demo does not
        claim otherwise. The NEP-366 relayer is testnet-only in this
        deployment; a production relayer needs monitoring, a funded gas
        balance and the same scoped-key validation. The x402 card is an
        x402-style HTTP 402 flow with a TabWrit scheme and on-chain receipt
        verification, not a full x402 protocol implementation.
      </div>

      <div
        style={{
          display: 'flex',
          justifyContent: 'center',
          gap: '0.7rem',
          flexWrap: 'wrap',
          marginTop: '2rem',
        }}
      >
        <Link href="/app" className="btn btn-primary">
          <Wallet size={16} /> Open your vault
        </Link>
        <Link href="/merchant" className="btn btn-secondary">
          <RefreshCw size={16} /> Try the merchant checkout
        </Link>
        <a
          className="btn btn-secondary"
          href={CONTRACT_URL}
          target="_blank"
          rel="noreferrer"
        >
          <Hash size={16} /> Inspect the contract
        </a>
      </div>

      <div className="form-hint" style={{ textAlign: 'center', marginTop: '1.2rem' }}>
        Contract {VAULT_ID} · evidence generated {new Date(data.generatedAt).toISOString()}
      </div>
    </div>
  );
}
