import 'server-only';

export interface OneClickToken {
  assetId: string;
  decimals: number;
  blockchain: string;
  symbol: string;
  price: number;
  priceUpdatedAt: string;
  contractAddress?: string;
}

export type PreviewChain = 'base' | 'arb' | 'eth' | 'sol';

const ONE_CLICK =
  process.env.ONECLICK_API_URL || 'https://1click.chaindefuser.com';
const MAINNET_USDC =
  'nep141:17208628f84f5d6ad33f0da3bbbeb27ffcb398eac501a31bd6ad2011e36133a1';
const REFUND_ACCOUNT = process.env.ONECLICK_REFUND_ACCOUNT || 'near.near';

let tokenCache: { at: number; tokens: OneClickToken[] } | null = null;

async function getTokens(): Promise<OneClickToken[]> {
  if (tokenCache && Date.now() - tokenCache.at < 60_000) {
    return tokenCache.tokens;
  }
  const res = await fetch(`${ONE_CLICK}/v0/tokens`, {
    headers: { 'Content-Type': 'application/json' },
    cache: 'no-store',
  });
  if (!res.ok) {
    throw new Error(`1Click token list failed: ${res.status}`);
  }
  const tokens = (await res.json()) as OneClickToken[];
  tokenCache = { at: Date.now(), tokens };
  return tokens;
}

export async function quotePreview(params: {
  chain: PreviewChain;
  recipient: string;
  amount: string;
}) {
  const tokens = await getTokens();
  const origin = tokens.find((t) => t.assetId === MAINNET_USDC);
  const destination = tokens.find(
    (t) => t.blockchain === params.chain && t.symbol === 'USDC'
  );

  if (!origin) {
    throw new Error('Mainnet USDC is not listed by 1Click right now.');
  }
  if (!destination) {
    throw new Error(`1Click does not list USDC on ${params.chain}.`);
  }

  const body = {
    dry: true,
    swapType: 'EXACT_OUTPUT',
    slippageTolerance: 100,
    originAsset: origin.assetId,
    depositType: 'ORIGIN_CHAIN',
    destinationAsset: destination.assetId,
    amount: params.amount,
    refundTo: REFUND_ACCOUNT,
    refundType: 'ORIGIN_CHAIN',
    recipient: params.recipient,
    recipientType: 'DESTINATION_CHAIN',
    deadline: new Date(Date.now() + 10 * 60 * 1000).toISOString(),
  };

  const res = await fetch(`${ONE_CLICK}/v0/quote`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
    cache: 'no-store',
  });

  const text = await res.text();
  if (!res.ok) {
    let message = text;
    try {
      message = JSON.parse(text).message || text;
    } catch {
      // keep raw text
    }
    throw new Error(`1Click quote failed (${res.status}): ${message}`);
  }

  const payload = JSON.parse(text);
  return {
    mode: 'quote-only' as const,
    note:
      'Live mainnet 1Click route preview. No funds move on the testnet demo; a funded mainnet vault is required to execute it.',
    origin: {
      assetId: origin.assetId,
      symbol: origin.symbol,
      blockchain: origin.blockchain,
      contractAddress: origin.contractAddress,
    },
    destination: {
      assetId: destination.assetId,
      symbol: destination.symbol,
      blockchain: destination.blockchain,
      contractAddress: destination.contractAddress,
      recipient: params.recipient,
    },
    refundTo: REFUND_ACCOUNT,
    quote: {
      amountIn: payload.quote?.amountIn,
      amountInFormatted: payload.quote?.amountInFormatted,
      amountInUsd: payload.quote?.amountInUsd,
      minAmountIn: payload.quote?.minAmountIn,
      amountOut: payload.quote?.amountOut,
      amountOutFormatted: payload.quote?.amountOutFormatted,
      amountOutUsd: payload.quote?.amountOutUsd,
      timeEstimate: payload.quote?.timeEstimate,
      deadline: payload.quote?.deadline,
    },
    quoteRequest: payload.quoteRequest,
    correlationId: payload.correlationId,
    signature: payload.signature,
  };
}
