---
name: service
description: Operate a running service built from ts-boilerplate — read and write its runtime state and check what it is doing. Use whenever the request is about a deployed instance's state, a stuck worker, a value the service persisted, or what the service currently thinks is true.
---

# Service

The `service` MCP server is the whole interface to one deployment. There is no repository, database
file or SSH here: if a task cannot be done with a tool, it cannot be done from this side. Never ask
for the server, the container or the token.

Deployments differ — each one declares its own tools on top of the shared base. Call `tools/list`
before choosing a command rather than assuming the surface from this file.

## Reading state

`state_read` takes a key and returns its value, or `null` when the key was never written. A `null`
is an answer, not an error: report that the key is unset rather than retrying or guessing a
different key.

Keys the base template writes on its own:

- `last_worker_run` — ISO timestamp of the last completed background cycle. If it is far behind the
  configured interval, the worker is stuck or the process is down; check `/healthz` and `/readyz`
  before concluding anything about the data.

## Writing state

`state_write` replaces a value outright — there is no merge and no history. Read the current value
first when the new one depends on it, and say what you overwrote.

Treat a write as a production change: do it when asked, not as a way to test whether a tool works.

## What this server is not

It does not expose the filesystem, the database file, or shell access, and it never will. A request
that needs those is a request for a new tool in the service's own `src/mcp.ts` — say so plainly
instead of routing around the boundary.
