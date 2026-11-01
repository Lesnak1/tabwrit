import { NextRequest, NextResponse } from 'next/server';
import { quotePreview, PreviewChain } from '@/lib/server-oneclick';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

const EVM = /^0x[a-fA-F0-9]{40}$/;
const SOLANA = /^[1-9A-HJ-NP-Za-km-z]{32,44}$/;

export async function POST(req: NextRequest) {
  try {
    const body = await req.json();
    const chain = String(body?.chain || 'base') as PreviewChain;
    const recipient = String(body?.recipient || '').trim();
    const amount = String(body?.amount || '10000000');

    if (!['base', 'arb', 'eth', 'sol'].includes(chain)) {
      return NextResponse.json(
        { error: 'chain must be one of base, arb, eth, sol.' },
        { status: 400 }
      );
    }
    if (chain === 'sol' ? !SOLANA.test(recipient) : !EVM.test(recipient)) {
      return NextResponse.json(
        {
          error:
            chain === 'sol'
              ? 'Enter a valid Solana base58 payout address.'
              : 'Enter a valid EVM 0x… payout address.',
        },
        { status: 400 }
      );
    }
    if (!/^\d+$/.test(amount) || BigInt(amount) <= 0n) {
      return NextResponse.json(
        { error: 'amount must be a positive integer in base units.' },
        { status: 400 }
      );
    }

    const result = await quotePreview({ chain, recipient, amount });
    return NextResponse.json(result);
  } catch (err: any) {
    return NextResponse.json(
      { error: err?.message || '1Click quote failed.' },
      { status: 422 }
    );
  }
}
