import fs from 'fs';
import path from 'path';

export interface SettlementReceipt {
  id: string;
  tabId: number;
  reference: string;
  timestamp: string;
  merchantAsset: string;
  merchantAmount: string;
  merchantRecipient: string;
  originAsset: string;
  originAmountIn: string;
  depositAddress: string;
  chargeTxHash: string;
  settlementStatus: string;
  explorerUrl?: string;
  details?: any;
}

export class ReceiptStore {
  private filePath: string;
  private receipts: SettlementReceipt[] = [];

  constructor(filePath?: string) {
    this.filePath = filePath || path.join(process.cwd(), 'receipts.json');
    this.load();
  }

  private load(): void {
    try {
      if (fs.existsSync(this.filePath)) {
        const data = fs.readFileSync(this.filePath, 'utf-8');
        this.receipts = JSON.parse(data);
      }
    } catch {
      this.receipts = [];
    }
  }

  private save(): void {
    try {
      fs.writeFileSync(this.filePath, JSON.stringify(this.receipts, null, 2));
    } catch (err) {
      console.error('Failed to save receipts file:', err);
    }
  }

  addReceipt(receipt: SettlementReceipt): void {
    this.receipts.unshift(receipt);
    this.save();
  }

  updateStatus(id: string, status: string, details?: any): void {
    const item = this.receipts.find((r) => r.id === id);
    if (item) {
      item.settlementStatus = status;
      if (details) item.details = details;
      this.save();
    }
  }

  listReceipts(tabId?: number): SettlementReceipt[] {
    if (tabId !== undefined) {
      return this.receipts.filter((r) => r.tabId === tabId);
    }
    return this.receipts;
  }

  getReceipt(id: string): SettlementReceipt | undefined {
    return this.receipts.find((r) => r.id === id);
  }
}
