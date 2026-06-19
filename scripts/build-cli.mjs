#!/usr/bin/env node
/* Bundle the gage terminal CLI → dist/cli/gage.cjs (plain node, no Electron). */
import { build } from 'esbuild';
import { chmodSync } from 'node:fs';

await build({
  entryPoints: ['src/cli/index.ts'],
  outfile: 'dist/cli/gage.cjs',
  bundle: true,
  platform: 'node',
  target: 'node20',
  format: 'cjs',
  // better-sqlite3 is only reached under Electron; the CLI uses node:sqlite.
  external: ['better-sqlite3', 'electron'],
  logLevel: 'warning',
});
chmodSync('dist/cli/gage.cjs', 0o755);
console.log('built → dist/cli/gage.cjs  (run: node dist/cli/gage.cjs  |  or: npm link && gage)');
