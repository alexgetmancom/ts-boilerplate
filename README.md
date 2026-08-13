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
  http.ts              Hono: /, /healthz (liveness), /readyz (readiness), /telegram/webhook, /api/mcp
  mcp.ts               MCP server: JSON-RPC tools an agent calls to operate the running service
  auth.ts              timing-safe bearer-token check
  index.ts             composition root: wiring, startup, graceful shutdown
  bot/
    bot.ts             grammY: config middleware, allowlist, /start, /ping, notifier
    context.ts         AppContext = grammY Context + config + database
  runtime/
    supervisor.ts      registry of stoppable resources, stopped in reverse order
    worker.ts          interval worker: never overlaps cycles, awaits the current one on stop
    shutdown.ts        stops Bun.serve with a timeout before forcing
    sleep.ts           delay that returns early when an AbortSignal fires
    status.ts          botReady / botError backing /readyz
  storage/
    kv.ts              bun:sqlite, migration, getState/setState
    files.ts           atomic writes, owner-only mode for secrets
scripts/
  manage-webhook.ts    set / delete / info for the Telegram webhook
tests/                 bun test: config, http, kv, files, logger, mcp, runtime
plugin/                installable plugin: MCP config + skill, for operating a deployment
AGENTS.md              how an agent works in this repo (CLAUDE.md is a symlink to it)
.claude/launch.json    how an agent starts the dev server
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
Projects have secrets the generic pattern cannot anticipate — a vendor's `ssecurity` field, a signed
`download_url` — so register those at startup with `redactKeysMatching(/…/i)` rather than editing the
module downstream.

**The allowlist is closed by default.** `ALLOWED_USERS` is mandatory whenever a bot runs, and the
service refuses to start without it. An allowlist that is easy to leave unset is one that will be
left unset in production.

**Graceful shutdown is real, not decorative.** `SIGTERM` → workers (each finishes its current cycle)
→ bot → HTTP server (10s to drain, then forced) → database close. A repeated signal is ignored.

**Secrets are written atomically and owner-only.** `writeSecretJson()` writes through a temporary
file at mode `0600` and renames it into place: a crash mid-write cannot truncate a credential file,
and the secret is never briefly world-readable.

**The service is agent-operable, not just agent-editable.** `POST /api/mcp` exposes declared tools
behind a bearer token, so an agent runs a deployment through its own interface instead of reaching
for the database file. One Zod schema per tool is both the validator and the schema the client sees
— a field rejected at runtime can never be a field advertised as accepted, and no JSON Schema is
written by hand. Adding a tool is one entry in `toolDefs`.

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
- **An agent should operate the service:** add tools to `toolDefs` in `src/mcp.ts`, then describe
  when to use them in `plugin/skills/service/SKILL.md`. Set `MCP_TOKEN` to mount the endpoint.

## Projects on this stack

`alexgetman.com`, `check-radar`, `x-news-bot`, `botflix`, `miband-bot`, `zoom-tg-bot`. Anything
learned in one of them that is not project-specific belongs back here.
