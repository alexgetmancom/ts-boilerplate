import { z } from "zod";
import { log } from "./logger.js";
import type { OpenDatabase } from "./storage/kv.js";
import { getState, setState } from "./storage/kv.js";

type JsonObject = Record<string, unknown>;

/** JSON-RPC 2.0 error codes, plus the -32000 range this server owns. */
const PARSE_ERROR = -32600;
const METHOD_NOT_FOUND = -32601;
const INVALID_PARAMS = -32602;
const INTERNAL_ERROR = -32603;

export class McpToolError extends Error {
  constructor(
    readonly code: number,
    message: string,
  ) {
    super(message);
    this.name = "McpToolError";
  }
}

type ToolDef<S extends z.ZodType = z.ZodType> = {
  description: string;
  schema: S;
  /** Set for tools that change state, so the call is logged as a command. */
  mutates?: boolean;
  handler: (database: OpenDatabase, input: z.infer<S>) => unknown | Promise<unknown>;
};

function tool<S extends z.ZodType>(def: ToolDef<S>): ToolDef<S> {
  return def;
}

/**
 * One Zod schema per tool is both the validator and the schema the client sees —
 * a field rejected here can never be a field advertised as accepted.
 */
const toolDefs = {
  state_read: tool({
    description: "Read one value from the service's key/value state. Returns null when the key is unset.",
    schema: z.object({ key: z.string().trim().min(1).max(200) }),
    handler: (database, input) => ({ key: input.key, value: getState(database, input.key) }),
  }),
  state_write: tool({
    description: "Write one value into the service's key/value state, replacing any previous value.",
    schema: z.object({
      key: z.string().trim().min(1).max(200),
      value: z.string().max(10_000),
    }),
    mutates: true,
    handler: (database, input) => {
      setState(database, input.key, input.value);
      return { key: input.key, written: true };
    },
  }),
} satisfies Record<string, ToolDef>;

const tools = Object.entries(toolDefs).map(([name, def]) => ({
  name,
  description: def.description,
  inputSchema: z.toJSONSchema(def.schema, { io: "input" }),
}));

/**
 * An agent gets one shot at the message, so name the offending field: a bare
 * "Too small" leaves it guessing which argument to fix.
 */
function describeIssue(issue: z.core.$ZodIssue | undefined): string {
  if (!issue) return "invalid arguments";
  const path = issue.path.join(".");
  return path ? `${path}: ${issue.message}` : issue.message;
}

function asObject(value: unknown): JsonObject {
  return value !== null && typeof value === "object" && !Array.isArray(value) ? (value as JsonObject) : {};
}

function rpcError(id: unknown, code: number, message: string): JsonObject {
  return { jsonrpc: "2.0", id, error: { code, message } };
}

function rpcSuccess(id: unknown, value: unknown): JsonObject {
  return { jsonrpc: "2.0", id, result: { content: [{ type: "text", text: JSON.stringify(value) }] } };
}

async function callTool(database: OpenDatabase, name: string, args: JsonObject): Promise<unknown> {
  const def = (toolDefs as Record<string, ToolDef>)[name];
  if (!def) throw new McpToolError(METHOD_NOT_FOUND, `Unknown tool: ${name}`);

  const parsed = def.schema.safeParse(args);
  if (!parsed.success) throw new McpToolError(INVALID_PARAMS, describeIssue(parsed.error.issues[0]));

  const result = await def.handler(database, parsed.data);
  if (def.mutates) log("info", "MCP command executed", { tool: name });
  return result;
}

export async function mcpResponse(database: OpenDatabase, appName: string, body: unknown): Promise<JsonObject> {
  const request = asObject(body);
  if (typeof request.method !== "string") return rpcError(null, PARSE_ERROR, "Invalid request");
  const id = request.id ?? null;

  if (request.method === "initialize") {
    return {
      jsonrpc: "2.0",
      id,
      result: {
        protocolVersion: "2024-11-05",
        capabilities: { tools: {} },
        serverInfo: { name: `${appName}-mcp`, version: "1.0.0" },
      },
    };
  }

  if (request.method === "tools/list") return { jsonrpc: "2.0", id, result: { tools } };

  if (request.method !== "tools/call") {
    return rpcError(id, METHOD_NOT_FOUND, `Unknown method: ${request.method}`);
  }

  const params = asObject(request.params);
  const name = typeof params.name === "string" ? params.name : "";
  try {
    return rpcSuccess(id, await callTool(database, name, asObject(params.arguments)));
  } catch (error) {
    if (error instanceof McpToolError) return rpcError(id, error.code, error.message);
    log("error", "MCP tool failed", { tool: name, error });
    return rpcError(id, INTERNAL_ERROR, error instanceof Error ? error.message : String(error));
  }
}
