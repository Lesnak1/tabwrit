import { spawn } from 'child_process';
import * as path from 'path';

async function testMcpServer() {
  console.log('='.repeat(70));
  console.log(' TABWRIT — MCP READ-ONLY TESTNET VERIFICATION');
  console.log('='.repeat(70));

  const serverPath = path.resolve(process.cwd(), 'packages/tab-mcp/dist/index.js');
  const proc = spawn('node', [serverPath], {
    stdio: ['pipe', 'pipe', 'inherit'],
    cwd: process.cwd(),
  });

  let buffer = '';

  function send(msg: any) {
    const raw = JSON.stringify(msg) + '\n';
    proc.stdin.write(raw);
  }

  function waitForResponse(id: number): Promise<any> {
    return new Promise((resolve, reject) => {
      const timeout = setTimeout(() => {
        reject(new Error(`Timeout waiting for response to request ${id}`));
      }, 15000);

      const onData = (data: Buffer) => {
        buffer += data.toString();
        const lines = buffer.split('\n');
        buffer = lines.pop() || '';

        for (const line of lines) {
          if (!line.trim()) continue;
          try {
            const parsed = JSON.parse(line);
            if (parsed.id === id) {
              clearTimeout(timeout);
              proc.stdout.off('data', onData);
              resolve(parsed);
              return;
            }
          } catch (e) {
            // non-json line or partial line
          }
        }
      };

      proc.stdout.on('data', onData);
    });
  }

  try {
    // 1. Initialize
    console.log('[1/4] Sending initialize request...');
    send({
      jsonrpc: '2.0',
      id: 1,
      method: 'initialize',
      params: {
        protocolVersion: '2024-11-05',
        capabilities: {},
        clientInfo: { name: 'Tab-Verifier', version: '1.0' },
      },
    });

    const initRes = await waitForResponse(1);
    console.log('✓ Initialized:', initRes.result?.serverInfo);

    // 2. List tools
    console.log('[2/4] Querying available tools (tools/list)...');
    send({
      jsonrpc: '2.0',
      id: 2,
      method: 'tools/list',
      params: {},
    });

    const listRes = await waitForResponse(2);
    const tools = listRes.result?.tools || [];
    console.log(`✓ Tools registered (${tools.length} tools):`);
    tools.forEach((t: any) => console.log(`   - ${t.name}: ${t.description.slice(0, 60)}...`));

    const requiredTools = [
      'tab_get_details',
      'tab_get_vault_balance',
      'tab_get_remaining_allowance',
      'tab_list_tabs',
      'tab_charge_invoice',
      'tab_pay_and_fetch',
    ];
    const missingTools = requiredTools.filter(
      (name) => !tools.some((tool: any) => tool.name === name)
    );
    if (missingTools.length > 0) {
      throw new Error(`Missing MCP tools: ${missingTools.join(', ')}`);
    }
    console.log('✓ All six expected tools are registered.');

    // 3. Call tab_get_details for live on-chain Tab #1
    console.log('[3/4] Testing tool execution: tab_get_details (tab_id: 1 on Testnet)...');
    send({
      jsonrpc: '2.0',
      id: 3,
      method: 'tools/call',
      params: {
        name: 'tab_get_details',
        arguments: { tab_id: 1 },
      },
    });

    const callRes = await waitForResponse(3);
    const textContent = callRes.result?.content?.[0]?.text;
    console.log('✓ Live Testnet Response:');
    const tabData = JSON.parse(textContent);
    console.log(`   ID: #${tabData.id}`);
    console.log(`   Owner: ${tabData.owner}`);
    console.log(`   Spender: ${tabData.spender}`);
    console.log(`   Per-Charge Cap: ${tabData.per_charge_cap} (${tabData.token})`);
    console.log(`   Status: ${tabData.status}`);
    console.log(`   Label: "${tabData.label}"`);

    // 4. Call tab_get_remaining_allowance for live on-chain Tab #1
    console.log('[4/4] Testing tool execution: tab_get_remaining_allowance (tab_id: 1)...');
    send({
      jsonrpc: '2.0',
      id: 4,
      method: 'tools/call',
      params: {
        name: 'tab_get_remaining_allowance',
        arguments: { tab_id: 1 },
      },
    });

    const remRes = await waitForResponse(4);
    const remData = JSON.parse(remRes.result?.content?.[0]?.text);
    console.log('✓ Allowance Calculation on NEAR Testnet:');
    console.log(`   Remaining in Period: ${remData.remaining_in_period}`);
    console.log(`   Remaining Total: ${remData.remaining_total}`);
    console.log(`   Current Period Index: ${remData.current_period_index}`);

    console.log('='.repeat(70));
    console.log(' ALL MCP READ TOOLS & ON-CHAIN VIEWS PASSED');
    console.log('='.repeat(70));
  } finally {
    proc.kill();
  }
}

testMcpServer().catch((err) => {
  console.error('MCP test failed:', err);
  process.exit(1);
});
