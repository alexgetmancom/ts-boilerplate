# ts-boilerplate

A minimal starting template for TypeScript services and Telegram bots. The conventions are extracted
from `check-radar` and `alexgetman.com` — new projects start here, and older ones migrate onto this stack.

## Stack

| Layer | Choice |
|---|---|
| Runtime / package manager | Bun 1.3.14 (`bun test`, `bun:sqlite`, `Bun.serve` — no extra dependencies) |
| Language | TypeScript 7, strict + `noUncheckedIndexedAccess` + `exactOptionalPropertyTypes` |
| Lint / format | Biome 2 (one tool instead of ESLint + Prettier), 120 columns, double quotes |
| Telegram | grammY |
| HTTP | Hono (`/healthz`, `/readyz`, webhook endpoint) |
| Validation | Zod 4 — the whole configuration is parsed from env through a schema |
| Storage | `bun:sqlite`, key/value table `app_state` |

Three production dependencies in total: `grammy`, `hono`, `zod`.

## Quick start

```bash
cp .env.example .env && bun install && bun run dev
```

Run every check at once (this is exactly what CI runs):

```bash
bun run check
```

## What is inside

```
src/
  config.ts            env → Zod schema → typed AppConfig, fails fast at startup
  logger.ts            structured logging, JSON in production, redacts tokens and secrets
  http.ts              Hono: /, /healthz (liveness), /readyz (readiness), /telegram/webhook
  index.ts             composition root: wiring, startup, graceful shutdown
  bot/
    bot.ts             grammY: config middleware, allowlist, /start, /ping, notifier
    context.ts         AppContext = grammY Context + config + database
  runtime/
    supervisor.ts      registry of stoppable resources, stopped in reverse order
    worker.ts          interval worker: never overlaps cycles, awaits the current one on stop
    shutdown.ts        stops Bun.serve with a timeout before forcing
    status.ts          botReady / botError backing /readyz
  storage/kv.ts        bun:sqlite, migration, getState/setState
tests/                 bun test: config, http, kv, logger
```

Plus a `Dockerfile` (multi-stage, non-root, `USER bun`), a `compose.yaml` with a healthcheck, and
`.github/workflows/ci.yml`.

## Key decisions

**Three run modes** — `BOT_MODE=polling | webhook | http-only`. The same code runs as a long-polling
bot on a VPS, as a webhook behind a reverse proxy, or as a service with no Telegram at all.
`loadConfig` requires exactly the variables the selected mode needs.

**Fail at startup, not at runtime.** The configuration is validated in full before the database is
opened and the bot is created. A missing token is a `ConfigurationError` in the first second, not an
`undefined` an hour later.

**An empty string in `.env` means "unset".** Otherwise `FOO=` yields an empty string and breaks
`.url()` validation.

**Logs never leak secrets.** `redact()` masks keys matching `/token|secret|password|api_key|.../i`
recursively, including arrays and `Error` values. In production each record is a single JSON line.

**The allowlist is open by default.** An empty `ALLOWED_USERS` lets everyone in, which is convenient
during development. In production the list must be filled in.

**Graceful shutdown is real, not decorative.** `SIGTERM` → workers (each finishes its current cycle)
→ bot → HTTP server (10s to drain, then forced) → database close. A repeated signal is ignored.

**liveness ≠ readiness.** `/healthz` answers as long as the process is alive. `/readyz` probes the
database and, in polling mode, waits for the bot to actually start — Docker and load balancers use
different probes.

## Extending it for a project

- **You need real tables:** add `drizzle-orm` + `drizzle-kit`, a `drizzle.config.ts`, a `drizzle/`
  directory, and `db:generate` / `db:migrate` scripts — as in `check-radar`. Keep `storage/kv.ts`
  for bookkeeping cursors.
- **You need an external API:** put it in its own module under `src/services/` and parse responses
  with a Zod schema at the boundary.
- **You need periodic work:** one more `startIntervalWorker(...)` inside `supervisor.register(...)`.
- **You do not need Telegram:** set `BOT_MODE=http-only` and delete the `bot/` directory.

## Migration order for existing projects

1. `x-news-bot` — already on this stack, align its structure with the template.
2. `botflix` — the TypeScript rewrite exists but runs on pnpm/node/tsx/vitest; move it to Bun and
   finish the remaining items in its PLAN.md.
3. `zoom-telegram-bot` — Python, ~4k lines, few dependencies.
4. `miband-bot` — Python plus BLE and a vendored `mi-fitness-python`; the hardest one, so it goes last.
