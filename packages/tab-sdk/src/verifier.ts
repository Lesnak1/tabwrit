import * as crypto from 'crypto';
import { WebhookEvent } from './types.js';

export interface WebhookVerificationResult<T = any> {
  isValid: boolean;
  event?: WebhookEvent<T>;
  error?: string;
}

/**
 * Verifies the authenticity of an incoming Tab Protocol webhook.
 *
 * Implements standard HMAC-SHA256 signature verification with replay attack protection.
 * Format: X-Tab-Signature: t=<timestamp>,v1=<hmac_sha256_hex>
 *
 * @param rawBody - The unparsed stringified HTTP request body
 * @param signatureHeader - Value of the X-Tab-Signature header
 * @param webhookSecret - Merchant's shared webhook signing secret
 * @param toleranceSecs - Maximum allowable age of the webhook in seconds (default: 300s / 5m)
 */
export function verifyTabWebhookSignature<T = any>(
  rawBody: string,
  signatureHeader: string,
  webhookSecret: string,
  toleranceSecs = 300
): WebhookVerificationResult<T> {
  if (!signatureHeader) {
    return { isValid: false, error: 'Missing X-Tab-Signature header' };
  }

  if (!webhookSecret) {
    return { isValid: false, error: 'Missing webhook signing secret' };
  }

  const parts = signatureHeader.split(',');
  let timestampStr: string | undefined;
  let signatureHex: string | undefined;

  for (const part of parts) {
    const [key, val] = part.trim().split('=');
    if (key === 't') timestampStr = val;
    if (key === 'v1') signatureHex = val;
  }

  if (!timestampStr || !signatureHex) {
    return { isValid: false, error: 'Malformed signature header: missing "t" or "v1"' };
  }

  const timestamp = parseInt(timestampStr, 10);
  if (isNaN(timestamp)) {
    return { isValid: false, error: 'Invalid timestamp format in signature header' };
  }

  const nowSecs = Math.floor(Date.now() / 1000);
  if (Math.abs(nowSecs - timestamp) > toleranceSecs) {
    return { isValid: false, error: `Webhook timestamp exceeds tolerance of ${toleranceSecs}s` };
  }

  const signedPayload = `${timestamp}.${rawBody}`;
  const computedSignature = crypto
    .createHmac('sha256', webhookSecret)
    .update(signedPayload, 'utf8')
    .digest('hex');

  // Constant-time buffer comparison to prevent timing attacks
  const sigBuf = Buffer.from(signatureHex, 'hex');
  const compBuf = Buffer.from(computedSignature, 'hex');

  if (sigBuf.length !== compBuf.length || !crypto.timingSafeEqual(sigBuf, compBuf)) {
    return { isValid: false, error: 'Signature mismatch' };
  }

  try {
    const event = JSON.parse(rawBody) as WebhookEvent<T>;
    return { isValid: true, event };
  } catch (err: any) {
    return { isValid: false, error: `Invalid JSON body: ${err?.message}` };
  }
}
