import { Buffer } from 'buffer';
(globalThis as unknown as { Buffer: typeof Buffer }).Buffer = Buffer;

import { StrictMode, useMemo } from 'react';
import { createRoot } from 'react-dom/client';
import { BrowserRouter, Routes, Route } from 'react-router-dom';
import { ConnectionProvider, WalletProvider } from '@solana/wallet-adapter-react';
import { PhantomWalletAdapter, SolflareWalletAdapter } from '@solana/wallet-adapter-wallets';
import { DemoWalletAdapter } from './wallet/DemoWalletAdapter';

import './index.css';
import './wallet.css';

import Landing from './pages/Landing';
import Demo from './pages/Demo';
import Pools from './pages/Pools';
import Soon from './pages/Soon';

const RPC_ENDPOINT = import.meta.env.VITE_RPC_URL ?? 'http://127.0.0.1:8899';

function Root() {
  const wallets = useMemo(
    () => [
      new PhantomWalletAdapter(),
      new SolflareWalletAdapter(),
      new DemoWalletAdapter(),
    ],
    []
  );
  return (
    <ConnectionProvider endpoint={RPC_ENDPOINT}>
      <WalletProvider wallets={wallets} autoConnect>
        <BrowserRouter>
          <Routes>
            <Route path="/" element={<Landing />} />
            <Route path="/demo" element={<Demo />} />
            <Route path="/pools" element={<Pools />} />
            <Route path="/soon" element={<Soon />} />
          </Routes>
        </BrowserRouter>
      </WalletProvider>
    </ConnectionProvider>
  );
}

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <Root />
  </StrictMode>
);
