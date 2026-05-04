# occult-ui

Front-end for the [Occult](https://github.com/Occult-fi/occult) confidential batch-auction AMM on Solana.

Pure client-side React app. No backend, no server-side rendering — proof generation happens in the browser via [`occult-wasm`](https://github.com/Occult-fi/occult-wasm), wallet signing via standard Solana wallet adapters.

## Stack

- Vite 7 + React 18 + TypeScript
- `@solana/web3.js`, `@solana/wallet-adapter-*`
- `react-router-dom` for routing (`/`, `/demo`, `/soon`)
- `comlink` for offloading WASM proof generation to a WebWorker
- `occult-wasm` for ZK proof generation (planned, currently mocked in `/demo`)

## Run

```bash
pnpm install
pnpm dev          # http://localhost:5173
pnpm build        # static dist/
```

Set the RPC endpoint via env:
```bash
VITE_RPC_URL=http://127.0.0.1:8899 pnpm dev
# or devnet:
VITE_RPC_URL=https://api.devnet.solana.com pnpm build
```

## Pages

- **`/`** — Landing. Hero with the redacted "seen." headline, problem comparison, three-step explainer, animated swap demo, technology grid, footer.
- **`/demo`** — Live demo. Encrypted orderbook (sealed sizes), swap card with wallet-adapter integration, batch progress bar in the header. Currently simulates the encrypt → queue → settle → seal sequence; the real flow lands when `occult-wasm` is plugged in.
- **`/soon`** — placeholder.

## Design system

- pure black ground (`#000`) + hairline whites
- redaction bar accent (`#1d1d1f`) — segmented, hover-to-reveal
- SF Pro Display / SF Mono via system stack
- 1440px page width, 160px section padding (compact: 96px)
- single-color, no gradients, no warm accent

See `src/landing.css` and `src/demo.css` for the full token system.

## License

Apache-2.0.
