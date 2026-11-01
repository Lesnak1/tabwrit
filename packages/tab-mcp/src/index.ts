#!/usr/bin/env node
import { Server } from '@modelcontextprotocol/sdk/server/index.js';
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js';
import {
  CallToolRequestSchema,
  ListToolsRequestSchema,
  Tool,
} from '@modelcontextprotocol/sdk/types.js';
import { TabNearClient } from './near-client.js';
import { payAndFetch } from './x402-client.js';
import 'dotenv/config';

const client = new TabNearClient();

const TOOLS: Tool[] = [
  {
    name: 'tab_get_details',
    description:
      'Fetches the live on-chain status, spending limits, authorized spender, and history of a Tab on NEAR Testnet.',
    inputSchema: {
      type: 'object',
      properties: {
        tab_id: {
          type: 'number',
          description: 'The unique numeric ID of the Tab on NEAR.',
        },
      },
      required: ['tab_id'],
    },
  },
  {
    name: 'tab_get_vault_balance',
    description:
      'Queries the available deposited token balance of an owner in the Tab Vault on NEAR Testnet.',
    inputSchema: {
      type: 'object',
      properties: {
        owner: {
          type: 'string',
          description:
            'The NEAR account ID of the vault owner. Defaults to the configured account if omitted.',
        },
        token: {
          type: 'string',
          description:
            'The NEP-141 token account ID (e.g., "tab-usdc.testnet"). Defaults to TAB_TOKEN_ID.',
        },
      },
    },
  },
  {
    name: 'tab_get_remaining_allowance',
    description:
      'Calculates the exact remaining spending allowance for a Tab in the current time-period and lifetime total.',
    inputSchema: {
      type: 'object',
      properties: {
        tab_id: {
          type: 'number',
          description: 'The numeric ID of the Tab.',
        },
      },
      required: ['tab_id'],
    },
  },
  {
    name: 'tab_list_tabs',
    description:
      'Lists all active, paused, and revoked Tabs associated with an account on NEAR Testnet.',
    inputSchema: {
      type: 'object',
      properties: {
        account_id: {
          type: 'string',
          description: 'The NEAR account ID to query. Defaults to configured account if omitted.',
        },
        role: {
          type: 'string',
          enum: ['owner', 'spender'],
          description:
            'Query Tabs where the account is the owner (payer) or spender (authorized payee/agent). Defaults to "owner".',
        },
        limit: {
          type: 'number',
          description: 'Maximum number of Tabs to return (max 50).',
        },
      },
    },
  },
  {
    name: 'tab_charge_invoice',
    description:
      'Executes a pull-payment charge against an active Tab. The contract enforces the spender, per-charge/period/lifetime caps, expiry, status, receiver allowlist and nonce. A policy violation returns status=REJECTED with the exact on-chain reason; it does not move funds.',
    inputSchema: {
      type: 'object',
      properties: {
        tab_id: {
          type: 'number',
          description: 'The numeric ID of the Tab to charge.',
        },
        amount: {
          type: 'string',
          description: 'Amount in atomic token units to charge.',
        },
        receiver_id: {
          type: 'string',
          description: 'NEAR account ID of the settlement payee/receiver.',
        },
        reference: {
          type: 'string',
          description: 'Invoice number or payment reference identifier.',
        },
      },
      required: ['tab_id', 'amount', 'receiver_id', 'reference'],
    },
  },
  {
    name: 'tab_pay_and_fetch',
    description:
      'Pays an x402-style HTTP 402 resource from a Tab and returns the data only after the on-chain charge_executed event is verified. The client preflights the Tab and the contract enforces caps, receiver allowlist, expiry and nonce. Default host allowlist: 127.0.0.1 and localhost; set TAB_X402_ALLOWED_HOSTS for a hosted paid API.',
    inputSchema: {
      type: 'object',
      properties: {
        url: {
          type: 'string',
          description: 'HTTP(S) URL of the paid resource. Plain HTTP is only allowed for localhost.',
        },
        tab_id: {
          type: 'number',
          description: 'The numeric ID of the Tab that pays the invoice.',
        },
        max_amount: {
          type: 'string',
          description:
            'Optional client-side maximum in atomic token units. The on-chain per-charge cap is always enforced by the contract.',
        },
      },
      required: ['url', 'tab_id'],
    },
  },
];

function normalizeReason(reason: unknown): string | undefined {
  if (typeof reason !== 'string' || !reason) return undefined;
  if (reason.includes('_')) return reason;
  return reason.replace(/([A-Z])/g, '_$1').toUpperCase().replace(/^_/, '');
}

const server = new Server(
  {
    name: 'tab-protocol-mcp',
    version: '0.1.0',
  },
  {
    capabilities: {
      tools: {},
    },
  }
);

server.setRequestHandler(ListToolsRequestSchema, async () => {
  return { tools: TOOLS };
});

server.setRequestHandler(CallToolRequestSchema, async (request) => {
  const { name, arguments: args } = request.params;

  try {
    switch (name) {
      case 'tab_get_details': {
        const tabId = Number(args?.tab_id);
        const tab = await client.getTab(tabId);
        if (!tab) {
          return {
            content: [{ type: 'text', text: `Tab with ID #${tabId} was not found on-chain.` }],
            isError: true,
          };
        }
        return {
          content: [
            {
              type: 'text',
              text: JSON.stringify(tab, null, 2),
            },
          ],
        };
      }

      case 'tab_get_vault_balance': {
        const owner = (args?.owner as string) || client.accountId;
        const token =
          (args?.token as string) ||
          process.env.TAB_TOKEN_ID ||
          'tab-usdc.testnet';
        const balance = await client.getVaultBalance(owner, token);
        return {
          content: [
            {
              type: 'text',
              text: JSON.stringify(
                {
                  contract_id: client.contractId,
                  owner,
                  token,
                  vault_balance: balance,
                  network: client.networkId,
                },
                null,
                2
              ),
            },
          ],
        };
      }

      case 'tab_get_remaining_allowance': {
        const tabId = Number(args?.tab_id);
        const remaining = await client.getRemainingAllowance(tabId);
        if (!remaining) {
          return {
            content: [{ type: 'text', text: `Tab #${tabId} not found or inactive.` }],
            isError: true,
          };
        }
        return {
          content: [
            {
              type: 'text',
              text: JSON.stringify(
                {
                  tab_id: tabId,
                  remaining_in_period: remaining.remaining_in_period,
                  remaining_total: remaining.remaining_total,
                  current_period_index: remaining.current_period_index,
                },
                null,
                2
              ),
            },
          ],
        };
      }

      case 'tab_list_tabs': {
        const accountId = (args?.account_id as string) || client.accountId;
        const role = (args?.role as string) || 'owner';
        const limit = Number(args?.limit) || 20;

        const tabs =
          role === 'spender'
            ? await client.listTabsBySpender(accountId, 0, limit)
            : await client.listTabsByOwner(accountId, 0, limit);

        return {
          content: [
            {
              type: 'text',
              text: JSON.stringify(
                {
                  account_id: accountId,
                  role,
                  count: tabs.length,
                  tabs,
                },
                null,
                2
              ),
            },
          ],
        };
      }

      case 'tab_charge_invoice': {
        const result = await client.charge(
          Number(args?.tab_id),
          String(args?.amount),
          String(args?.receiver_id),
          String(args?.reference)
        );

        const executed = result.events.find((e) => e.event === 'charge_executed');
        const rejected = result.events.find((e) => e.event === 'charge_rejected');
        const failed = result.events.find((e) => e.event === 'charge_failed');
        const rejectedReason = normalizeReason(
          result.executionResult?.Rejected?.reason || rejected?.data?.reason
        );
        const status = executed
          ? 'EXECUTED'
          : rejected || result.executionResult?.Rejected
          ? 'REJECTED'
          : failed
          ? 'FAILED'
          : 'SUBMITTED';
        const reason = rejectedReason || normalizeReason(failed?.data?.reason);

        return {
          content: [
            {
              type: 'text',
              text: JSON.stringify(
                {
                  status,
                  allowed: status === 'EXECUTED',
                  reason,
                  nonce: result.nonce,
                  execution_result: result.executionResult,
                  event: executed || rejected || failed || null,
                  tx_hash: result.txHash,
                  explorer_url: `https://testnet.nearblocks.io/txns/${result.txHash}`,
                },
                null,
                2
              ),
            },
          ],
          ...(status === 'FAILED' ? { isError: true } : {}),
        };
      }

      case 'tab_pay_and_fetch': {
        const result = await payAndFetch(client, {
          url: String(args?.url),
          tabId: Number(args?.tab_id),
          maxAmount:
            args?.max_amount === undefined ? undefined : String(args.max_amount),
        });

        return {
          content: [
            {
              type: 'text',
              text: JSON.stringify(result, null, 2),
            },
          ],
          ...(result.status === 'ERROR' || result.status === 'FAILED'
            ? { isError: true }
            : {}),
        };
      }

      default:
        throw new Error(`Unknown tool requested: ${name}`);
    }
  } catch (error: any) {
    return {
      content: [
        {
          type: 'text',
          text: `[Tab MCP Error] ${error?.message || String(error)}`,
        },
      ],
      isError: true,
    };
  }
});

async function run() {
  const transport = new StdioServerTransport();
  await server.connect(transport);
  console.error('[Tab MCP Server] Running and listening on stdio (NEAR Network:', client.networkId, ')');
}

run().catch((err) => {
  console.error('[Tab MCP Server Fatal Error]', err);
  process.exit(1);
});
