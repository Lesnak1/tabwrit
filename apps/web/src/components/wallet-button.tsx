'use client';

import React from 'react';
import { Wallet, LogOut, Loader2 } from 'lucide-react';
import { useWallet } from '@/lib/wallet';
import { shorten } from '@/lib/rpc';
import { NETWORK } from '@/lib/config';

export function WalletButton() {
  const { accountId, walletName, connecting, connect, disconnect } =
    useWallet();

  if (accountId) {
    return (
      <div className="wallet-connected">
        <span className="network-dot" title={`NEAR ${NETWORK}`} />
        <span className="wallet-account mono" title={accountId}>
          {shorten(accountId, 5)}
        </span>
        {walletName ? <span className="wallet-name">{walletName}</span> : null}
        <button
          type="button"
          className="wallet-disconnect"
          onClick={disconnect}
          title="Disconnect wallet"
        >
          <LogOut size={14} />
        </button>
      </div>
    );
  }

  return (
    <button
      type="button"
      className="btn btn-primary btn-sm"
      onClick={connect}
      disabled={connecting}
    >
      {connecting ? (
        <>
          <Loader2 size={15} className="spin" /> Connecting
        </>
      ) : (
        <>
          <Wallet size={15} /> Connect wallet
        </>
      )}
    </button>
  );
}
