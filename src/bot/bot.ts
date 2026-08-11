import { Bot } from "grammy";
import type { AppConfig } from "../config.js";
import { log } from "../logger.js";
import type { OpenDatabase } from "../storage/kv.js";
import { getState, setState } from "../storage/kv.js";
import type { AppContext } from "./context.js";

export type Notifier = {
  notify: (userId: number, text: string) => Promise<void>;
};

export type BotRuntime = {
  bot: Bot<AppContext>;
  notifier: Notifier;
};

/** Used in http-only mode, where no Telegram client exists. */
export function createNoopNotifier(): Notifier {
  return {
    notify: async (userId, text) => {
      log("debug", "Notification dropped (no bot runtime)", { userId, text });
    },
  };
}

export function createBot(config: AppConfig, database: OpenDatabase): BotRuntime {
  if (!config.TELEGRAM_BOT_TOKEN) throw new Error("TELEGRAM_BOT_TOKEN is required to create a bot");

  const bot = new Bot<AppContext>(config.TELEGRAM_BOT_TOKEN, {
    client: { apiRoot: config.TELEGRAM_API_ROOT },
  });

  bot.use(async (context, next) => {
    context.config = config;
    context.database = database;
    await next();
  });

  // Authorization: only listed users get through, and loadConfig guarantees the list is non-empty.
  bot.use(async (context, next) => {
    const userId = context.from?.id;
    if (userId === undefined || !config.ALLOWED_USERS.includes(userId)) {
      log("warn", "Rejected update from unauthorized user", { userId });
      return;
    }
    await next();
  });

  bot.command("start", async (context) => {
    await context.reply(`👋 ${config.APP_NAME} is running.\n\nSend /ping to check the round trip.`);
  });

  bot.command("ping", async (context) => {
    const previous = getState(database, "last_ping_at");
    setState(database, "last_ping_at", new Date().toISOString());
    await context.reply(previous ? `pong — last ping was ${previous}` : "pong — this is the first ping");
  });

  bot.catch((error) => {
    log("error", "Unhandled bot error", { error: error.error, update: error.ctx.update.update_id });
  });

  const notifier: Notifier = {
    notify: async (userId, text) => {
      try {
        await bot.api.sendMessage(userId, text);
      } catch (error) {
        log("error", "Failed to deliver notification", { userId, error });
      }
    },
  };

  return { bot, notifier };
}

export async function configureBot(bot: Bot<AppContext>): Promise<void> {
  await bot.api.setMyCommands([
    { command: "start", description: "Show the welcome message" },
    { command: "ping", description: "Check that the bot responds" },
  ]);
}
