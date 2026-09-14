// Read-only M4.5 evidence. No application startup, network, migrations or raw payload export.
import { readFileSync, readdirSync, statSync, writeFileSync } from 'node:fs';
import { resolve, join, relative } from 'node:path';
import { createHash } from 'node:crypto';
import { DatabaseSync } from 'node:sqlite';

const [directory, databasePath, output] = process.argv.slice(2);
if (!directory || !databasePath || !output) throw new Error('Usage: node scripts/m4-final-runtime-info.mjs PACKAGE_DIRECTORY DATABASE_PATH OUTPUT_JSON');
const hash = path => createHash('sha256').update(readFileSync(path)).digest('hex');
const files = dir => readdirSync(dir, { withFileTypes: true }).flatMap(e => e.isDirectory() ? files(join(dir, e.name)) : [join(dir, e.name)]);
const report = { recordedAt: new Date().toISOString(), executable: resolve(directory, 'AstraAlto.exe'), databasePath: resolve(databasePath), readOnly: true, externalRequests: 0, runtimeAssociation: 'Confirm this database path in the running application footer; file inspection alone does not prove process ownership.' };
try {
  const manifest = JSON.parse(readFileSync('outputs/M4_PACKAGE_MANIFEST.json', 'utf8'));
  const entries = files(directory);
  const mismatches = Object.entries(manifest.files).filter(([name, expected]) => hash(join(directory, name)) !== expected).map(([name]) => name);
  const extras = entries.map(p => relative(directory, p)).filter(p => !Object.hasOwn(manifest.files, p));
  const zip = 'outputs/AstraAlto-M4-Windows-x64.zip';
  report.package = { status: mismatches.length || extras.length ? 'FAIL' : 'PASS', fileCount: entries.length, extractedBytes: entries.reduce((n, p) => n + statSync(p).size, 0), mismatches, extras, zipBytes: statSync(zip).size, zipSha256: hash(zip), zipMatchesManifest: hash(zip) === manifest.zipSha256 };
  const previous = JSON.parse(readFileSync('outputs/M4_SQLITE_PROBE.json', 'utf8'));
  report.priorPackagedRuntime = { provenance: 'Prior actual M4 Electron SQLite probe; not a new runtime probe', sameExecutableHash: hash(join(directory, 'AstraAlto.exe')) === manifest.files['AstraAlto.exe'], electron: previous.versions.electron, chromium: previous.versions.chrome, node: previous.versions.node, sqlite: previous.sqlite };
} catch (error) { report.package = { status: 'NOT_TESTED', reason: error.code ?? 'PACKAGE_INSPECTION_FAILED' }; }
let db;
try {
  db = new DatabaseSync(databasePath, { readOnly: true });
  db.exec('PRAGMA query_only=ON; BEGIN');
  const tables = ['store_instances', 'store_products', 'variants', 'listings', 'sellers', 'offers', 'monitors', 'monitor_runs', 'listing_observations', 'decision_evaluations', 'purchase_intents', 'checkout_attempts', 'audit_events', 'event_outbox', 'handler_receipts'];
  report.database = {
    status: 'PASS', mode: 'Read-only transaction snapshot; no migration/checkpoint/backup/write',
    schemaVersion: db.prepare('PRAGMA user_version').get().user_version,
    inspectorSqliteVersion: db.prepare('SELECT sqlite_version() version').get().version,
    quickCheck: db.prepare('PRAGMA quick_check').get().quick_check,
    foreignKeyViolations: db.prepare('PRAGMA foreign_key_check').all().length,
    counts: Object.fromEntries(tables.map(t => [t, db.prepare(`SELECT count(*) n FROM ${t}`).get().n])),
    monitors: db.prepare('SELECT id,status,current_revision,version FROM monitors ORDER BY id LIMIT 100').all(),
    settings: db.prepare('SELECT store_enabled,live_reads_used,last_failure_at,last_failure FROM desktop_settings WHERE id=1').get(),
    identities: db.prepare('SELECT p.store_id,p.external_id product,v.external_id variant,l.id listing,f.id offer,s.external_id seller FROM store_products p JOIN variants v ON v.product_id=p.id JOIN listings l ON l.variant_id=v.id JOIN offers f ON f.listing_id=l.id JOIN sellers s ON s.id=f.seller_id ORDER BY f.id LIMIT 100').all(),
    outcomes: db.prepare('SELECT outcome,count(*) n FROM decision_evaluations GROUP BY outcome').all(),
    intents: db.prepare('SELECT mode,state,count(*) n FROM purchase_intents GROUP BY mode,state').all(),
    outbox: db.prepare('SELECT status,count(*) n FROM event_outbox GROUP BY status').all(),
    lastObservation: db.prepare('SELECT max(received_at) receivedAt FROM listing_observations').get()
  };
  if (report.database.quickCheck !== 'ok' || report.database.foreignKeyViolations) report.database.status = 'FAIL';
  db.exec('ROLLBACK');
} catch (error) { report.database = { status: 'NOT_TESTED', reason: error.code ?? 'DATABASE_INSPECTION_FAILED' }; }
finally { db?.close(); }
writeFileSync(output, JSON.stringify(report, null, 2) + '\n');
console.log(JSON.stringify(report));
if (report.package.status !== 'PASS' || !report.package.zipMatchesManifest || report.database.status !== 'PASS') process.exitCode = 1;
