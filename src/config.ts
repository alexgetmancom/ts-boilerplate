import { z } from "zod";

/** Empty strings in .env mean "not set", not "set to empty". */
const optionalText = z.preprocess(
  (value) => (typeof value === "string" && value.trim() === "" ? undefined : value),
  z.string().min(1).optional(),
);

const userIdList = z
  .string()
  .default("")
  .transform((value, context) => {
    if (value.trim() === "") return [] as number[];

    const ids = value.split(",").map((item) => Number(item.trim()));
    if (ids.some((id) => !Number.isSafeInteger(id) || id <= 0)) {
      context.addIssue({
        code: "custom",
        message: "ALLOWED_USERS must contain positive integer IDs separated by commas",
      });
      return z.NEVER;
    }
    return ids;
  });

const envSchema = z.object({
  NODE_ENV: z.enum(["development", "test", "production"]).default("development"),
  APP_NAME: z.string().min(1).default("ts-boilerplate"),
  BOT_MODE: z.enum(["polling", "webhook", "http-only"]).default("polling"),
  TELEGRAM_BOT_TOKEN: optionalText,
  TELEGRAM_API_ROOT: z.string().url().default("https://api.telegram.org"),
  TELEGRAM_WEBHOOK_SECRET: z.preprocess(
    (value) => (typeof value === "string" && value.trim() === "" ? undefined : value),
    z.string().min(32).optional(),
  ),
  PUBLIC_WEBHOOK_URL: z.preprocess(
    (value) => (typeof value === "string" && value.trim() === "" ? undefined : value),
    z.string().url().optional(),
  ),
  /** Nobody is allowed until listed here — an unset allowlist must never mean "open to everyone". */
  ALLOWED_USERS: userIdList,
  DATABASE_URL: z.string().min(1).default("./data/app.db"),
  PORT: z.coerce.number().int().min(1).max(65535).default(8080),
  BIND_HOST: z.string().min(1).default("127.0.0.1"),
  WORKER_INTERVAL_SECONDS: z.coerce.number().int().positive().default(3600),
  TZ: z.string().default("Europe/Moscow"),
});

export type AppConfig = z.infer<typeof envSchema>;

export class ConfigurationError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "ConfigurationError";
  }
}

export function loadConfig(source: Record<string, string | undefined> = process.env): AppConfig {
  const parsed = envSchema.safeParse(source);
  if (!parsed.success) {
    const details = parsed.error.issues.map((issue) => `${issue.path.join(".") || "env"}: ${issue.message}`).join("; ");
    throw new ConfigurationError(`Invalid environment configuration — ${details}`);
  }

  const config = parsed.data;
  if (config.BOT_MODE !== "http-only" && !config.TELEGRAM_BOT_TOKEN) {
    throw new ConfigurationError("TELEGRAM_BOT_TOKEN is required unless BOT_MODE is http-only");
  }
  if (config.BOT_MODE !== "http-only" && config.ALLOWED_USERS.length === 0) {
    throw new ConfigurationError("ALLOWED_USERS must list at least one Telegram user ID");
  }
  if (config.BOT_MODE === "webhook") {
    if (!config.TELEGRAM_WEBHOOK_SECRET) {
      throw new ConfigurationError("TELEGRAM_WEBHOOK_SECRET is required in webhook mode");
    }
    if (!config.PUBLIC_WEBHOOK_URL) {
      throw new ConfigurationError("PUBLIC_WEBHOOK_URL is required in webhook mode");
    }
  }
  return config;
}
