import { webhookCallback } from "grammy";
import type { Hono } from "hono";
import { Hono as HonoApp } from "hono";
import { logger } from "hono/logger";
import { bearerTokenAccepted } from "./auth.js";
import type { BotRuntime } from "./bot/bot.js";
import type { AppConfig } from "./config.js";
import { log } from "./logger.js";
import { mcpResponse } from "./mcp.js";
import type { RuntimeStatus } from "./runtime/status.js";
import type { OpenDatabase } from "./storage/kv.js";

export function createHttpApp(
  config: AppConfig,
  runtime: BotRuntime | null,
  database: OpenDatabase,
  status: RuntimeStatus,
): Hono {
  const app = new HonoApp();
  if (config.NODE_ENV !== "production") app.use("*", logger());

  app.get("/", (context) => context.json({ name: config.APP_NAME, status: "ok" }));

  /** Liveness: the process is up. Never touches dependencies. */
  app.get("/healthz", (context) => context.text("ok\n"));

  /** Readiness: dependencies answer and the bot is actually polling. */
  app.get("/readyz", (context) => {
    try {
      database.sqlite.query("SELECT 1").get();
    } catch (error) {
      log("error", "Readiness check failed", { error });
      return context.text("error\n", 500);
    }
    if (config.BOT_MODE === "polling" && !status.botReady) return context.text("not ready\n", 503);
    return context.text("ready\n");
  });

  // MCP: one POST endpoint behind a bearer token, so an agent operates the
  // running service through declared tools instead of reaching for the database.
  if (config.MCP_TOKEN) {
    app.post("/api/mcp", async (context) => {
      if (!bearerTokenAccepted(context.req.raw, config.MCP_TOKEN)) return context.text("unauthorized\n", 401);
      const body = await context.req.json().catch(() => null);
      return context.json(await mcpResponse(database, config.APP_NAME, body));
    });
  }

  if (config.BOT_MODE === "webhook" && runtime) {
    if (!config.TELEGRAM_WEBHOOK_SECRET) throw new Error("TELEGRAM_WEBHOOK_SECRET is required in webhook mode");
    app.post(
      "/telegram/webhook",
      webhookCallback(runtime.bot, "hono", { secretToken: config.TELEGRAM_WEBHOOK_SECRET }),
    );
  }

  app.onError((error, context) => {
    log("error", "Unhandled HTTP error", { error, path: context.req.path });
    return context.json({ error: "Internal Server Error" }, 500);
  });

  return app;
}
