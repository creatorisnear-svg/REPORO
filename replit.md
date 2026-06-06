# Aviv Bot

A full Discord bot SaaS for Rust Console Edition (RCE) servers, with WebRCON bridge, economy, kits, shop, gambling, ZORP, teleports, prison, bounties, raid alerts, SRP, kill feed, chat bridge, and moderation. Includes a marketing website and Stripe subscriptions.

## Run and Operate

- `pnpm --filter @workspace/api-server run dev` - start the API server and bot (port from `$PORT`, defaults handled by workflow)
- `pnpm run typecheck` - full typecheck across all packages
- `pnpm run build` - typecheck and build all packages

## Stack

- pnpm workspaces, Node.js 24, TypeScript 5.9
- Discord: discord.js v14
- DB: Turso (libsql/SQLite) via `@libsql/client`
- Payments: Stripe
- API: Express 5
- Build: esbuild (ESM bundle)

## Where things live

- `lib/db/` - database client, all query helpers, schema migrations (Turso/SQLite)
- `lib/bot/` - Discord bot: commands, events, RCON manager, log parser, features
- `lib/bot/src/commands/registry.ts` - all slash commands (source of truth)
- `lib/bot/src/rcon/manager.ts` - WebSocket RCON manager with lazy connect + idle drop
- `lib/bot/src/rcon/parser.ts` - log parser, handles all in-game events
- `lib/db/src/schema/index.ts` - all SQL CREATE TABLE statements (source of truth)
- `artifacts/api-server/` - Express server that starts the bot + serves website
- `artifacts/api-server/src/public/` - static HTML pages (index, pricing, docs, setup/success, status)
- `artifacts/api-server/src/routes/` - API routes (health, stripe, setup, auth, dashboard)

## Architecture decisions

- Bot runs inside the api-server process (single process for Koyeb deployment)
- Database is Turso (libsql/SQLite) - external service, no Postgres needed
- `@libsql/client` and `libsql` are marked external in esbuild (native binary)
- RCON uses WebSocket (not TCP) - Rust Console Edition WebRCON protocol
- Slash commands are registered globally on bot ready (no guild-specific registration)
- All config uses `configs` table with key/value pairs - no hard-coded settings

## Product

Rust Console Edition server owners install Aviv Bot, subscribe via Stripe, then add the bot to their Discord. Setup creates roles and channels automatically. The RCON bridge connects to their game server and powers all features in real-time.

## User preferences

- No em dashes anywhere in strings, UI text, or comments
- Deploy target: Koyeb via GitHub
- Single process architecture (bot + web server together)

## Gotchas

- `@libsql/*` and `libsql` must remain in esbuild `external` list (native binaries)
- `rconManager` must be imported from the correct package - re-exported from `@workspace/bot`
- `DISCORD_TOKEN`, `DISCORD_CLIENT_ID`, `TURSO_DATABASE_URL`, `TURSO_AUTH_TOKEN` are required at runtime
- Bot will warn and skip startup if `DISCORD_TOKEN` is not set (does not crash)
- Schema migrations run automatically on server start via `initDatabase()`
- `server_label` is the name field on ServerRow (not `name`)

## Pointers

- See `.env.example` for all required environment variables
- See `lib/bot/src/commands/registry.ts` for the full slash command list (~50 commands)
- See `.local/skills/pnpm-workspace` for workspace structure details
