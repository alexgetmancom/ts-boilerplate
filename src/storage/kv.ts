import { Database } from "bun:sqlite";
import { mkdirSync } from "node:fs";
import { dirname } from "node:path";

/**
 * Minimal key/value state store on top of bun:sqlite — zero extra dependencies.
 * Swap this module for Drizzle (see README) once a project needs real tables.
 */
export type OpenDatabase = {
  sqlite: Database;
  close: () => void;
};

export function openDatabase(url: string): OpenDatabase {
  if (url !== ":memory:") mkdirSync(dirname(url), { recursive: true });

  const sqlite = new Database(url, { create: true });
  sqlite.exec("PRAGMA journal_mode = WAL");
  sqlite.exec("PRAGMA foreign_keys = ON");
  return { sqlite, close: () => sqlite.close() };
}

export function migrateDatabase(database: OpenDatabase): void {
  database.sqlite.exec(`
    CREATE TABLE IF NOT EXISTS app_state (
      key TEXT PRIMARY KEY,
      value TEXT NOT NULL,
      updated_at TEXT NOT NULL
    )
  `);
}

export function getState(database: OpenDatabase, key: string): string | null {
  const row = database.sqlite.query<{ value: string }, [string]>("SELECT value FROM app_state WHERE key = ?").get(key);
  return row?.value ?? null;
}

export function setState(database: OpenDatabase, key: string, value: string): void {
  database.sqlite
    .query(
      "INSERT INTO app_state (key, value, updated_at) VALUES (?, ?, ?) ON CONFLICT(key) DO UPDATE SET value = excluded.value, updated_at = excluded.updated_at",
    )
    .run(key, value, new Date().toISOString());
}
