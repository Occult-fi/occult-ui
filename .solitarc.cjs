// Solita config — consumes the shank-generated IDL and emits a typed
// TS client into src/protocol/generated. Run via `pnpm gen:client`.
const path = require('path');

module.exports = {
  idlGenerator: 'shank',
  programName: 'occult_amm',
  // The IDL JSON is produced by `shank idl` from programs/occult-amm.
  idlDir: path.join(__dirname, '..', 'occult', 'idl'),
  // Where the generated TS lives.
  sdkDir: path.join(__dirname, 'src', 'protocol', 'generated'),
  // Used only for shank invocation when running `solita idl` (we don't —
  // we run `shank idl` ourselves), but solita validates the field exists.
  binaryInstallDir: path.join(__dirname, '.crates'),
  programDir: path.join(__dirname, '..', 'occult', 'programs', 'occult-amm'),
  rustbin: { locked: true, versionRangeFallback: '0.4.6' },
};
