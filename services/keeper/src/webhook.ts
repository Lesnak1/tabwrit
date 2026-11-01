import * as crypto from 'crypto';

export interface WebhookDispatchParams<T = any> {
  url: string;
  secret?: string;
  event:
    | 'tab.charge.deposited'
    | 'tab.settlement.succeeded'
    | 'tab.charge.failed'
    | 'tab.created';
  data: T;
}

export class WebhookDispatcher {
  private defaultSecret: string;

  constructor() {
    this.defaultSecret = process.env.TAB_WEBHOOK_SECRET || '';
  }

  /**
   * Dispatches an authenticated HMAC-SHA256 signed webhook to the merchant's endpoint.
   */
  async dispatch<T = any>(params: WebhookDispatchParams<T>): Promise<{ success: boolean; statusCode?: number; error?: string }> {
    const timestamp = Math.floor(Date.now() / 1000);
    const eventId = `evt_${crypto.randomUUID()}`;

    const payload = {
      id: eventId,
      event: params.event,
      created_at: timestamp,
      data: params.data,
    };

    const rawBody = JSON.stringify(payload);
    const secret = params.secret || this.defaultSecret;
    if (!secret) {
      return {
        success: false,
        error: 'A webhook signing secret is required.',
      };
    }

    const signature = crypto
      .createHmac('sha256', secret)
      .update(`${timestamp}.${rawBody}`, 'utf8')
      .digest('hex');

    const signatureHeader = `t=${timestamp},v1=${signature}`;

    try {
      console.log(`[Webhook] Dispatching ${params.event} to ${params.url} (Event: ${eventId})...`);

      const response = await fetch(params.url, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'User-Agent': 'Tab-Protocol-Keeper/1.0',
          'X-Tab-Signature': signatureHeader,
          'X-Tab-Event-Id': eventId,
        },
        body: rawBody,
        signal: AbortSignal.timeout(8000), // 8-second delivery timeout
      });

      if (!response.ok) {
        console.warn(`[Webhook] Merchant endpoint returned HTTP ${response.status}: ${response.statusText}`);
        return { success: false, statusCode: response.status, error: `HTTP ${response.status}` };
      }

      console.log(`[Webhook] ✓ Event ${eventId} successfully delivered to ${params.url} (HTTP ${response.status})`);
      return { success: true, statusCode: response.status };
    } catch (err: any) {
      console.error(`[Webhook] Delivery failed to ${params.url}:`, err.message);
      return { success: false, error: err.message };
    }
  }
}
