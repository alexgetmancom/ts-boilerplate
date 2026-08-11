import type { Context } from "grammy";
import type { AppConfig } from "../config.js";
import type { OpenDatabase } from "../storage/kv.js";

export type AppContext = Context & {
  config: AppConfig;
  database: OpenDatabase;
};
