# SOURCES.md — external references

Accessed and re-checked on 2026-10-24 unless noted. Facts derived from these
sources are recorded in [`VERIFIED_FACTS.md`](VERIFIED_FACTS.md). Anything not
verified there is not used as a product claim.

## NEAR protocol and standards

| Topic | URL |
| :--- | :--- |
| NEAR documentation | https://docs.near.org/ |
| Access keys (Function-Call restrictions) | https://docs.near.org/protocol/accounts-contracts/access-keys |
| NEP-141 fungible token | https://nomicon.io/Standards/Tokens/FungibleToken/Core |
| NEP-145 storage management | https://nomicon.io/Standards/StorageManagement |
| NEP-297 event format | https://nomicon.io/Standards/EventsFormat |
| NEP-366 meta transactions | https://github.com/near/NEPs/blob/master/neps/nep-0366.md |
| near-sdk-rs | https://github.com/near/near-sdk-rs |
| near-contract-standards | https://github.com/near/near-contract-standards |
| NEAR testnet RPC (FastNear) | https://test.rpc.fastnear.com |
| NearBlocks testnet explorer | https://testnet.nearblocks.io/ |

## NEAR Intents / 1Click

| Topic | URL |
| :--- | :--- |
| NEAR Intents docs | https://docs.near-intents.org/ |
| 1Click production API | https://1click.chaindefuser.com |
| 1Click OpenAPI | https://1click.chaindefuser.com/docs/v0/openapi.yaml |
| 1Click token list | https://1click.chaindefuser.com/v0/tokens |
| 1Click quote endpoint | `POST https://1click.chaindefuser.com/v0/quote` |
| 1Click status endpoint | `GET https://1click.chaindefuser.com/v0/status` |
| 1Click deposit submit | `POST https://1click.chaindefuser.com/v0/deposit/submit` |

The live API was queried with `dry: true` and `dry: false` during the audit.
The `dry: false` quote generated a deposit address but no transaction was
sent to it.

## Wallets and frontend

| Topic | URL |
| :--- | :--- |
| HOT Labs NEAR Connect | https://github.com/hot-dao/near-selector |
| Next.js | https://nextjs.org/docs |
| React | https://react.dev |
| lucide-react | https://lucide.dev |
| FastNear | https://fastnear.com |

## Tooling

| Topic | URL |
| :--- | :--- |
| Binaryen / wasm-opt | https://github.com/WebAssembly/binaryen |
| wasm-opt npm | https://github.com/MrRefactoring/wasm-opt |
| near-api-js | https://github.com/near/near-api-js |
| Express | https://expressjs.com |
| TypeScript | https://www.typescriptlang.org |

## Hackathon

| Topic | URL |
| :--- | :--- |
| NEAR Hackathon live spec | https://nearhackathon.com/HACKATHON.md |
| Submission form | https://nearhackathon.com/#apply |
| Submission API | `POST https://nearhackathon.com/api/applications` |

The live hackathon spec at `https://nearhackathon.com/HACKATHON.md` was read
on 2026-10-24 and re-read on 2026-11-01. Dates and rules may change; re-read the
live file before submitting.

## What was not used as a source

- No endpoint, contract address, asset ID, SDK method or version was invented.
- Every protocol claim is backed by the live specification or an on-chain
  testnet receipt.
