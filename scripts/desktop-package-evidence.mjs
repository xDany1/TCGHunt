import { readdirSync, readFileSync, statSync, writeFileSync, existsSync } from 'node:fs';
import { resolve, join, relative } from 'node:path';
import { createHash } from 'node:crypto';
import { DatabaseSync } from 'node:sqlite';
import assert from 'node:assert/strict';
const files = dir => readdirSync(dir, { withFileTypes: true }).flatMap(e => e.isDirectory() ? files(join(dir, e.name)) : [join(dir, e.name)]);
const hash = path => createHash('sha256').update(readFileSync(path)).digest('hex');
const packageDir = resolve('work/m4-build/Astra Alto'); const unpacked = resolve('work/m4-unpack-smoke/Astra Alto');
const entries = files(packageDir); const checksums = Object.fromEntries(entries.map(p => [relative(packageDir, p), hash(p)]));
assert.equal(files(unpacked).length, entries.length);
for (const [name, checksum] of Object.entries(checksums)) assert.equal(hash(join(unpacked, name)), checksum, name);
assert.ok(entries.every(p => !/\.sqlite(?:-|$)|node_modules/.test(p)));
const zip = resolve('outputs/AstraAlto-M4-Windows-x64.zip');
writeFileSync('outputs/M4_PACKAGE_MANIFEST.json', JSON.stringify({ status: 'PASS', meaning: 'Archive integrity and bundle layout only; runtime qualification is separate', zipBytes: statSync(zip).size, installedBytes: entries.reduce((n, p) => n + statSync(p).size, 0), fileCount: entries.length, zipSha256: hash(zip), unpackedMatches: true, includesDatabase: false, requiresDevelopmentToolchain: false, files: checksums }, null, 2));
const processEvidence = JSON.parse(readFileSync('outputs/M4_PACKAGED_COORDINATOR_FIXTURE_PROCESS.json', 'utf8'));
const dbPath = join(processEvidence.profile, 'astra.sqlite');
const final = { status: 'PARTIAL', runId: processEvidence.harnessDirectory, processExitCode: processEvidence.exitCode, rendererTested: false, live: false, externalRequests: 0, reason: 'ELECTRON_GPU_PROCESS_FAILURE', verification: 'Post-exit read-only inspection on host Node; not a successful Electron relaunch' };
if (existsSync(dbPath)) {
  const db = new DatabaseSync(dbPath, { readOnly: true });
  final.persisted = Object.fromEntries(['monitors', 'listing_observations', 'decision_evaluations', 'purchase_intents', 'audit_events', 'event_outbox', 'handler_receipts', 'checkout_attempts'].map(t => [t, db.prepare(`SELECT count(*) n FROM ${t}`).get().n]));
  final.schemaVersion = db.prepare('PRAGMA user_version').get().user_version;
  final.decisions = db.prepare('SELECT state,mode FROM purchase_intents').all();
  final.foreignKeysValid = db.prepare('PRAGMA foreign_key_check').all().length === 0; final.quickCheck = db.prepare('PRAGMA quick_check').get().quick_check; db.close();
}
writeFileSync('outputs/M4_PACKAGED_COORDINATOR_FIXTURE.json', JSON.stringify(final, null, 2));
console.log(JSON.stringify({ installedBytes: entries.reduce((n, p) => n + statSync(p).size, 0), zipBytes: statSync(zip).size, fileCount: entries.length, coordinator: final }));
