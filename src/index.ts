import { configureBot, createBot } from "./bot/bot.js";
import { loadConfig } from "./config.js";
import { createHttpApp } from "./http.js";
import { log } from "./logger.js";
import { stopServerGracefully } from "./runtime/shutdown.js";
import { createRuntimeStatus } from "./runtime/status.js";
import { RuntimeSupervisor } from "./runtime/supervisor.js";
import { startIntervalWorker } from "./runtime/worker.js";
import { migrateDatabase, openDatabase, setState } from "./storage/kv.js";

async function main(): Promise<void> {
  const config = loadConfig();
  const database = openDatabase(config.DATABASE_URL);
  try {
    migrateDatabase(database);
  } catch (error) {
    database.close();
    log("error", "Database migration failed", { error });
    throw error;
  }

  const runtime = config.BOT_MODE === "http-only" ? null : createBot(config, database);
  const status = createRuntimeStatus(config.BOT_MODE);
  const app = createHttpApp(config, runtime, database, status);
  const server = Bun.serve({ fetch: app.fetch, hostname: config.BIND_HOST, port: config.PORT });
  const supervisor = new RuntimeSupervisor();

  // Replace this with the project's real background job.
  supervisor.register(
    startIntervalWorker("heartbeat", config.WORKER_INTERVAL_SECONDS * 1000, () => {
      setState(database, "last_worker_run", new Date().toISOString());
    }),
  );

  let stopping = false;
  const shutdown = async (signal: string): Promise<void> => {
    if (stopping) return;
    stopping = true;
    log("info", "Stopping service", { signal });
    await supervisor.stop();
    if (runtime?.bot.isRunning()) await runtime.bot.stop();
    await stopServerGracefully(server);
    database.close();
    log("info", "Service stopped");
  };
  process.once("SIGINT", () => void shutdown("SIGINT"));
  process.once("SIGTERM", () => void shutdown("SIGTERM"));

  if (runtime) {
    try {
      await configureBot(runtime.bot);
    } catch (error) {
      log("error", "Failed to configure Telegram commands", { error });
    }
  }

  if (config.BOT_MODE === "polling" && runtime) {
    void runtime.bot
      .start({
        onStart: (botInfo) => {
          status.botReady = true;
          status.botError = null;
          log("info", "Telegram polling started", { username: botInfo.username });
        },
      })
      .catch(async (error) => {
        status.botReady = false;
        status.botError = error instanceof Error ? error.message : String(error);
        log("error", "Telegram polling stopped unexpectedly", { error });
        await shutdown("TELEGRAM_POLLING_FAILED");
        process.exitCode = 1;
      });
  } else if (config.BOT_MODE === "webhook" && runtime) {
    // loadConfig already guarantees both values in webhook mode.
    const secretToken = config.TELEGRAM_WEBHOOK_SECRET ?? "";
    await runtime.bot.api.setWebhook(`${config.PUBLIC_WEBHOOK_URL}/telegram/webhook`, {
      secret_token: secretToken,
    });
    log("info", "Telegram webhook registered", { url: config.PUBLIC_WEBHOOK_URL });
  } else {
    log("info", "HTTP-only mode enabled");
  }

  log("info", "HTTP server listening", {
    address: `http://${config.BIND_HOST}:${config.PORT}`,
    mode: config.BOT_MODE,
  });
}

void main().catch((error) => {
  log("error", "Service startup failed", { error });
  process.exitCode = 1;
});
