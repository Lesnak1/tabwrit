import http from 'http';
import { verifyTabWebhookSignature } from './src/verifier.js';
import { WebhookDispatcher } from '../../services/keeper/src/webhook.js';

/**
 * Unit test for the merchant webhook verifier. The payload below is a
 * fixture, not a settlement. The real settlement evidence lives in
 * docs/evidence/testnet-e2e.json.
 */
async function testWebhookVerifier() {
  console.log('='.repeat(70));
  console.log(' TAB PROTOCOL — MERCHANT WEBHOOK SIGNATURE UNIT TEST');
  console.log(' Real HMAC-SHA256, local HTTP server, no live settlement');
  console.log('='.repeat(70));

  const testSecret = 'whsec_test_fixture_do_not_use_in_production';
  let receivedWebhook: any = null;
  let receivedSignature = '';
  let receivedRawBody = '';

  const server = http.createServer((req, res) => {
    let body = '';
    req.on('data', (chunk) => {
      body += chunk;
    });
    req.on('end', () => {
      receivedRawBody = body;
      receivedSignature = (req.headers['x-tab-signature'] as string) || '';
      try {
        receivedWebhook = JSON.parse(body);
        res.writeHead(200, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ received: true }));
      } catch (err: any) {
        res.writeHead(400);
        res.end(err.message);
      }
    });
  });

  await new Promise<void>((resolve) => {
    server.listen(0, '127.0.0.1', () => resolve());
  });

  const address = server.address() as any;
  const merchantWebhookUrl = `http://127.0.0.1:${address.port}/api/webhooks/tab`;
  console.log(`[1/3] Local merchant listener: ${merchantWebhookUrl}`);

  try {
    const dispatcher = new WebhookDispatcher();
    const dispatchRes = await dispatcher.dispatch({
      url: merchantWebhookUrl,
      secret: testSecret,
      event: 'tab.charge.deposited',
      data: {
        fixture: true,
        note: 'Unit-test fixture, not a settlement',
        tabId: 1,
        reference: 'fixture-invoice',
        chargeTxHash: 'unit-test-fixture',
        amountIn: '15000000',
      },
    });

    if (!dispatchRes.success) {
      throw new Error(`Dispatch failed: ${dispatchRes.error}`);
    }
    console.log(`[2/3] Signed webhook delivered with HTTP ${dispatchRes.statusCode}`);

    const verification = verifyTabWebhookSignature(
      receivedRawBody,
      receivedSignature,
      testSecret,
      300
    );
    if (!verification.isValid) {
      throw new Error(`Signature verification failed: ${verification.error}`);
    }
    console.log('✓ HMAC signature verified');
    console.log(`  Event: ${verification.event?.event}`);
    console.log(`  ID: ${verification.event?.id}`);

    console.log('[3/3] Tamper and replay defenses...');
    const tamperedBody = receivedRawBody.replace('15000000', '99999999');
    const tamperCheck = verifyTabWebhookSignature(
      tamperedBody,
      receivedSignature,
      testSecret
    );
    if (tamperCheck.isValid) throw new Error('Tampered body was accepted!');
    console.log('✓ Tampered body rejected');

    const wrongSecret = verifyTabWebhookSignature(
      receivedRawBody,
      receivedSignature,
      'whsec_wrong'
    );
    if (wrongSecret.isValid) throw new Error('Wrong secret was accepted!');
    console.log('✓ Wrong secret rejected');

    const staleHeader = receivedSignature.replace(/t=\d+/, 't=1600000000');
    const staleCheck = verifyTabWebhookSignature(
      receivedRawBody,
      staleHeader,
      testSecret,
      300
    );
    if (staleCheck.isValid) throw new Error('Stale timestamp was accepted!');
    console.log('✓ Stale/replayed timestamp rejected');

    console.log('='.repeat(70));
    console.log(' WEBHOOK SIGNATURE UNIT TEST PASSED');
    console.log('='.repeat(70));
  } finally {
    server.close();
  }
}

testWebhookVerifier().catch((err) => {
  console.error('Test failed:', err);
  process.exit(1);
});
