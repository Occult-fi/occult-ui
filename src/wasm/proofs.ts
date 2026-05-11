import * as Comlink from 'comlink';
import type {
  ProofWorker,
  GenerateTransferProofsInput,
  GenerateTransferProofsOutput,
  GenerateWithdrawProofsInput,
  GenerateWithdrawProofsOutput,
} from './worker';
import wasmInit, {
  aes_decrypt,
  aes_encrypt,
  version,
} from 'occult-wasm/occult_wasm.js';
import wasmUrl from 'occult-wasm/occult_wasm_bg.wasm?url';

// WASM runs on the main thread for sub-ms ops (AES, version) and on a worker
// for proof generation (~300–500 ms — would jank the UI thread).
// AES via worker hung Comlink init in some environments — keep it main-thread.

let mainInitPromise: Promise<void> | null = null;
function ensureMainInit(): Promise<void> {
  if (!mainInitPromise) {
    mainInitPromise = wasmInit({ module_or_path: wasmUrl }).then(() => undefined);
  }
  return mainInitPromise;
}

export async function wasmVersion(): Promise<string> {
  await ensureMainInit();
  return version();
}

export async function aesDecrypt(
  keyBytes: Uint8Array,
  ciphertext: Uint8Array
): Promise<bigint> {
  await ensureMainInit();
  return aes_decrypt(keyBytes, ciphertext);
}

export async function aesEncrypt(
  keyBytes: Uint8Array,
  value: bigint
): Promise<Uint8Array> {
  await ensureMainInit();
  return aes_encrypt(keyBytes, value);
}

let proxy: Comlink.Remote<ProofWorker> | null = null;
let worker: Worker | null = null;

function getProxy(): Comlink.Remote<ProofWorker> {
  if (!proxy) {
    worker = new Worker(new URL('./worker.ts', import.meta.url), { type: 'module' });
    proxy = Comlink.wrap<ProofWorker>(worker);
  }
  return proxy;
}

export async function generateTransferProofs(
  input: GenerateTransferProofsInput
): Promise<GenerateTransferProofsOutput> {
  return getProxy().generateTransferProofs(input);
}

export async function generateWithdrawProofs(
  input: GenerateWithdrawProofsInput
): Promise<GenerateWithdrawProofsOutput> {
  return getProxy().generateWithdrawProofs(input);
}

export type {
  GenerateTransferProofsInput,
  GenerateTransferProofsOutput,
  GenerateWithdrawProofsInput,
  GenerateWithdrawProofsOutput,
};
