import { NextRequest, NextResponse } from 'next/server';
import { chargeInvoiceGasless, gaslessAvailable } from '@/lib/server-meta-tx';
import { merchantConfig } from '@/lib/server-near';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';
export const maxDuration = 30;

type Receipt = {
  status: 'executed' | 'rejected' | 'failed' | 'error';
  reason?: string;
  txHash?: string;
  explorerUrl?: string;
  event?: any;
  gasless?: boolean;
  relayer?: string;
  sender?: string;
  gasPaidBy?: string;
};

const inFlight = new Map<string, Promise<Receipt>>();
const receipts = new Map<string, { at: number; value: Receipt }>();
const TTL_MS = 10 * 60 * 1000;

function cleanup() {
  const now = Date.now();
  for (const [key, value] of receipts) {
    if (now - value.at > TTL_MS) receipts.delete(key);
  }
}

export async function GET() {
  return NextResponse.json({
    ...merchantConfig(),
    gaslessAvailable: gaslessAvailable(),
  });
}

export async function POST(req: NextRequest) {
  try {
    if (!gaslessAvailable()) {
      return NextResponse.json(
        {
          error:
            'The gasless relayer is not configured on this deployment. Set KEEPER_URL and RELAYER_API_KEY, or use the direct merchant charge.',
          code: 'RELAYER_DISABLED',
        },
        { status: 503 }
      );
    }

    const body = await req.json();
    const tabId = Number(body?.tabId);
    const reference = String(body?.reference || `invoice-${tabId}`).slice(0, 128);
    if (!Number.isInteger(tabId) || tabId <= 0) {
      return NextResponse.json({ error: 'A valid tabId is required.' }, { status: 400 });
    }
    if (!reference) {
      return NextResponse.json({ error: 'A reference is required.' }, { status: 400 });
    }

    cleanup();
    const key = `${tabId}:${reference}`;
    const cached = receipts.get(key);
    if (cached) {
      return NextResponse.json({ ...cached.value, cached: true });
    }
    const pending = inFlight.get(key);
    if (pending) {
      const value = await pending;
      return NextResponse.json({ ...value, cached: true });
    }

    const promise = chargeInvoiceGasless(tabId, reference).then((result) => {
      const receipt: Receipt = {
        status: result.kind,
        reason: result.reason,
        txHash: result.txHash,
        explorerUrl: result.explorerUrl,
        event: result.event,
        gasless: result.gasless,
        relayer: result.relayer,
        sender: result.sender,
        gasPaidBy: result.gasPaidBy,
      };
      if (receipt.status === 'executed') {
        receipts.set(key, { at: Date.now(), value: receipt });
      }
      return receipt;
    });

    inFlight.set(key, promise);
    try {
      const result = await promise;
      const status =
        result.status === 'executed'
          ? 200
          : result.status === 'rejected'
          ? 409
          : result.status === 'failed'
          ? 502
          : 500;
      return NextResponse.json(
        { ...result, config: merchantConfig() },
        { status }
      );
    } finally {
      inFlight.delete(key);
    }
  } catch (err: any) {
    return NextResponse.json(
      { error: err?.message || 'Gasless merchant charge failed.' },
      { status: 500 }
    );
  }
}
