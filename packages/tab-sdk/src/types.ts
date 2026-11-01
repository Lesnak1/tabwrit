export type WebhookEventName =
  | 'tab.charge.deposited'
  | 'tab.settlement.succeeded'
  | 'tab.charge.failed'
  | 'tab.created';

/**
 * Signed webhook envelope emitted by the optional merchant keeper.
 *
 * The signature is HMAC-SHA256 over `${timestamp}.${rawBody}` and is sent in
 * the `X-Tab-Signature: t=<unix seconds>,v1=<hex>` header.
 */
export interface WebhookEvent<T = unknown> {
  id: string;
  event: WebhookEventName;
  created_at: number;
  data: T;
}
