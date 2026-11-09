import './globals.css';
import Link from 'next/link';
import React from 'react';
import { WalletProvider } from '@/lib/wallet';
import { WalletButton } from '@/components/wallet-button';
import { CONTRACT_URL, IS_TESTNET, NETWORK, VAULT_ID } from '@/lib/config';

export const metadata = {
  title: 'TabWrit — Contract-Enforced Spending Tabs on NEAR',
  description:
    'TabWrit turns a vault into capped, expiring, revocable spending Tabs for merchants and AI agents. A prompt injection hits the contract, not your wallet. Scoped keys, on-chain receiver allowlists, NEP-366 gasless charges and a real x402-style agent payment demo.',
};

export default function RootLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return (
    <html lang="en">
      <body>
        <WalletProvider>
          <nav className="navbar">
            <div className="nav-brand">
              <Link href="/" className="brand-link">
                <span className="brand-mark">TW</span>
                <span className="brand-word">
                  Tab<span className="brand-word-accent">Writ</span>
                </span>
              </Link>
              <span className="brand-badge">
                {IS_TESTNET ? 'Testnet' : 'Mainnet'}
              </span>
            </div>

            <div className="nav-links">
              <Link href="/" className="nav-link">
                Overview
              </Link>
              <Link href="/app" className="nav-link">
                Vault
              </Link>
              <Link href="/merchant" className="nav-link">
                Merchant
              </Link>
              <Link href="/lab" className="nav-link">
                Attack Lab
              </Link>
              <Link href="/judge" className="nav-link">
                Policy
              </Link>
              <Link href="/docs" className="nav-link">
                Docs
              </Link>
            </div>

            <div className="nav-actions">
              <span className="network-badge" title={`NEAR ${NETWORK}`}>
                <span className="network-dot" />
                {NETWORK}
              </span>
              <WalletButton />
            </div>
          </nav>

          <main>{children}</main>

          <footer className="footer">
            <div className="container footer-inner">
              <div>
                <strong>TabWrit</strong> — contract-enforced spending Tabs
                on NEAR.
              </div>
              <div className="footer-links">
                <a href={CONTRACT_URL} target="_blank" rel="noreferrer">
                  Vault contract
                </a>
                <span className="footer-sep">·</span>
                <span className="mono">{VAULT_ID}</span>
                <span className="footer-sep">·</span>
                <span>Built at NEAR Hackathon 2026</span>
                <span className="footer-sep">·</span>
                <span>MIT</span>
              </div>
            </div>
          </footer>
        </WalletProvider>
      </body>
    </html>
  );
}
