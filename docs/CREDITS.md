# CREDITS.md

TabWrit is MIT licensed. The following open-source projects and services were
used. No code was copied from another hackathon submission.

## Smart contracts

- **near-sdk-rs** 5.29.1 — NEAR smart contract SDK.
  https://github.com/near/near-sdk-rs
- **near-contract-standards** 5.29.1 — NEP-141/NEP-145 reference
  implementation used by the test token.
  https://github.com/near/near-contract-standards
- **NEP-141** (Fungible Token), **NEP-145** (Storage Management) and
  **NEP-297** (Event Format) — NEAR standards.
  https://nomicon.io/Standards/

## Backend and tooling

- **NEAR Intents / 1Click API** — cross-chain quote and settlement service.
  https://docs.near-intents.org/ · https://1click.chaindefuser.com
- **near-api-js** 4.x — server-side signing and RPC.
  https://github.com/near/near-api-js
- **@near-js/transactions** 1.2.3 — Borsh delegate actions and signatures for
  NEP-366. https://github.com/near/near-api-js
- **@noble/hashes** 1.3.3 — SHA-256 for NEP-366 delegate signing.
  https://github.com/paulmillr/noble-hashes
- **NEP-366** — Meta Transactions specification.
  https://github.com/near/NEPs/blob/master/neps/nep-0366.md
- **FastNear testnet RPC** — public testnet endpoint.
  https://fastnear.com
- **wasm-opt / Binaryen** — WASM size optimization via the `wasm-opt` and
  `@wasm-opt/wasm` npm packages.
  https://github.com/WebAssembly/binaryen
- **tsx** — TypeScript script runner.
- **Express** and **cors** — optional keeper HTTP service.
- **@modelcontextprotocol/sdk** — MCP server transport and tool protocol.
  https://github.com/modelcontextprotocol/typescript-sdk
- **zod** — MCP tool input schema validation.
  https://github.com/colinhacks/zod

## Web

- **Next.js** 14.2.35 — React framework.
  https://nextjs.org
- **React** 18 — UI.
- **@hot-labs/near-connect** — NEAR wallet connector and modal.
  https://github.com/hot-dao/near-selector
- **lucide-react** — icons.
  https://lucide.dev
- **Inter** and **JetBrains Mono** — fonts loaded from Google Fonts.

## x402-style flow

- The paid API (`scripts/x402-api.ts`) and the MCP client
  (`packages/tab-mcp/src/x402-client.ts`) are original implementations written
  for TabWrit. They use a custom `tabwrit` payment scheme and do not copy an
  x402 SDK. The flow is **x402-style**, not a full x402 protocol
  implementation.
- HTTP `402 Payment Required` is the standard status code defined by RFC 9110.
  https://www.rfc-editor.org/rfc/rfc9110

## Data and references

- Live 1Click token list and OpenAPI schema.
- NEAR documentation for access keys, NEP-141, NEP-145 and events.
- NearBlocks explorer for transaction links.

## Testnet accounts

The testnet helper created the accounts used in the demo. The test token is a
local implementation, not USDC. The old `731d…` deployment and its compromised
key were retired during the audit.

## License

MIT. See [`LICENSE`](../LICENSE).
