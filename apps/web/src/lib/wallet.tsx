'use client';

import React, {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useRef,
  useState,
} from 'react';
import { NETWORK } from './config';

type WalletCall = {
  receiverId: string;
  methodName: string;
  args: Record<string, unknown>;
  gas?: string;
  deposit?: string;
};

type WalletContextValue = {
  ready: boolean;
  connecting: boolean;
  accountId: string | null;
  walletName: string | null;
  error: string | null;
  connect: () => Promise<void>;
  disconnect: () => Promise<void>;
  call: (input: WalletCall) => Promise<{ txHash: string; outcome?: any }>;
  clearError: () => void;
};

const WalletContext = createContext<WalletContextValue | null>(null);

const GAS_50_TGAS = '50000000000000';
const GAS_100_TGAS = '100000000000000';

export function WalletProvider({ children }: { children: React.ReactNode }) {
  const selectorRef = useRef<any>(null);
  const walletRef = useRef<any>(null);
  const initPromiseRef = useRef<Promise<any> | null>(null);
  const connectTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  const [ready, setReady] = useState(false);
  const [connecting, setConnecting] = useState(false);
  const [accountId, setAccountId] = useState<string | null>(null);
  const [walletName, setWalletName] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  const init = useCallback(async () => {
    if (initPromiseRef.current) return initPromiseRef.current;

    initPromiseRef.current = (async () => {
      const mod: any = await import('@hot-labs/near-connect');
      const selector = new mod.NearConnector({
        network: NETWORK,
        autoConnect: false,
        footerBranding: null,
      });
      selectorRef.current = selector;

      selector.on('wallet:signIn', (payload: any) => {
        if (!payload?.success) {
          setError('Wallet sign-in was rejected.');
          setConnecting(false);
          if (connectTimerRef.current) {
            clearTimeout(connectTimerRef.current);
            connectTimerRef.current = null;
          }
          return;
        }
        const first = payload.accounts?.[0];
        walletRef.current = payload.wallet;
        setAccountId(first?.accountId || null);
        setWalletName(payload.wallet?.manifest?.name || null);
        setConnecting(false);
        if (connectTimerRef.current) {
          clearTimeout(connectTimerRef.current);
          connectTimerRef.current = null;
        }
        setError(null);
      });

      selector.on('wallet:signOut', () => {
        walletRef.current = null;
        setAccountId(null);
        setWalletName(null);
      });

      // Do not block the page on the remote wallet manifest or IndexedDB.
      // The UI can render immediately; a saved session is restored in the
      // background with a hard timeout.
      setReady(true);

      Promise.race([
        selector.getConnectedWallet(),
        new Promise((_, reject) =>
          setTimeout(() => reject(new Error('wallet session timeout')), 8000)
        ),
      ])
        .then((connected: any) => {
          if (connected?.accounts?.[0]?.accountId) {
            walletRef.current = connected.wallet;
            setAccountId(connected.accounts[0].accountId);
            setWalletName(connected.wallet?.manifest?.name || null);
          }
        })
        .catch(() => {
          // No saved session, or the manifest was unreachable. The user can
          // still click Connect.
        });

      return selector;
    })();

    return initPromiseRef.current;
  }, []);

  useEffect(() => {
    init().catch((err: any) => {
      setError(err?.message || 'Failed to load the NEAR wallet connector.');
      setReady(true);
    });
  }, [init]);

  const connect = useCallback(async () => {
    setError(null);
    setConnecting(true);
    if (connectTimerRef.current) clearTimeout(connectTimerRef.current);
    connectTimerRef.current = setTimeout(() => {
      connectTimerRef.current = null;
      setConnecting(false);
    }, 180000);
    try {
      await init();
      const selector = selectorRef.current;
      if (!selector) throw new Error('Wallet connector is not ready.');
      // connect() opens the wallet picker and signs in with the selected
      // wallet. The wallet:signIn event updates the account state.
      await selector.connect();
    } catch (err: any) {
      const message =
        typeof err === 'string'
          ? err
          : err?.message || 'Could not connect the wallet.';
      // Closing the picker is a normal cancellation, not an error.
      if (!/user rejected|wallet closed|closed/i.test(message)) {
        setError(message);
      }
    } finally {
      setConnecting(false);
      if (connectTimerRef.current) {
        clearTimeout(connectTimerRef.current);
        connectTimerRef.current = null;
      }
    }
  }, [init]);

  const disconnect = useCallback(async () => {
    try {
      if (selectorRef.current && walletRef.current) {
        await selectorRef.current.disconnect(walletRef.current);
      }
    } catch {
      // Ignore disconnect errors; clear local state anyway.
    }
    walletRef.current = null;
    setAccountId(null);
    setWalletName(null);
  }, []);

  const call = useCallback(
    async (input: WalletCall): Promise<{ txHash: string; outcome?: any }> => {
      await init();
      const wallet = walletRef.current || (await selectorRef.current?.wallet());
      if (!wallet) {
        throw new Error('Connect a NEAR wallet first.');
      }

      const outcome = await wallet.signAndSendTransaction({
        receiverId: input.receiverId,
        actions: [
          {
            type: 'FunctionCall',
            params: {
              methodName: input.methodName,
              args: input.args,
              gas: input.gas || GAS_50_TGAS,
              deposit: input.deposit || '0',
            },
          },
        ],
      });

      const status = outcome?.status;
      if (status && typeof status === 'object' && 'Failure' in status) {
        throw new Error('The transaction failed on-chain. Check the wallet activity for details.');
      }

      const txHash =
        outcome?.transaction?.hash ||
        outcome?.transaction_outcome?.id ||
        outcome?.transaction_outcome?.transaction?.hash;
      if (!txHash) {
        throw new Error('The wallet returned no transaction hash.');
      }
      return { txHash, outcome };
    },
    [init]
  );

  const value = useMemo<WalletContextValue>(
    () => ({
      ready,
      connecting,
      accountId,
      walletName,
      error,
      connect,
      disconnect,
      call,
      clearError: () => setError(null),
    }),
    [ready, connecting, accountId, walletName, error, connect, disconnect, call]
  );

  return <WalletContext.Provider value={value}>{children}</WalletContext.Provider>;
}

export function useWallet(): WalletContextValue {
  const ctx = useContext(WalletContext);
  if (!ctx) {
    throw new Error('useWallet must be used inside WalletProvider');
  }
  return ctx;
}

export const GAS = {
  FT_TRANSFER_CALL: GAS_50_TGAS,
  CREATE_TAB: GAS_50_TGAS,
  CHARGE: GAS_100_TGAS,
  WITHDRAW: GAS_100_TGAS,
};
