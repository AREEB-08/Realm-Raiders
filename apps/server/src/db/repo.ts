import { mkdirSync } from 'node:fs';
import { dirname } from 'node:path';
import Database from 'better-sqlite3';
import { eq } from 'drizzle-orm';
import { drizzle, type BetterSQLite3Database } from 'drizzle-orm/better-sqlite3';
import { TABLE_NAMES, type Doc, type Repo, type Table } from '@realm/core';
import { addColumns, ddl, spec, tables } from './schema';

/** One core collection on a Drizzle/SQLite table (rows ↔ documents via the column spec). */
class SqliteTable<T extends Doc> implements Table<T> {
  constructor(
    private readonly db: BetterSQLite3Database,
    private readonly name: keyof Repo,
  ) {}

  private get t() {
    return tables[this.name] as any;
  }

  private toRow(doc: T): Record<string, unknown> {
    const row: Record<string, unknown> = {};
    for (const [field, [, kind]] of Object.entries(spec[this.name].cols)) {
      const v = (doc as Record<string, unknown>)[field];
      row[field] = kind === 'blob64' ? (typeof v === 'string' ? Buffer.from(v, 'base64') : null) : (v ?? null);
    }
    return row;
  }

  private fromRow(row: Record<string, unknown>): T {
    const doc: Record<string, unknown> = {};
    for (const [field, [, kind]] of Object.entries(spec[this.name].cols)) {
      const v = row[field];
      doc[field] = kind === 'blob64' ? (v ? Buffer.from(v as Uint8Array).toString('base64') : null) : v;
    }
    return doc as T;
  }

  async get(id: string) {
    const rows = this.db.select().from(this.t).where(eq(this.t.id, id)).all() as Record<string, unknown>[];
    return rows[0] ? this.fromRow(rows[0]) : undefined;
  }

  async put(doc: T) {
    const row = this.toRow(doc);
    const { id: _id, ...rest } = row;
    this.db.insert(this.t).values(row).onConflictDoUpdate({ target: this.t.id, set: rest }).run();
  }

  async delete(id: string) {
    this.db.delete(this.t).where(eq(this.t.id, id)).run();
  }

  async all() {
    return (this.db.select().from(this.t).all() as Record<string, unknown>[]).map((r) => this.fromRow(r));
  }

  async find(pred: (doc: T) => boolean) {
    return (await this.all()).filter(pred);
  }
}

export function openRepo(file: string): { repo: Repo; sqlite: Database.Database } {
  if (file !== ':memory:') mkdirSync(dirname(file), { recursive: true });
  const sqlite = new Database(file);
  sqlite.pragma('journal_mode = WAL');
  sqlite.pragma('synchronous = NORMAL');
  for (const stmt of ddl()) sqlite.exec(stmt);
  // Columns added by later releases (e.g. battles.duel_id) on database files made before them.
  const cols = (table: string) => (sqlite.prepare(`PRAGMA table_info("${table}")`).all() as { name: string }[]).map((c) => c.name);
  for (const stmt of addColumns(cols)) sqlite.exec(stmt);
  const db = drizzle(sqlite);
  const repo = Object.fromEntries(TABLE_NAMES.map((name) => [name, new SqliteTable(db, name)])) as unknown as Repo;
  return { repo, sqlite };
}
