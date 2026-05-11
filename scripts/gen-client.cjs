#!/usr/bin/env node
/* eslint-disable @typescript-eslint/no-require-imports */
//
// Generates TypeScript client from the shank-emitted IDL JSON.
//
// Pipeline:
//   programs/occult-amm        → shank idl ─→ idl/occult_amm.json
//   idl/occult_amm.json        → post-process (inject args struct types
//                                              + ciphertext byte aliases)
//   {patched IDL}              → Solita     → src/protocol/generated/
//
// We bypass solita's CLI (which requires a `.solitarc.js` config — incompatible
// with our ESM root package) and call the `Solita` class directly.
//
// The post-process step exists because `shank` emits args structs as
// `{ "defined": "FooArgs" }` references but doesn't add the structs to
// `idl.types`. We hand-define them here mirroring the Rust source in
// programs/occult-amm/src/instruction.rs and processor/close_batch.rs.
// If you change those Rust structs, update the shapes below.

const fs = require('fs');
const path = require('path');

const REPO_ROOT = path.join(__dirname, '..');
const IDL_FILE = path.join(REPO_ROOT, '..', 'occult', 'idl', 'occult_amm.json');
const OUT_DIR = path.join(REPO_ROOT, 'src', 'protocol', 'generated');
const PROGRAM_ID = '4vTNEf7bpNoYXQJPtQNFYaRxJ8tnvNmSwHW6iAUcz4Gq';

const u8 = 'u8';
const u16 = 'u16';
const u32 = 'u32';
const u64 = 'u64';
const i8 = 'i8';

const ae = { array: [u8, 36] };       // AeCiphertextBytes
const elgamal = { array: [u8, 64] };  // ElGamalCiphertextBytes
const pubkeyBytes = { array: [u8, 32] };

// Mirror of Rust args structs. Keep in sync with programs/occult-amm/src
// instruction.rs and processor/close_batch.rs. Each struct has the same
// wire layout as the corresponding `#[repr(C)] bytemuck::Pod` struct.
const ARGS_TYPES = [
  {
    name: 'InitPoolArgs',
    type: {
      kind: 'struct',
      fields: [
        { name: 'auditorElgamalPubkey', type: pubkeyBytes },
        { name: 'batchWindowSlots', type: u32 },
        { name: 'batchSize', type: u16 },
        { name: 'feeBps', type: u16 },
      ],
    },
  },
  {
    name: 'InitVaultArgs',
    type: {
      kind: 'struct',
      fields: [
        { name: 'elgamalPubkey', type: pubkeyBytes },
        { name: 'maximumPendingBalanceCreditCounter', type: u64 },
        { name: 'decryptableZeroBalance', type: ae },
        { name: 'side', type: u8 },
        { name: 'padding', type: { array: [u8, 3] } },
      ],
    },
  },
  {
    name: 'SubmitOrderArgs',
    type: {
      kind: 'struct',
      fields: [
        { name: 'side', type: u8 },
        { name: 'batchBump', type: u8 },
        { name: 'ticketBump', type: u8 },
        { name: 'transferIxOffset', type: i8 },
        { name: 'padding', type: { array: [u8, 4] } },
      ],
    },
  },
  {
    name: 'CloseBatchArgs',
    type: {
      kind: 'struct',
      fields: [
        { name: 'newDecryptableAvailableBalance', type: ae },
        { name: 'hdrPad', type: { array: [u8, 4] } },
        { name: 'expectedPendingCreditCounter', type: u64 },
        { name: 'totalInDecrypted', type: u64 },
        { name: 'totalOutCredited', type: u64 },
        { name: 'clearingRatioQ32', type: u64 },
      ],
    },
  },
  {
    name: 'ClaimArgs',
    type: {
      kind: 'struct',
      fields: [
        { name: 'outputAmount', type: u64 },
        { name: 'auditorCiphertextLo', type: elgamal },
        { name: 'auditorCiphertextHi', type: elgamal },
        { name: 'newSourceDecryptableAvailableBalance', type: ae },
        { name: 'padding', type: { array: [u8, 4] } },
      ],
    },
  },
  {
    name: 'SetReservesArgs',
    type: {
      kind: 'struct',
      fields: [
        { name: 'reserveA', type: u64 },
        { name: 'reserveB', type: u64 },
      ],
    },
  },
  {
    name: 'FundPoolVaultArgs',
    type: {
      kind: 'struct',
      fields: [
        { name: 'amount', type: u64 },
        { name: 'expectedPendingCreditCounter', type: u64 },
        { name: 'newDecryptableAvailableBalance', type: ae },
        { name: 'padding', type: { array: [u8, 4] } },
        { name: 'side', type: u8 },
        { name: 'decimals', type: u8 },
        { name: 'padding2', type: { array: [u8, 6] } },
      ],
    },
  },
  {
    name: 'InitWrapperArgs',
    type: {
      kind: 'struct',
      fields: [
        { name: 'auditorElgamalPubkey', type: pubkeyBytes },
        { name: 'wrapperBump', type: u8 },
        // 0 = SPL legacy wrapper, 1 = native SOL wrapper.
        { name: 'kind', type: u8 },
        { name: 'pad', type: { array: [u8, 6] } },
      ],
    },
  },
  {
    name: 'WrapArgs',
    type: {
      kind: 'struct',
      fields: [
        { name: 'amount', type: u64 },
        { name: 'auditorCiphertextLo', type: elgamal },
        { name: 'auditorCiphertextHi', type: elgamal },
        { name: 'newSourceDecryptableAvailableBalance', type: ae },
        { name: 'pad', type: { array: [u8, 4] } },
      ],
    },
  },
  {
    name: 'UnwrapArgs',
    type: {
      kind: 'struct',
      fields: [
        { name: 'amount', type: u64 },
        { name: 'decimals', type: u64 },
        { name: 'newDecryptableAfterWithdraw', type: ae },
        { name: 'pad', type: { array: [u8, 4] } },
      ],
    },
  },
  {
    name: 'InitLpMintArgs',
    type: {
      kind: 'struct',
      fields: [
        { name: 'poolBump', type: u8 },
        { name: 'pad', type: { array: [u8, 7] } },
        { name: 'name', type: { array: [u8, 32] } },
        { name: 'symbol', type: { array: [u8, 16] } },
        { name: 'uri', type: { array: [u8, 256] } },
      ],
    },
  },
  {
    name: 'AddLiquidityArgs',
    type: {
      kind: 'struct',
      fields: [
        { name: 'poolBump', type: u8 },
        { name: 'requestBump', type: u8 },
        { name: 'pad', type: { array: [u8, 6] } },
        { name: 'requestCounter', type: u64 },
        { name: 'newDepVaultADecryptable', type: ae },
        { name: 'newDepVaultBDecryptable', type: ae },
        { name: 'newDepASourceDecryptable', type: ae },
        { name: 'newDepBSourceDecryptable', type: ae },
        { name: 'newVaultADecryptable', type: ae },
        { name: 'newVaultBDecryptable', type: ae },
        { name: 'newLpSourceDecryptable', type: ae },
        { name: 'tailPad', type: { array: [u8, 4] } },
      ],
    },
  },
  {
    name: 'LpDepositRequestArgs',
    type: {
      kind: 'struct',
      fields: [
        { name: 'amountA', type: u64 },
        { name: 'amountB', type: u64 },
        { name: 'minLpOut', type: u64 },
        { name: 'requestCounter', type: u64 },
        { name: 'requestBump', type: u8 },
        { name: 'pad', type: { array: [u8, 7] } },
      ],
    },
  },
  {
    name: 'RemoveLiquidityArgs',
    type: {
      kind: 'struct',
      fields: [
        { name: 'lpAmount', type: u64 },
        { name: 'minAmountA', type: u64 },
        { name: 'minAmountB', type: u64 },
        { name: 'poolBump', type: u8 },
        { name: 'decimalsA', type: u8 },
        { name: 'decimalsB', type: u8 },
        { name: 'pad', type: { array: [u8, 5] } },
        { name: 'vaultANewSourceDecryptable', type: ae },
        { name: 'pad2', type: { array: [u8, 4] } },
        { name: 'vaultBNewSourceDecryptable', type: ae },
        { name: 'pad3', type: { array: [u8, 4] } },
      ],
    },
  },
];

async function main() {
  if (!fs.existsSync(IDL_FILE)) {
    console.error(`IDL not found at ${IDL_FILE}.`);
    console.error('Run `shank idl -r programs/occult-amm -o idl` first.');
    process.exit(1);
  }

  fs.rmSync(OUT_DIR, { recursive: true, force: true });
  fs.mkdirSync(OUT_DIR, { recursive: true });

  const idl = JSON.parse(fs.readFileSync(IDL_FILE, 'utf8'));

  // Inject args struct types so solita can resolve `defined: <Args>` refs.
  idl.types = idl.types ?? [];
  const existing = new Set(idl.types.map((t) => t.name));
  for (const t of ARGS_TYPES) {
    if (!existing.has(t.name)) idl.types.push(t);
  }

  // Solita reads idl.metadata.address for the program ID emitted into
  // generated index.ts. Shank doesn't populate this.
  idl.metadata = { ...(idl.metadata ?? {}), address: PROGRAM_ID };

  const { Solita } = require('@metaplex-foundation/solita');
  const solita = new Solita(idl, {
    formatCode: false,
    prependGeneratedWarning: true,
  });
  await solita.renderAndWriteTo(OUT_DIR);

  // Post-process: solita emits constructor parameter properties and angle-
  // bracket casts; both are forbidden by the project's
  // `erasableSyntaxOnly` + `verbatimModuleSyntax` tsconfig. We strip them
  // here so the generated code type-checks under the strict app config.
  postProcessGenerated(OUT_DIR);

  console.log(`✓ generated TS client → ${path.relative(REPO_ROOT, OUT_DIR)}`);
}

function postProcessGenerated(dir) {
  const tsFiles = [];
  walk(dir, tsFiles);
  for (const file of tsFiles) {
    let src = fs.readFileSync(file, 'utf8');
    let changed = false;

    // 1. Convert `import { ArgsType, argsBeet } from '../types/Foo'`
    //    → `import type { ArgsType } from '../types/Foo'` plus
    //      `import { argsBeet } from '../types/Foo'`
    //    Solita generates exactly one of these per Args struct.
    src = src.replace(
      /import\s+\{\s*([A-Z][A-Za-z0-9_]+Args)\s*,\s*([a-z][A-Za-z0-9_]+ArgsBeet)\s*\}\s+from\s+(['"][^'"]+['"])/g,
      (_m, typeName, beetName, mod) => {
        changed = true;
        return `import type { ${typeName} } from ${mod};\nimport { ${beetName} } from ${mod}`;
      },
    );

    // 2. Convert <X>expr  →  expr as X. Limit to the patterns solita emits
    //    in the pretty() helper: <{ toNumber: () => number }>this.field
    src = src.replace(
      /<\s*\{\s*toNumber:\s*\(\)\s*=>\s*number\s*\}\s*>\s*(this\.[A-Za-z_][A-Za-z0-9_]*)/g,
      (_m, expr) => {
        changed = true;
        return `(${expr} as { toNumber: () => number })`;
      },
    );

    // 3. Strip constructor parameter properties:
    //    private constructor(readonly tag: number, ...) {}
    //    →
    //    readonly tag: number; ...
    //    private constructor(args: { tag: number; ... }) {
    //      this.tag = args.tag; ...
    //    }
    //    Easier: remove `readonly ` from the parameter list and re-emit a
    //    field block before the constructor. The constructor itself is then
    //    only used via `fromArgs`, so we can leave the body empty if we
    //    initialise fields ourselves.
    if (/private constructor\(\s*readonly /.test(src)) {
      src = transformParameterProperties(src);
      changed = true;
    }

    if (changed) fs.writeFileSync(file, src);
  }
}

// Replace `private constructor(readonly a: T1, readonly b: T2) {}` with
// explicit field declarations + body assignments:
//   readonly a: T1;
//   readonly b: T2;
//   private constructor(a: T1, b: T2) {
//     this.a = a;
//     this.b = b;
//   }
function transformParameterProperties(src) {
  return src.replace(
    /private constructor\(\s*([\s\S]*?)\)\s*\{\s*\}/m,
    (full, paramsBlock) => {
      const params = splitParams(paramsBlock).filter((p) => p.trim().length > 0);
      const fields = [];
      const cleanParams = [];
      const assigns = [];
      for (const p of params) {
        const m = p.match(/^\s*readonly\s+([A-Za-z_][A-Za-z0-9_]*)\s*:\s*([\s\S]+?)\s*$/);
        if (!m) {
          cleanParams.push(p);
          continue;
        }
        const [, name, type] = m;
        fields.push(`readonly ${name}: ${type};`);
        cleanParams.push(`${name}: ${type}`);
        assigns.push(`this.${name} = ${name};`);
      }
      return `${fields.join('\n  ')}\n  private constructor(\n    ${cleanParams.join(',\n    ')}\n  ) {\n    ${assigns.join('\n    ')}\n  }`;
    },
  );
}

// Split a parameter list on top-level commas (ignoring those inside
// braces / brackets / parens — solita doesn't generate generics here but
// the type body may contain commas in array sizes, e.g. `number[] /* size: 4 */`).
function splitParams(s) {
  const out = [];
  let depth = 0;
  let buf = '';
  for (const ch of s) {
    if (ch === '(' || ch === '[' || ch === '{' || ch === '<') depth++;
    else if (ch === ')' || ch === ']' || ch === '}' || ch === '>') depth--;
    if (ch === ',' && depth === 0) {
      out.push(buf);
      buf = '';
    } else {
      buf += ch;
    }
  }
  if (buf.trim().length > 0) out.push(buf);
  return out;
}

function walk(dir, out) {
  for (const ent of fs.readdirSync(dir, { withFileTypes: true })) {
    const full = path.join(dir, ent.name);
    if (ent.isDirectory()) walk(full, out);
    else if (ent.isFile() && full.endsWith('.ts')) out.push(full);
  }
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
