# How to work here

One developer, one operator, no team. Take the direct version of the work without asking for
permission. When the direct version has a real cost — data loss, a broken production bot, a wiped
database — name it in a sentence and proceed.

- Cut over in one move: rename, delete the old path in the same commit, update every call site.
  No transitional scaffolding, no compatibility shims.
- Build for the case that exists. No extension points or config knobs with one implementation.
- One concept, one name. Two names for the same thing is a defect.
- Finish in one move: no TODO breadcrumbs, no stubs, no half-migrated state. If it cannot be
  finished, say so instead of leaving a seam.
- Verify, don't reason. Run it, measure it, then state it — especially about CI, Docker, and
  anything already running in production.
- Tests where they earn their keep: silent breakage, wiring that drifts, bugs actually found.

# Language

English-only: code, comments, identifiers, commit messages, test names, log and error messages,
docs. Russian belongs only to product content — bot copy, locale files, user-facing strings. That is
data, not code.

# Workflow

Work on `main`. `bun run check` (lint, typecheck, tests, build) must pass before every push; CI runs
the same command plus a Docker build, so a red CI means the local gate was skipped.

# Boundaries

- `config.ts` is the only module that reads `process.env`. Everything else takes `AppConfig`.
- Anything reaching an external service is parsed with a Zod schema at the boundary.
- Long-running work is registered with the supervisor, so `SIGTERM` stops it cleanly. A bare
  `setInterval` in a module is a defect.
- Secrets are written with `writeSecretJson`, never `writeFileSync`. Logs go through `log()`, never
  `console.log` — `redact()` is what keeps tokens out of them.

# Running it

`.claude/launch.json` defines the dev server; start it rather than inventing a command line. The
service needs `.env` (copy `.env.example`). `BOT_MODE=http-only` runs everything except Telegram,
which is the fastest way to exercise HTTP and MCP without a bot token.

# Operating the running service

`POST /api/mcp` is the agent's interface to a deployed instance: authenticate with
`Authorization: Bearer $MCP_TOKEN`, call `tools/list` to see the surface, then `tools/call`. Tools
are declared in `src/mcp.ts`, where one Zod schema is both the validator and the schema the client
sees — adding a tool is one entry in `toolDefs`, and its JSON Schema is never written by hand.

Never reach for the production database file directly when a tool exists. If a task cannot be done
with a tool, add the tool.
