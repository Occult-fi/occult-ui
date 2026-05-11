import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'

// `@metaplex-foundation/beet` (used by the shank/solita-generated client)
// pulls in node-style `assert`+`util`, which expect a global `process` and
// `globalThis === global`. Browsers have neither, so we shim the bare
// minimum here. Same trick as the Solana web3.js docs recommend.
export default defineConfig({
  plugins: [react()],
  define: {
    global: 'globalThis',
    'process.env': {},
    'process.platform': '"browser"',
    'process.version': '""',
  },
})
