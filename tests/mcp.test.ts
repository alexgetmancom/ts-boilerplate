import { describe, expect, test } from "bun:test";
import { loadConfig } from "../src/config.js";
import { createHttpApp } from "../src/http.js";
import { mcpResponse } from "../src/mcp.js";
import { createRuntimeStatus } from "../src/runtime/status.js";
import { getState, migrateDatabase, openDatabase } from "../src/storage/kv.js";

const TOKEN = "t".repeat(32);

function freshDatabase() {
  const database = openDatabase(":memory:");
  migrateDatabase(database);
  return database;
}

function call(method: string, params?: unknown) {
  return { jsonrpc: "2.0", id: 1, method, ...(params === undefined ? {} : { params }) };
}

describe("mcpResponse", () => {
  test("announces the protocol and server on initialize", async () => {
    const database = freshDatabase();
    const response = (await mcpResponse(database, "demo", call("initialize"))) as {
      result: { protocolVersion: string; serverInfo: { name: string } };
    };
    expect(response.result.protocolVersion).toBe("2024-11-05");
    expect(response.result.serverInfo.name).toBe("demo-mcp");
    database.close();
  });

  test("lists every tool with a JSON schema", async () => {
    const database = freshDatabase();
    const response = (await mcpResponse(database, "demo", call("tools/list"))) as {
      result: { tools: Array<{ name: string; description: string; inputSchema: { properties: unknown } }> };
    };
    expect(response.result.tools.map((entry) => entry.name).sort()).toEqual(["state_read", "state_write"]);
    for (const entry of response.result.tools) {
      expect(entry.description.length).toBeGreaterThan(0);
      expect(entry.inputSchema.properties).toBeDefined();
    }
    database.close();
  });

  test("writes and reads state through tools", async () => {
    const database = freshDatabase();
    await mcpResponse(
      database,
      "demo",
      call("tools/call", { name: "state_write", arguments: { key: "k", value: "v" } }),
    );
    expect(getState(database, "k")).toBe("v");

    const read = (await mcpResponse(
      database,
      "demo",
      call("tools/call", { name: "state_read", arguments: { key: "k" } }),
    )) as { result: { content: Array<{ text: string }> } };
    expect(JSON.parse(read.result.content[0]?.text ?? "{}")).toEqual({ key: "k", value: "v" });
    database.close();
  });

  test("names the offending field on invalid arguments", async () => {
    const database = freshDatabase();
    const response = (await mcpResponse(
      database,
      "demo",
      call("tools/call", { name: "state_write", arguments: { key: "", value: "v" } }),
    )) as { error: { code: number; message: string } };
    expect(response.error.code).toBe(-32602);
    expect(response.error.message).toContain("key");
    database.close();
  });

  test("rejects unknown tools and methods", async () => {
    const database = freshDatabase();
    const unknownTool = (await mcpResponse(database, "demo", call("tools/call", { name: "nope" }))) as {
      error: { code: number };
    };
    const unknownMethod = (await mcpResponse(database, "demo", call("resources/list"))) as { error: { code: number } };
    expect(unknownTool.error.code).toBe(-32601);
    expect(unknownMethod.error.code).toBe(-32601);
    database.close();
  });

  test("rejects a body that is not a JSON-RPC request", async () => {
    const database = freshDatabase();
    const response = (await mcpResponse(database, "demo", null)) as { error: { code: number } };
    expect(response.error.code).toBe(-32600);
    database.close();
  });
});

describe("POST /api/mcp", () => {
  function buildApp(env: Record<string, string | undefined> = {}) {
    const config = loadConfig({ BOT_MODE: "http-only", DATABASE_URL: ":memory:", MCP_TOKEN: TOKEN, ...env });
    const database = openDatabase(config.DATABASE_URL);
    migrateDatabase(database);
    return { app: createHttpApp(config, null, database, createRuntimeStatus(config.BOT_MODE)), database };
  }

  function request(app: ReturnType<typeof buildApp>["app"], token: string | null) {
    return app.request("/api/mcp", {
      method: "POST",
      headers: {
        "content-type": "application/json",
        ...(token === null ? {} : { authorization: `Bearer ${token}` }),
      },
      body: JSON.stringify(call("tools/list")),
    });
  }

  test("serves the tool list to a valid token", async () => {
    const { app, database } = buildApp();
    expect((await request(app, TOKEN)).status).toBe(200);
    database.close();
  });

  test("rejects a wrong or missing token", async () => {
    const { app, database } = buildApp();
    expect((await request(app, "x".repeat(32))).status).toBe(401);
    expect((await request(app, null)).status).toBe(401);
    database.close();
  });

  test("does not mount the endpoint without a configured token", async () => {
    const { app, database } = buildApp({ MCP_TOKEN: "" });
    expect((await request(app, TOKEN)).status).toBe(404);
    database.close();
  });
});
