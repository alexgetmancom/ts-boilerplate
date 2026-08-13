# ts-boilerplate plugin

Operate a deployed service built from [ts-boilerplate](https://github.com/alexgetmancom/ts-boilerplate)
from any MCP client.

## Install

```
/plugin marketplace add alexgetmancom/ts-boilerplate
/plugin install ts-boilerplate@alexgetman
```

You will be asked for two values:

- **Service MCP endpoint** — `https://your-domain.example/api/mcp`
- **Service token** — the `MCP_TOKEN` from that deployment's `.env`, stored in secure storage

## What it gives you

The `service` MCP server, plus a skill that tells the agent how to use it. Call `tools/list` against
a deployment to see its actual surface: every service declares its own tools on top of the shared
state tools.
