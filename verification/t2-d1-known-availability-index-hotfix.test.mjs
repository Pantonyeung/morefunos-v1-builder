import assert from 'node:assert/strict';
import test from 'node:test';
import { DatabaseSync } from 'node:sqlite';

import { repairDirectAuthoritySchema } from '../source/packages/production-persistence/d1-direct-authority-schema-repair.ts';

class StatementAdapter {
  constructor(statement, sql) { this.statement = statement; this.sql = sql.trim(); this.values = []; }
  bind(...values) { this.values = values; return this; }
  async run() {
    if (/^(SELECT|PRAGMA)\b/i.test(this.sql)) return { success: true, results: this.statement.all(...this.values), meta: { changes: 0 } };
    const result = this.statement.run(...this.values);
    return { success: true, meta: { changes: Number(result.changes) } };
  }
  async first(column) {
    const row = this.statement.get(...this.values);
    if (row === undefined) return null;
    return column === undefined ? row : row[column] ?? null;
  }
  async all() { return { success: true, results: this.statement.all(...this.values) }; }
}

class SqliteD1Adapter {
  constructor(database) { this.database = database; }
  prepare(sql) { return new StatementAdapter(this.database.prepare(sql), sql); }
  async batch(statements) { return Promise.all(statements.map(statement => statement.run())); }
}

function createExactLegacyAvailability(database) {
  database.exec(`CREATE TABLE mfos_availability_state (
    availability_id TEXT PRIMARY KEY,
    store_id TEXT NOT NULL,
    target_type TEXT NOT NULL,
    target_id TEXT NOT NULL,
    revision INTEGER NOT NULL,
    record_json TEXT NOT NULL,
    updated_at TEXT NOT NULL
  )`);
}

function columns(database, table) {
  return database.prepare(`PRAGMA table_info(${table})`).all().map(row => row.name);
}

function dependencyRows(database, table) {
  return database.prepare(`SELECT name, type, sql FROM sqlite_master WHERE tbl_name=? AND type IN ('index','trigger') AND sql IS NOT NULL ORDER BY type,name`).all(table);
}

const EXPECTED_CURRENT = [
  'availability_id', 'store_id', 'target_type', 'target_id', 'status', 'revision', 'changed_at',
  'changed_by_actor_id', 'change_source', 'reason_code', 'reason_note',
];

test('exact live empty legacy Availability index is admitted, removed, upgraded, and rerun safe', async () => {
  const sqlite = new DatabaseSync(':memory:');
  createExactLegacyAvailability(sqlite);
  sqlite.exec('CREATE INDEX mfos_availability_store_target_idx ON mfos_availability_state(store_id, target_type, target_id)');
  const db = new SqliteD1Adapter(sqlite);

  const before = dependencyRows(sqlite, 'mfos_availability_state');
  assert.deepEqual(before.map(row => ({ name: row.name, type: row.type, sql: row.sql })), [{
    name: 'mfos_availability_store_target_idx',
    type: 'index',
    sql: 'CREATE INDEX mfos_availability_store_target_idx ON mfos_availability_state(store_id, target_type, target_id)',
  }]);

  const first = await repairDirectAuthoritySchema(db);
  assert.equal(first.availability, 'UPGRADED_EMPTY_LEGACY');
  assert.deepEqual(columns(sqlite, 'mfos_availability_state'), EXPECTED_CURRENT);
  assert.equal(sqlite.prepare("SELECT COUNT(*) AS count FROM sqlite_master WHERE name='mfos_availability_store_target_idx'").get().count, 0);
  assert.equal(sqlite.prepare("SELECT COUNT(*) AS count FROM sqlite_master WHERE name='mfos_availability_store_revision_idx'").get().count, 1);
  assert.equal(sqlite.prepare('SELECT COUNT(*) AS count FROM mfos_availability_state').get().count, 0);

  const second = await repairDirectAuthoritySchema(db);
  assert.equal(second.availability, 'ALREADY_CURRENT');
  assert.deepEqual(columns(sqlite, 'mfos_availability_state'), EXPECTED_CURRENT);
  sqlite.close();
});

test('same known index name with changed SQL still fails closed without mutation', async () => {
  const sqlite = new DatabaseSync(':memory:');
  createExactLegacyAvailability(sqlite);
  sqlite.exec('CREATE INDEX mfos_availability_store_target_idx ON mfos_availability_state(store_id, target_id, target_type)');
  const beforeColumns = columns(sqlite, 'mfos_availability_state');
  const beforeDependencies = dependencyRows(sqlite, 'mfos_availability_state');
  const db = new SqliteD1Adapter(sqlite);

  await assert.rejects(() => repairDirectAuthoritySchema(db), /D1_AVAILABILITY_LEGACY_DEPENDENCY_PRESENT/);
  assert.deepEqual(columns(sqlite, 'mfos_availability_state'), beforeColumns);
  assert.deepEqual(dependencyRows(sqlite, 'mfos_availability_state'), beforeDependencies);
  sqlite.close();
});

test('any additional unknown index fails closed without dropping the known index', async () => {
  const sqlite = new DatabaseSync(':memory:');
  createExactLegacyAvailability(sqlite);
  sqlite.exec('CREATE INDEX mfos_availability_store_target_idx ON mfos_availability_state(store_id, target_type, target_id)');
  sqlite.exec('CREATE INDEX unexpected_legacy_idx ON mfos_availability_state(updated_at)');
  const beforeDependencies = dependencyRows(sqlite, 'mfos_availability_state');
  const db = new SqliteD1Adapter(sqlite);

  await assert.rejects(() => repairDirectAuthoritySchema(db), /D1_AVAILABILITY_LEGACY_DEPENDENCY_PRESENT/);
  assert.deepEqual(dependencyRows(sqlite, 'mfos_availability_state'), beforeDependencies);
  sqlite.close();
});

test('any legacy trigger remains fail closed without schema mutation', async () => {
  const sqlite = new DatabaseSync(':memory:');
  createExactLegacyAvailability(sqlite);
  sqlite.exec('CREATE TRIGGER unexpected_legacy_trigger AFTER INSERT ON mfos_availability_state BEGIN SELECT 1; END');
  const beforeColumns = columns(sqlite, 'mfos_availability_state');
  const db = new SqliteD1Adapter(sqlite);

  await assert.rejects(() => repairDirectAuthoritySchema(db), /D1_AVAILABILITY_LEGACY_DEPENDENCY_PRESENT/);
  assert.deepEqual(columns(sqlite, 'mfos_availability_state'), beforeColumns);
  assert.equal(sqlite.prepare("SELECT COUNT(*) AS count FROM sqlite_master WHERE name='unexpected_legacy_trigger'").get().count, 1);
  sqlite.close();
});
