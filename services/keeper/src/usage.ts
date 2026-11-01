import fs from 'fs';
import path from 'path';

export interface RelayUsageRecord {
  senderId: string;
  relays: number;
  tokensBurntYocto: string;
  lastTxHash?: string;
  lastAt: string;
}

export interface RelayUsageTotals {
  relays: number;
  tokensBurntYocto: string;
  senders: number;
}

/**
 * Off-chain gas meter for the NEP-366 relayer.
 *
 * The contract cannot take a fee: the vault transfers the exact charged
 * amount to the receiver, and a Function-Call key delegate may contain only
 * one `charge` action. Sustainability therefore has to be metered off-chain.
 * This store records the actual `tokens_burnt` of each successful relay per
 * sender. A production deployment can compare this usage with a prepaid
 * credit balance before accepting the next delegate.
 *
 * The file is gitignored. It contains public account IDs, transaction hashes
 * and gas amounts, never keys.
 */
export class RelayUsageStore {
  private filePath: string;
  private records: Record<string, RelayUsageRecord> = {};

  constructor(filePath?: string) {
    this.filePath =
      filePath ||
      process.env.RELAYER_USAGE_FILE ||
      path.join(process.cwd(), 'relay-usage.json');
    this.load();
  }

  private load(): void {
    try {
      if (!fs.existsSync(this.filePath)) return;
      const parsed = JSON.parse(fs.readFileSync(this.filePath, 'utf8'));
      if (parsed && typeof parsed === 'object' && !Array.isArray(parsed)) {
        this.records = parsed;
      }
    } catch {
      this.records = {};
    }
  }

  private save(): void {
    try {
      fs.writeFileSync(
        this.filePath,
        JSON.stringify(this.records, null, 2),
        'utf8'
      );
    } catch (err: any) {
      console.error('[relayer] could not write usage file:', err?.message || err);
    }
  }

  record(
    senderId: string,
    tokensBurntYocto: bigint,
    txHash?: string
  ): RelayUsageRecord {
    const previous = this.records[senderId];
    const record: RelayUsageRecord = {
      senderId,
      relays: (previous?.relays || 0) + 1,
      tokensBurntYocto: (
        BigInt(previous?.tokensBurntYocto || '0') + tokensBurntYocto
      ).toString(),
      lastTxHash: txHash,
      lastAt: new Date().toISOString(),
    };
    this.records[senderId] = record;
    this.save();
    return record;
  }

  get(senderId: string): RelayUsageRecord | null {
    return this.records[senderId] || null;
  }

  all(): RelayUsageRecord[] {
    return Object.values(this.records).sort((a, b) =>
      a.senderId.localeCompare(b.senderId)
    );
  }

  totals(): RelayUsageTotals {
    let relays = 0;
    let tokensBurntYocto = 0n;
    for (const record of Object.values(this.records)) {
      relays += record.relays;
      try {
        tokensBurntYocto += BigInt(record.tokensBurntYocto);
      } catch {
        // ignore malformed historical record
      }
    }
    return {
      relays,
      tokensBurntYocto: tokensBurntYocto.toString(),
      senders: Object.keys(this.records).length,
    };
  }
}
