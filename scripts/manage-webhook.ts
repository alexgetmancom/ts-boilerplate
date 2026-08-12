import { Bot } from "grammy";
import { loadConfig } from "../src/config.js";
import { log } from "../src/logger.js";

const ACTIONS = ["set", "delete", "info"] as const;
type Action = (typeof ACTIONS)[number];

function isAction(value: string | undefined): value is Action {
  return value !== undefined && (ACTIONS as readonly string[]).includes(value);
}

async function main(): Promise<void> {
  const action = process.argv[2];
  if (!isAction(action)) {
    log("error", "Usage: bun scripts/manage-webhook.ts <set|delete|info> [--keep-pending]");
    process.exitCode = 1;
    return;
  }

  // http-only never has a token, and there is nothing to manage without one.
  const config = loadConfig({ ...process.env, BOT_MODE: "webhook" });
  const bot = new Bot(config.TELEGRAM_BOT_TOKEN ?? "", { client: { apiRoot: config.TELEGRAM_API_ROOT } });
  const botInfo = await bot.api.getMe();
  log("info", "Connected to bot", { username: botInfo.username });

  if (action === "info") {
    log("info", "Webhook info", await bot.api.getWebhookInfo());
    return;
  }

  if (action === "delete") {
    await bot.api.deleteWebhook();
    log("info", "Webhook deleted");
    return;
  }

  // Pending updates are dropped by default: after a webhook change they are usually stale, and
  // replaying hours of queued commands at startup is worse than losing them.
  const dropPendingUpdates = !process.argv.includes("--keep-pending");
  const url = `${(config.PUBLIC_WEBHOOK_URL ?? "").replace(/\/$/, "")}/telegram/webhook`;
  await bot.api.setWebhook(url, {
    secret_token: config.TELEGRAM_WEBHOOK_SECRET ?? "",
    drop_pending_updates: dropPendingUpdates,
  });
  log("info", "Webhook set", { url, dropPendingUpdates });
}

void main().catch((error) => {
  log("error", "Webhook management failed", { error });
  process.exitCode = 1;
});
