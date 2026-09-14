import test from 'node:test';
import assert from 'node:assert/strict';
import { DatabaseSync } from 'node:sqlite';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { PersistenceFailure } from '@ptcg/application';
import { id } from '@ptcg/core';
import { harness } from '../fixtures/durable.js';
import { NOW } from '../fixtures/scenarios.js';

const legacySchema = readFileSync('tests/fixtures/m2-schema.sql', 'utf8');
test('populated M2 schema migrates atomically without changing observations, identity, ledger, audit or replay receipts', async t => {
  const h = harness(t); const f = h.seed(); const result = await h.store.coordinator.run(f.adapter, f.command); assert.ok(result.status === 'COMMITTED');
  const before = h.store.execution.getDecisionHistory(result.simulation.scope.intentId);
  const oldPath = join(h.directory, 'actual-v1.sqlite'); const old = new DatabaseSync(oldPath, { enableForeignKeyConstraints: false });
  try {
    old.exec(legacySchema); old.prepare('ATTACH DATABASE ? AS source').run(h.path);
    // Copy only the frozen v1 table set, preserving v1 schema and triggers. Generated snapshots contain M1/M2 data only.
    const tables = old.prepare("SELECT name FROM sqlite_master WHERE type='table'").all();
    old.exec('BEGIN');
    for (const row of tables) {
      const name = row['name']; assert.equal(typeof name, 'string'); if (typeof name !== 'string' || !/^[a-z_]+$/.test(name)) throw new Error('Unexpected fixture table');
      old.exec(`DELETE FROM ${name}; INSERT INTO ${name} SELECT * FROM source.${name}`);
    }
    old.exec('COMMIT; DETACH DATABASE source'); assert.equal(old.prepare('PRAGMA user_version').get()?.['user_version'], 1);
    assert.deepEqual(old.prepare('PRAGMA foreign_key_check').all(), []);
  } finally { old.close(); }
  const migrated = h.open(oldPath); assert.equal(migrated.diagnostics().schemaVersion, 4); assert.deepEqual(migrated.execution.getDecisionHistory(result.simulation.scope.intentId), before);
  const duplicate = await migrated.coordinator.run(f.adapter, { ...f.command, now: NOW + 1000 }); assert.equal(duplicate.status, 'DUPLICATE');
  assert.deepEqual(migrated.evidence.getObservationHistory(f.observation.offer.ref)[0], { observation: f.observation, catalog: null });
  assert.equal(migrated.evidence.getStoreMetadata(id('store', 'fake-mx')), null);
  assert.equal(migrated.readQuotas.claimReadSlot('new-source', NOW, 1000).granted, true);
});
test('migration FK failure rolls back the version and original offer table', t => {
  const h = harness(t); const path = join(h.directory, 'invalid-v1.sqlite'); const old = new DatabaseSync(path, { enableForeignKeyConstraints: false });
  old.exec(legacySchema); old.exec("INSERT INTO variants VALUES('orphan','missing','201','missing')"); old.close();
  assert.throws(() => h.open(path), (e: unknown) => e instanceof PersistenceFailure && e.code === 'STORAGE_FAILURE');
  const inspect = new DatabaseSync(path); try {
    assert.equal(inspect.prepare('PRAGMA user_version').get()?.['user_version'], 1);
    assert.equal(inspect.prepare("SELECT count(*) AS n FROM sqlite_master WHERE name='store_metadata'").get()?.['n'], 0);
    assert.ok(String(inspect.prepare("SELECT sql FROM sqlite_master WHERE name='offers'").get()?.['sql']).includes("condition='NEW_SEALED'"));
  } finally { inspect.close(); }
});
test('quarantined M2 recovery snapshot opens read-only without migration or quota authority', t => {
  const h = harness(t); const path = join(h.directory, 'recovery-v1.sqlite'); const old = new DatabaseSync(path); old.exec(legacySchema); old.exec('UPDATE database_metadata SET recovery_required=1 WHERE id=1'); old.close();
  const quarantined = h.open(path); assert.equal(quarantined.diagnostics().schemaVersion, 1);
  assert.throws(() => quarantined.readQuotas.claimReadSlot('store', NOW, 1000), (e: unknown) => e instanceof PersistenceFailure && e.code === 'RECOVERY_READ_ONLY');
  const inspect = new DatabaseSync(path); try { assert.equal(inspect.prepare('PRAGMA user_version').get()?.['user_version'], 1); } finally { inspect.close(); }
});
