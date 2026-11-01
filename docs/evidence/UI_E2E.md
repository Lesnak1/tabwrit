# UI E2E — wallet connector test (2026-10-25)

This test exercises the actual browser flow, not just direct contract calls.
A Playwright browser injected a local test wallet into the real
`@hot-labs/near-connect` connector. The wallet forwarded the connector's
**exact action shape** to a test-only local signer on `127.0.0.1:4010`; the
signer held the fresh testnet key from `.env` and signed with near-api-js.

The UI test wallet was `tab-tester.testnet`, created with the human-provided
testnet key and funded by the NEAR testnet helper. The direct 12/12 owner-flow
test was later re-run on the human's actual wallet `hardjava737.testnet`
(12 testnet NEAR); its report is
`docs/evidence/tester-wallet-e2e.json`. No private key is in this repository
or either report.

## Result: 10/10 UI checks passed, 0 console errors

```text
PASS  wallet connects through injected connector — Signed in as tab-tester.testnet
PASS  deposit 20 tUSDC through the UI
PASS  create Tab through the UI — UI E2E 220500
PASS  pause Tab through the UI
PASS  resume Tab through the UI
PASS  withdraw 10 tUSDC through the UI
PASS  merchant page lists the new Tab — #50 · UI E2E 220500 · 10 tUSDC per charge
PASS  merchant pull payment settles — https://testnet.nearblocks.io/txns/FSsWgW2DX9KYeMM1DH34v1tUaJZMdScQ5S9aVuzw6e7Z
PASS  live 1Click quote renders as quote-only
PASS  Attack Lab shows 23/23

RESULT: 10/10 UI checks passed.
```

## What this proves

- The real wallet connector's `signAndSendTransaction` action format
  (`FunctionCall` with string `gas`/`deposit`) works with the app's calls:
  `ft_transfer_call`, `create_tab`, `pause_tab`, `resume_tab`, `withdraw`.
- The merchant payment ran through the **gasless NEP-366 route**. The outer
  transaction signer is `tab-relayer.testnet`, the action is `Delegate`, and
  the receipt contains `charge_executed` for Tab #50. This is the same path
  the gasless toggle uses, with the merchant's scoped key signing the
  delegate.
- The UI's read-after-write handling was exercised. Creating a Tab could
  briefly return a pre-create view from the RPC load balancer; the app now
  polls the new Tab ID (decoded from the transaction's `SuccessValue`) and
  retries the owner index before rendering.
- Pause/resume was also exercised against a stale owner index. The app now
  waits for the confirmed `get_tab` status and patches the rendered card
  before reloading, so the status badge matches the chain.
- The merchant page discovers the new Tab, the server-side scoped merchant
  key signs the delegate, the keeper relayer pays gas, and the receipt links
  to a real transaction.
- The live 1Click quote is rendered as quote-only; no funds moved.
- The Attack Lab renders the committed 23/23 evidence.

## Test-only note

The local signer (`127.0.0.1:4010`) was a development harness. It was stopped
after the test and is **not part of the shipped app or repository**. The
production web server holds only the merchant's Function-Call key, never an
owner key. The browser wallet signs owner actions.
