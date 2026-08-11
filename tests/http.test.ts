import { describe, expect, test } from "bun:test";
import { loadConfig } from "../src/config.js";
import { createHttpApp } from "../src/http.js";
import { createRuntimeStatus } from "../src/runtime/status.js";
import { migrateDatabase, openDatabase } from "../src/storage/kv.js";

function buildApp(env: Record<string, string | undefined> = {}) {
  const config = loadConfig({ BOT_MODE: "http-only", DATABASE_URL: ":memory:", ...env });
  const database = openDatabase(config.DATABASE_URL);
  migrateDatabase(database);
  return { app: createHttpApp(config, null, database, createRuntimeStatus(config.BOT_MODE)), database };
}

describe("http app", () => {
  test("serves liveness", async () => {
    const { app, database } = buildApp();
    const response = await app.request("/healthz");
    expect(response.status).toBe(200);
    expect(await response.text()).toBe("ok\n");
    database.close();
  });

  test("serves readiness when the database answers", async () => {
    const { app, database } = buildApp();
    expect((await app.request("/readyz")).status).toBe(200);
    database.close();
  });

  test("reports readiness failure once the database is gone", async () => {
    const { app, database } = buildApp();
    database.close();
    expect((await app.request("/readyz")).status).toBe(500);
  });

  test("returns the app name at the root", async () => {
    const { app, database } = buildApp({ APP_NAME: "demo" });
    expect(await (await app.request("/")).json()).toEqual({ name: "demo", status: "ok" });
    database.close();
  });
});
