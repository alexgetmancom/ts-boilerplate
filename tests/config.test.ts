import { describe, expect, test } from "bun:test";
import { ConfigurationError, loadConfig } from "../src/config.js";

const base = { TELEGRAM_BOT_TOKEN: "123:abc" };

describe("loadConfig", () => {
  test("applies defaults", () => {
    const config = loadConfig(base);
    expect(config.BOT_MODE).toBe("polling");
    expect(config.PORT).toBe(8080);
    expect(config.ALLOWED_USERS).toEqual([]);
  });

  test("parses the allowed user list", () => {
    expect(loadConfig({ ...base, ALLOWED_USERS: " 42, 7 " }).ALLOWED_USERS).toEqual([42, 7]);
  });

  test("rejects a malformed allowed user list", () => {
    expect(() => loadConfig({ ...base, ALLOWED_USERS: "42,nope" })).toThrow(ConfigurationError);
  });

  test("requires a token unless http-only", () => {
    expect(() => loadConfig({})).toThrow(ConfigurationError);
    expect(loadConfig({ BOT_MODE: "http-only" }).BOT_MODE).toBe("http-only");
  });

  test("requires webhook secret and public url in webhook mode", () => {
    expect(() => loadConfig({ ...base, BOT_MODE: "webhook" })).toThrow(ConfigurationError);
    const config = loadConfig({
      ...base,
      BOT_MODE: "webhook",
      TELEGRAM_WEBHOOK_SECRET: "s".repeat(32),
      PUBLIC_WEBHOOK_URL: "https://example.com",
    });
    expect(config.PUBLIC_WEBHOOK_URL).toBe("https://example.com");
  });

  test("treats empty strings as unset", () => {
    expect(loadConfig({ ...base, PUBLIC_WEBHOOK_URL: "" }).PUBLIC_WEBHOOK_URL).toBeUndefined();
  });
});
