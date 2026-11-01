# NAMING.md — TabWrit

**Project name:** TabWrit  
**Primitive:** Tab  
**Rule:** Writ  
**Tagline:** *Every Tab has a Writ.*

---

## Why TabWrit

TabWrit separates the project from the primitive:

- **Tab** is the on-chain spending permission: caps, period budget, lifetime
  cap, expiry, receiver policy and nonce.
- **Writ** is the formal written order behind the Tab: the rule the contract
  enforces and the spender cannot rewrite.
- **TabWrit** is the protocol that issues and settles those Tabs.

The name is a deliberate answer to a naming problem: "Tab" is a good product
primitive but a weak, generic project name. Keeping "Tab" in the product and
adding "Writ" gives the project a distinctive name without renaming the
contract, accounts, package imports or evidence.

## Brand hierarchy

| Layer | Name | Use |
| :--- | :--- | :--- |
| Project / protocol | **TabWrit** | README, website, submission, X, docs |
| Primitive | **Tab** | `create_tab`, Tab cards, "Open a Tab" |
| Rule | **Writ** | The contract-enforced spending rule |
| Contract | `tab-vault.testnet` | Unchanged; on-chain identity |
| Token | `tab-usdc.testnet` | Unchanged; test token |

## Taglines

- **Every Tab has a Writ.**
- **The spending rule your agent can't rewrite.**
- **Open a Tab. Not your wallet.**
- **Contract-enforced spending Tabs for merchants and AI agents.**

## What does not change

- Contract account and code: `tab-vault.testnet` (0 keys, immutable).
- Token: `tab-usdc.testnet`.
- Spender/relayer accounts: `tab-merchant.testnet`, `tab-agent.testnet`,
  `tab-relayer.testnet`.
- Package names and imports: `@tab-protocol/*`.
- Contract methods and events: `create_tab`, `charge`, `tab_created`,
  `charge_executed`, etc.
- Evidence transaction links and testnet addresses.

This is a brand change, not a protocol migration. Renaming the on-chain
identities would invalidate the evidence and require a new deployment.

## Availability checks (2026-10-26, preliminary)

- `github.com/tabwrit` returned 404.
- `x.com/tabwrit` returned 404.
- `tabwrit.dev`, `.gg`, `.fi`, `.com` did not resolve in a DNS check;
  `tabwrit.xyz` returned a certificate error.

These are **preliminary** signals, not a legal or registrar guarantee. Before
registering a domain or committing to the name, check:

1. a domain registrar / WHOIS;
2. GitHub organization and X handle availability;
3. a trademark search in the relevant jurisdiction;
4. the hackathon submission's unique project-name rule.

The submission name is **TabWrit** (7 characters, within 2–80). If a judge or
organizer needs a longer form, use **TabWrit Protocol**.
