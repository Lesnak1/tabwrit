/**
 * OneClickClient — Production client for NEAR Intents 1Click API.
 * Communicates directly with https://1click.chaindefuser.com.
 * Live API client; no mock data or fallback quotes.
 */

export interface OneClickToken {
  assetId: string;
  decimals: number;
  blockchain: string;
  symbol: string;
  price: number;
  priceUpdatedAt: string;
  contractAddress?: string;
  coingeckoId?: string;
}

export interface QuoteRequestParams {
  dry: boolean;
  swapType: 'EXACT_OUTPUT' | 'EXACT_INPUT' | 'FLEX_INPUT' | 'ANY_INPUT';
  slippageTolerance: number; // in basis points, e.g. 100 for 1%
  originAsset: string;
  depositType: 'ORIGIN_CHAIN' | 'INTENTS' | 'CONFIDENTIAL_INTENTS';
  destinationAsset: string;
  amount: string; // base units as string
  refundTo: string;
  refundType: 'ORIGIN_CHAIN' | 'INTENTS' | 'CONFIDENTIAL_INTENTS';
  recipient: string;
  recipientType: 'DESTINATION_CHAIN' | 'INTENTS' | 'CONFIDENTIAL_INTENTS';
  deadline?: string;
}

export interface QuoteResponsePayload {
  correlationId: string;
  timestamp: string;
  signature: string;
  quoteRequest: QuoteRequestParams;
  quote: {
    depositAddress?: string;
    depositMemo?: string;
    amountIn: string;
    amountInFormatted: string;
    amountInUsd: string;
    minAmountIn: string;
    amountOut: string;
    amountOutFormatted: string;
    amountOutUsd: string;
    minAmountOut: string;
    timeEstimate: number;
    deadline?: string;
    refundFee?: string;
    withdrawFee?: string;
  };
}

export interface SwapExecutionStatus {
  status: 'PENDING_DEPOSIT' | 'INCOMPLETE_DEPOSIT' | 'PROCESSING' | 'SUCCESS' | 'REFUNDED' | 'FAILED';
  depositAddress: string;
  swapDetails?: {
    amountIn?: string;
    amountOut?: string;
    nearTxHashes?: string[];
    originChainTxHashes?: Array<{ hash: string; explorerUrl: string }>;
    destinationChainTxHashes?: Array<{ hash: string; explorerUrl: string }>;
  };
}

export class OneClickClient {
  private baseUrl: string;
  private jwt?: string;

  constructor(baseUrl = 'https://1click.chaindefuser.com', jwt?: string) {
    this.baseUrl = baseUrl.replace(/\/$/, '');
    this.jwt = jwt || process.env.ONECLICK_JWT;
  }

  private getHeaders(): Record<string, string> {
    const headers: Record<string, string> = {
      'Content-Type': 'application/json',
    };
    if (this.jwt) {
      headers['Authorization'] = `Bearer ${this.jwt}`;
    }
    return headers;
  }

  /**
   * Retrieves list of all tokens currently supported by 1Click.
   */
  async getTokens(): Promise<OneClickToken[]> {
    const res = await fetch(`${this.baseUrl}/v0/tokens`, {
      method: 'GET',
      headers: this.getHeaders(),
    });
    if (!res.ok) {
      throw new Error(`1Click getTokens failed: ${res.status} ${await res.text()}`);
    }
    return (await res.json()) as OneClickToken[];
  }

  /**
   * Fetches an authoritative swap quote.
   * If dry=false, generates a unique, one-time depositAddress on NEAR.
   */
  async getQuote(params: QuoteRequestParams): Promise<QuoteResponsePayload> {
    const deadline =
      params.deadline ||
      new Date(Date.now() + 60 * 60 * 1000).toISOString(); // 1 hour default

    const body = {
      ...params,
      deadline,
    };

    const res = await fetch(`${this.baseUrl}/v0/quote`, {
      method: 'POST',
      headers: this.getHeaders(),
      body: JSON.stringify(body),
    });

    if (!res.ok) {
      const errText = await res.text();
      throw new Error(`1Click getQuote failed (${res.status}): ${errText}`);
    }

    return (await res.json()) as QuoteResponsePayload;
  }

  /**
   * Submits origin transaction hash to expedite solver detection.
   */
  async submitDepositTx(depositAddress: string, txHash: string): Promise<boolean> {
    try {
      const res = await fetch(`${this.baseUrl}/v0/deposit/submit`, {
        method: 'POST',
        headers: this.getHeaders(),
        body: JSON.stringify({
          depositAddress,
          txHash,
        }),
      });
      return res.ok;
    } catch {
      return false;
    }
  }

  /**
   * Checks real-time swap execution status.
   */
  async getStatus(depositAddress: string, depositMemo?: string): Promise<SwapExecutionStatus> {
    let url = `${this.baseUrl}/v0/status?depositAddress=${encodeURIComponent(depositAddress)}`;
    if (depositMemo) {
      url += `&depositMemo=${encodeURIComponent(depositMemo)}`;
    }

    const res = await fetch(url, {
      method: 'GET',
      headers: this.getHeaders(),
    });

    if (!res.ok) {
      throw new Error(`1Click getStatus failed (${res.status}): ${await res.text()}`);
    }

    return (await res.json()) as SwapExecutionStatus;
  }
}
