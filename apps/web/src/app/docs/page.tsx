import React from 'react';
import Link from 'next/link';
import {
  ArrowRight,
  ExternalLink,
  KeyRound,
  Lock,
  ShieldCheck,
  Terminal,
} from 'lucide-react';
import {
  CONTRACT_URL,
  IS_TESTNET,
  MERCHANT_ACCOUNT,
  TOKEN_ID,
  TOKEN_SYMBOL,
  TOKEN_URL,
  VAULT_ID,
} from '@/lib/config';

export const metadata = {
  title: 'TabWrit Docs — contract, security model and integration',
  description:
    'Technical documentation for the TabWrit spending-Tab protocol on NEAR.',
};

export default function DocsPage() {
  return (
    <div className="container" style={{ maxWidth: '980px' }}>
      <div className="page-head">
        <div>
          <span className="eyebrow">
            <ShieldCheck size={14} /> Technical documentation
          </span>
          <h1>TabWrit protocol</h1>
          <p>
            A contract-enforced spending-allowance layer for subscriptions and
            AI agents on NEAR. A Tab is the spending primitive; a Writ is the
            rule attached to it.
          </p>
        </div>
        <Link href="/app" className="btn btn-primary btn-sm">
          <KeyRound size={14} /> Open the app
        </Link>
      </div>

      <div className="alert alert-info" style={{ marginBottom: '1.5rem' }}>
        <strong>{IS_TESTNET ? 'Testnet deployment.' : 'Mainnet deployment.'}</strong>{' '}
        Vault <span className="mono">{VAULT_ID}</span> · token{' '}
        <span className="mono">{TOKEN_ID}</span> ({TOKEN_SYMBOL}). The test token
        has no monetary value. Cross-chain settlement is quoted live through
        1Click; the testnet demo does not execute a mainnet settlement.
      </div>

      <section style={{ marginBottom: '2.4rem' }}>
        <h2 style={{ fontSize: '1.5rem', marginBottom: '0.7rem' }}>1. What TabWrit is</h2>
        <p style={{ color: 'var(--text-secondary)', lineHeight: 1.75 }}>
          TabWrit separates <strong>custody</strong> from <strong>spending
          authorization</strong>. A user deposits NEP-141 tokens into a vault
          contract and keeps the right to withdraw. For each merchant or AI
          agent, the user opens a <strong>Tab</strong>: a rule with a token,
          per-charge cap, period budget, lifetime cap, expiry and receiver
          policy. The spender can pull payments inside that rule; it cannot
          withdraw, pause, revoke or change the rule.
        </p>
        <p style={{ color: 'var(--text-secondary)', lineHeight: 1.75, marginTop: '0.7rem' }}>
          The protocol is intentionally small. It does not try to be a wallet,
          a subscription manager or a solver. It is the missing on-chain
          primitive that lets a payee pull a bounded amount without an
          unlimited token approval. The primary design goal is{' '}
          <strong>containment</strong>: a compromised merchant or agent key can
          only spend inside its Tab and cannot withdraw, pause, revoke or
          change the rule. The final testnet vault has 0 access keys, so there
          is no deployer backdoor.
        </p>
      </section>

      <section style={{ marginBottom: '2.4rem' }}>
        <h2 style={{ fontSize: '1.5rem', marginBottom: '0.7rem' }}>2. Quickstart</h2>
        <div className="grid-3">
          <div className="feature-card">
            <div className="step-number">01</div>
            <h3>Connect a testnet wallet</h3>
            <p>
              Open <Link href="/app" className="tx-link">/app</Link> and connect
              a NEAR testnet wallet through the HOT Labs connector. The owner
              key never leaves the wallet.
            </p>
          </div>
          <div className="feature-card">
            <div className="step-number">02</div>
            <h3>Get test tUSDC</h3>
            <p>
              If your wallet balance is zero, the app calls the public
              testnet faucet. It mints 100 {TOKEN_SYMBOL} to your account. This
              is a real NEP-141 transfer, not a UI number.
            </p>
          </div>
          <div className="feature-card">
            <div className="step-number">03</div>
            <h3>Deposit and open a Tab</h3>
            <p>
              Deposit with <code>ft_transfer_call</code>, then create a Tab
              with the merchant account <code>{MERCHANT_ACCOUNT}</code> as the
              spender. The app attaches the 0.01 NEAR storage deposit.
            </p>
          </div>
        </div>
        <p style={{ color: 'var(--text-secondary)', lineHeight: 1.75, marginTop: '1rem' }}>
          Then open <Link href="/merchant" className="tx-link">/merchant</Link>.
          The merchant&apos;s scoped charge key pulls the invoice. The receipt
          links to NearBlocks. The Attack Lab shows the full adversarial test
          matrix with real transaction hashes.
        </p>
      </section>

      <section style={{ marginBottom: '2.4rem' }}>
        <h2 style={{ fontSize: '1.5rem', marginBottom: '0.7rem' }}>3. Contract API</h2>
        <div className="table-wrap">
          <table className="data-table">
            <thead>
              <tr>
                <th>Method</th>
                <th>Who can call</th>
                <th>What it does</th>
              </tr>
            </thead>
            <tbody>
              <tr>
                <td className="mono">ft_on_transfer</td>
                <td>Allowlisted NEP-141 token</td>
                <td>Credits the sender&apos;s vault balance; returns 0 to keep the tokens. Unknown tokens are returned in full.</td>
              </tr>
              <tr>
                <td className="mono">create_tab</td>
                <td>Any account (owner)</td>
                <td>
                  Stores a Tab. Requires 0.01 NEAR attached storage, caps
                  ordered <code>per_charge ≤ period ≤ lifetime</code>, an
                  expiry in the future, and a label ≤ 64 bytes.
                </td>
              </tr>
              <tr>
                <td className="mono">charge</td>
                <td>The Tab&apos;s spender</td>
                <td>
                  Validates status, expiry, caps, receiver policy and balance.
                  Consumes the exact <code>nonce</code>, reserves the amount,
                  then calls NEP-141 <code>ft_transfer</code> and settles in a
                  private callback.
                </td>
              </tr>
              <tr>
                <td className="mono">pause_tab / resume_tab</td>
                <td>Tab owner</td>
                <td>Temporarily blocks or re-enables charges. The period clock continues.</td>
              </tr>
              <tr>
                <td className="mono">revoke_tab</td>
                <td>Tab owner</td>
                <td>Permanently blocks charges. Revocation is terminal.</td>
              </tr>
              <tr>
                <td className="mono">withdraw</td>
                <td>Balance owner</td>
                <td>Transfers the owner&apos;s unspent ledger balance back to their account.</td>
              </tr>
              <tr>
                <td className="mono">get_tab / get_remaining / get_stats</td>
                <td>Anyone</td>
                <td>Read-only views used by the app, keeper and MCP server.</td>
              </tr>
            </tbody>
          </table>
        </div>
      </section>

      <section id="security" style={{ marginBottom: '2.4rem' }}>
        <h2 style={{ fontSize: '1.5rem', marginBottom: '0.7rem' }}>4. Security model</h2>
        <div className="grid-2">
          <div className="feature-card">
            <div className="feature-icon">
              <Lock size={20} />
            </div>
            <h3>On-chain guarantees</h3>
            <ul style={{ marginLeft: '1.1rem', color: 'var(--text-secondary)', lineHeight: 1.8, fontSize: '0.9rem' }}>
              <li>No charge can exceed <code>per_charge_cap</code>, the current period budget or <code>total_cap</code>.</li>
              <li>No charge can succeed after expiry or while paused/revoked.</li>
              <li>Only the designated spender can call <code>charge</code>.</li>
              <li>A fixed allowlist rejects any other receiver.</li>
              <li>Every charge consumes a monotonic nonce; a replay fails.</li>
              <li>If the token transfer fails, the callback restores the ledger without erasing later in-flight charges.</li>
            </ul>
          </div>
          <div className="feature-card">
            <div className="feature-icon">
              <KeyRound size={20} />
            </div>
            <h3>Key separation</h3>
            <ul style={{ marginLeft: '1.1rem', color: 'var(--text-secondary)', lineHeight: 1.8, fontSize: '0.9rem' }}>
              <li>The owner uses wallet-signed transactions; the server never holds the owner key.</li>
              <li>The merchant / agent uses a NEAR Function-Call Access Key scoped to <code>charge</code> only.</li>
              <li>Function-Call keys cannot attach a deposit, so a leaked spender key cannot move NEAR or call another contract.</li>
              <li>The Tab caps limit the damage of a fully compromised spender key.</li>
              <li>The owner can revoke without rotating the spender&apos;s key.</li>
            </ul>
          </div>
        </div>
      </section>

      <section style={{ marginBottom: '2.4rem' }}>
        <h2 style={{ fontSize: '1.5rem', marginBottom: '0.7rem' }}>5. Cross-chain settlement</h2>
        <p style={{ color: 'var(--text-secondary)', lineHeight: 1.75 }}>
          The merchant backend requests an <code>EXACT_OUTPUT</code> quote from
          the live 1Click API. For a 10 USDC invoice on Base, the response
          fixes 10 USDC output and returns the required input, a unique NEAR
          deposit address, a quote deadline and a signed quote payload. The
          vault sends the quoted input to that deposit address with a normal
          NEP-141 transfer; a 1Click solver delivers the output on the
          destination chain.
        </p>
        <p style={{ color: 'var(--text-secondary)', lineHeight: 1.75, marginTop: '0.7rem' }}>
          The quote is real. The testnet demo stops at the quote because 1Click
          operates on NEAR mainnet. A production deployment needs a mainnet
          vault, mainnet USDC, storage registration for each fresh deposit
          address, and a small gas/storage budget. The merchant checkout page
          labels the quote as a preview and never claims a settlement.
        </p>
        <div className="alert alert-info" style={{ marginTop: '0.9rem' }}>
          <strong>On-chain trust boundary.</strong> The contract enforces the
          token, amount, caps, expiry and nonce. It cannot verify that a 1Click
          deposit address belongs to a particular merchant. With{' '}
          <code>ReceiverPolicy::Any</code>, the spender chooses the address
          within the caps; with <code>Allowlist</code>, the owner fixes the
          receiver but rotating 1Click deposit addresses cannot be used. This
          is documented rather than hidden.
        </div>
      </section>

      <section style={{ marginBottom: '2.4rem' }}>
        <h2 style={{ fontSize: '1.5rem', marginBottom: '0.7rem' }}>6. AI agents and MCP</h2>
        <p style={{ color: 'var(--text-secondary)', lineHeight: 1.75 }}>
          The <code>@tab-protocol/mcp</code> package exposes read tools for
          Tab details, balances and remaining allowance, plus a scoped charge
          tool. The agent process receives only the function-call key; the
          owner key stays in the wallet. An MCP client can inspect the budget
          before it spends, and the contract still rejects over-budget calls.
        </p>
        <p style={{ color: 'var(--text-secondary)', lineHeight: 1.75, marginTop: '0.7rem' }}>
          The agent cannot create or revoke Tabs through the MCP server. Those
          are owner actions and require a wallet signature. This is a deliberate
          separation: a compromised agent can spend inside its Tab, not change
          the rule.
        </p>
        <p style={{ color: 'var(--text-secondary)', lineHeight: 1.75, marginTop: '0.7rem' }}>
          <strong>Gasless NEP-366:</strong> a merchant or agent can sign a
          <code>charge</code> delegate off-chain with its scoped key and let a
          relayer pay NEAR gas. The relayer only accepts one <code>charge</code>
          call to the vault, signed by a Function-Call key scoped to
          <code>charge</code>; a FullAccess-key delegate is refused. The
          merchant&apos;s NEAR balance stays unchanged. See the testnet evidence
          on <code>/lab</code>.
        </p>
        <p style={{ color: 'var(--text-secondary)', lineHeight: 1.75, marginTop: '0.7rem' }}>
          <strong>Prompt-injection containment:</strong> an agent Tab can
          allowlist its merchant receiver. A redirected charge to an attacker
          is rejected on-chain with <code>RECEIVER_NOT_ALLOWED</code>; no funds
          move and the Tab nonce is not consumed. The legitimate invoice can
          still settle.
        </p>
        <p style={{ color: 'var(--text-secondary)', lineHeight: 1.75, marginTop: '0.7rem' }}>
          <strong>x402-style paid API:</strong> the{' '}
          <code>tab_pay_and_fetch</code> MCP tool reads an HTTP 402 challenge,
          binds the payment to its invoice, preflights the Tab and charges with
          the scoped key. The API returns data only after it verifies the
          vault&apos;s <code>charge_executed</code> event, including Tab,
          payer, receiver, asset, amount and invoice reference. Replay, wrong
          payer, wrong amount, over-cap, redirected receiver and a revoked Tab
          are all rejected. This is an x402-style flow with a TabWrit payment
          scheme, not a full x402 protocol implementation. The real testnet
          evidence is <code>pnpm test:x402</code> (13/13).
        </p>
        <p style={{ color: 'var(--text-secondary)', lineHeight: 1.75, marginTop: '0.7rem' }}>
          <strong>Sustainability:</strong> no token, no custody and no fee
          inside the vault. Revenue is merchant SaaS plus prepaid relayer gas
          credits; the keeper meters actual NEAR gas per sender at
          <code>/relay/usage</code>. A Function-Call NEP-366 delegate can
          contain only one <code>charge</code> action, so the relayer cannot
          deduct from the payment. See <code>docs/SUSTAINABILITY.md</code>.
        </p>
      </section>

      <section style={{ marginBottom: '2.4rem' }}>
        <h2 style={{ fontSize: '1.5rem', marginBottom: '0.7rem' }}>7. Testnet addresses</h2>
        <div className="table-wrap">
          <table className="data-table">
            <thead>
              <tr>
                <th>Item</th>
                <th>Value</th>
              </tr>
            </thead>
            <tbody>
              <tr>
                <td>Vault</td>
                <td>
                  <a className="tx-link mono" href={CONTRACT_URL} target="_blank" rel="noreferrer">
                    {VAULT_ID} <ExternalLink size={10} />
                  </a>
                </td>
              </tr>
              <tr>
                <td>Test token</td>
                <td>
                  <a className="tx-link mono" href={TOKEN_URL} target="_blank" rel="noreferrer">
                    {TOKEN_ID} <ExternalLink size={10} />
                  </a>
                </td>
              </tr>
              <tr>
                <td>Merchant / spender</td>
                <td className="mono">{MERCHANT_ACCOUNT}</td>
              </tr>
              <tr>
                <td>Agent / spender</td>
                <td className="mono">tab-agent.testnet</td>
              </tr>
              <tr>
                <td>Gas-only relayer</td>
                <td className="mono">tab-relayer.testnet</td>
              </tr>
              <tr>
                <td>RPC</td>
                <td className="mono">https://test.rpc.fastnear.com</td>
              </tr>
              <tr>
                <td>Explorer</td>
                <td className="mono">https://testnet.nearblocks.io</td>
              </tr>
            </tbody>
          </table>
        </div>
      </section>

      <section style={{ marginBottom: '2.4rem' }}>
        <h2 style={{ fontSize: '1.5rem', marginBottom: '0.7rem' }}>8. Honest limitations</h2>
        <ul style={{ marginLeft: '1.1rem', color: 'var(--text-secondary)', lineHeight: 1.9, fontSize: '0.92rem' }}>
          <li>The demo uses a test token, not USDC. It has no value.</li>
          <li>Cross-chain settlement is not executed on testnet; only the live quote is verified.</li>
          <li>With <code>Any</code> receiver policy, the spender is trusted to choose the receiver within the caps. The owner should use a fixed allowlist when the receiver is known.</li>
          <li>Each Tab requires a 0.01 NEAR storage deposit. Revoking does not refund the storage.</li>
          <li>The contract is not upgradeable. The deployer&apos;s full-access key was removed after the final deployment, so the code cannot be changed. A bug would require a new deployment.</li>
          <li>The merchant webhook SDK is a demo integration; production merchants should persist invoice IDs and reconcile 1Click status in their own database.</li>
          <li>The keeper meters relayer gas, but prepaid-credit enforcement and mainnet pricing are not implemented. The relayer is testnet-only and sponsor-funded.</li>
          <li>No third-party security audit has been performed. The Rust tests and testnet Attack Lab are the current evidence.</li>
        </ul>
      </section>

      <section style={{ marginBottom: '2.4rem' }}>
        <h2 style={{ fontSize: '1.5rem', marginBottom: '0.7rem' }}>9. Reproduce</h2>
        <pre className="code-block">{`# 1. Rust contract tests (16 tests, including fuzz + rollback)
cd contracts/tab-vault && cargo test

# 2. Build the optimized WASM
pnpm build:contract

# 3. Deploy the testnet stack (creates testnet accounts + test token + vault)
pnpm tsx scripts/create-testnet-accounts.ts
pnpm tsx scripts/deploy-testnet.ts
pnpm tsx scripts/setup-spender-key.ts merchant
pnpm tsx scripts/setup-spender-key.ts agent

# 4. Run the real Attack Lab and the agent/gasless labs
pnpm testnet:e2e
pnpm test:meta
pnpm test:relayer-usage
pnpm test:agent-attack
pnpm test:x402`}</pre>
        <p style={{ color: 'var(--text-secondary)', lineHeight: 1.7, marginTop: '0.8rem' }}>
          The runner writes every result and transaction hash to{' '}
          <code>docs/evidence/testnet-e2e.json</code> and to the lab page. It
          exits non-zero on the first mismatch.
        </p>
      </section>

      <div
        style={{
          display: 'flex',
          justifyContent: 'center',
          gap: '0.7rem',
          flexWrap: 'wrap',
          margin: '2rem 0 1rem',
        }}
      >
        <Link href="/app" className="btn btn-primary">
          <KeyRound size={16} /> Open your vault
        </Link>
        <Link href="/lab" className="btn btn-secondary">
          <ShieldCheck size={16} /> Attack Lab evidence
        </Link>
        <a className="btn btn-secondary" href={CONTRACT_URL} target="_blank" rel="noreferrer">
          <Terminal size={16} /> View contract
        </a>
      </div>

      <p style={{ color: 'var(--text-muted)', fontSize: '0.8rem', textAlign: 'center' }}>
        TabWrit is MIT licensed. Built for NEAR Hackathon 2026. This page describes
        the implementation in this repository, not a promise of future
        performance.
      </p>
    </div>
  );
}
