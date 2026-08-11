import { describe, expect, test } from "bun:test";
import { getState, migrateDatabase, openDatabase, setState } from "../src/storage/kv.js";

function freshDatabase() {
  const database = openDatabase(":memory:");
  migrateDatabase(database);
  return database;
}

describe("kv store", () => {
  test("returns null for a missing key", () => {
    const database = freshDatabase();
    expect(getState(database, "nope")).toBeNull();
    database.close();
  });

  test("stores and overwrites values", () => {
    const database = freshDatabase();
    setState(database, "cursor", "1");
    expect(getState(database, "cursor")).toBe("1");
    setState(database, "cursor", "2");
    expect(getState(database, "cursor")).toBe("2");
    database.close();
  });

  test("migration is idempotent", () => {
    const database = freshDatabase();
    setState(database, "cursor", "1");
    migrateDatabase(database);
    expect(getState(database, "cursor")).toBe("1");
    database.close();
  });
});
