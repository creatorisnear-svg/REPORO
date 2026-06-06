---
name: Aviv Bot architecture
description: Key architectural decisions for the Aviv Bot pnpm monorepo
---

## Architecture

- **Single process:** Discord bot runs inside the api-server Express process. `startBot()` is called from `artifacts/api-server/src/index.ts` on startup.
- **Parser init:** `lib/bot/src/rcon/parser.ts` exports `initParser(client)`, NOT `handleRconLog`. Call `initParser(client)` inside the `client.once("ready")` handler.
- **rconManager export:** `rconManager` is defined in `lib/bot/src/rcon/manager.ts` and re-exported from `lib/bot/src/index.ts`. Import it as `import { rconManager } from "@workspace/bot"`.
- **DB field name:** `ServerRow.server_label` (not `.name`) holds the server display name.
- **Config pattern:** All feature settings stored as key/value pairs in the `configs` table via `setConfig/getConfig`. The full key list is in `ALL_CONFIG_KEYS` in registry.ts.
- **Schema migrations:** Run automatically via `initDatabase()` on startup - idempotent CREATE TABLE IF NOT EXISTS statements.
- **RCON:** WebSocket protocol (not TCP). WebRCON URL format: `ws://host:port/password`. Manager does lazy connect and 5-minute idle drop.
- **Deploy target:** Koyeb via GitHub push. No Postgres - uses Turso (libsql) as the database.
