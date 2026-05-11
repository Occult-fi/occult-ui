/// <reference lib="webworker" />
import * as Comlink from 'comlink';
import init, {
  aes_decrypt,
  aes_encrypt,
  generate_transfer_proofs,
  generate_withdraw_proofs,
  version,
} from 'occult-wasm/occult_wasm.js';
import wasmUrl from 'occult-wasm/occult_wasm_bg.wasm?url';

let initialized: Promise<void> | null = null;
function ensureInit() {
  if (!initialized) initialized = init({ module_or_path: wasmUrl }).then(() => undefined);
  return initialized;
}

export type GenerateTransferProofsInput = {
  source_elgamal_keypair: Uint8Array;
  source_aes_key: Uint8Array;
  current_available_balance: Uint8Array;
  current_decryptable_available_balance: Uint8Array;
  transfer_amount: bigint;
  destination_elgamal_pubkey: Uint8Array;
  auditor_elgamal_pubkey: Uint8Array;
};

export type GenerateTransferProofsOutput = {
  equality_proof: Uint8Array;
  validity_proof: Uint8Array;
  range_proof: Uint8Array;
  auditor_ciphertext_lo: Uint8Array;
  auditor_ciphertext_hi: Uint8Array;
  new_decryptable_balance: Uint8Array;
};

export type GenerateWithdrawProofsInput = {
  elgamal_keypair: Uint8Array;
  current_available_balance: Uint8Array;
  current_balance: bigint;
  withdraw_amount: bigint;
};

export type GenerateWithdrawProofsOutput = {
  equality_proof: Uint8Array;
  range_proof: Uint8Array;
};

const api = {
  async version(): Promise<string> {
    await ensureInit();
    return version();
  },

  async aesDecrypt(keyBytes: Uint8Array, ciphertext: Uint8Array): Promise<bigint> {
    await ensureInit();
    return aes_decrypt(keyBytes, ciphertext);
  },

  async aesEncrypt(keyBytes: Uint8Array, value: bigint): Promise<Uint8Array> {
    await ensureInit();
    return aes_encrypt(keyBytes, value);
  },

  async generateTransferProofs(
    input: GenerateTransferProofsInput
  ): Promise<GenerateTransferProofsOutput> {
    await ensureInit();
    const out = (await generate_transfer_proofs({
      source_elgamal_keypair: input.source_elgamal_keypair,
      source_aes_key: input.source_aes_key,
      current_available_balance: input.current_available_balance,
      current_decryptable_available_balance: input.current_decryptable_available_balance,
      transfer_amount: input.transfer_amount,
      destination_elgamal_pubkey: input.destination_elgamal_pubkey,
      auditor_elgamal_pubkey: input.auditor_elgamal_pubkey,
    })) as GenerateTransferProofsOutput;
    return out;
  },

  async generateWithdrawProofs(
    input: GenerateWithdrawProofsInput
  ): Promise<GenerateWithdrawProofsOutput> {
    await ensureInit();
    const out = (await generate_withdraw_proofs({
      elgamal_keypair: input.elgamal_keypair,
      current_available_balance: input.current_available_balance,
      current_balance: input.current_balance,
      withdraw_amount: input.withdraw_amount,
    })) as GenerateWithdrawProofsOutput;
    return out;
  },
};

export type ProofWorker = typeof api;

Comlink.expose(api);
