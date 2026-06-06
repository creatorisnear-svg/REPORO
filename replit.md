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

## Koyeb Deployment Setup

Aviv Bot is designed to run on Koyeb via GitHub. Follow these steps to go live:

### 1. Push code to GitHub
Create a GitHub repo and push this project to the `main` branch.

### 2. Create a Turso database
- Sign up at https://turso.tech
- Create a new database and get your `TURSO_DATABASE_URL` and `TURSO_AUTH_TOKEN`

### 3. Create a Discord Application
- Go to https://discord.com/developers/applications
- Create a new application, add a Bot user
- Copy your `DISCORD_TOKEN` and `DISCORD_CLIENT_ID`
- Under OAuth2, add your Koyeb app URL as a redirect: `https://yourapp.koyeb.app/auth/callback`
- Copy your `DISCORD_CLIENT_SECRET`
- Invite the bot to your Discord server with the bot invite URL (scopes: `bot`, `applications.commands`)

### 4. Set up Stripe (optional, for subscriptions)
- Create price IDs for Basic, Pro, and Enterprise plans
- Copy `STRIPE_SECRET_KEY`, `STRIPE_WEBHOOK_SECRET`, `STRIPE_PRICE_BASIC`, `STRIPE_PRICE_PRO`, `STRIPE_PRICE_ENTERPRISE`
- Add a webhook endpoint pointing to `https://yourapp.koyeb.app/api/stripe/webhook`

### 5. Deploy on Koyeb
- Connect your GitHub repo to Koyeb
- Set the build command: `pnpm install && pnpm --filter @workspace/api-server run build`
- Set the run command: `node --enable-source-maps ./artifacts/api-server/dist/index.mjs`
- Set the port to `8080`
- Add all environment variables from `.env.example`
- Set `DISCORD_REDIRECT_URI` to `https://yourapp.koyeb.app/auth/callback`
- Set `SESSION_SECRET` to a long random string
- Deploy

### 6. In-Discord setup
Once the bot is online:
1. In your Discord server, run `/setup` to create roles and channels
2. Run `/add-server host:<ip> port:28016 password:<rconpass>` to connect your Rust server
3. Set up features with `/set` or `/configs`

### URL Reference (replace yourapp with your Koyeb app name)
- Website: `https://yourapp.koyeb.app/`
- Pricing: `https://yourapp.koyeb.app/pricing`
- Setup wizard: `https://yourapp.koyeb.app/setup-wizard`
- Dashboard: `https://yourapp.koyeb.app/dashboard`
- Status: `https://yourapp.koyeb.app/status`
- API health: `https://yourapp.koyeb.app/api/health`
- Stripe webhook: `https://yourapp.koyeb.app/api/stripe/webhook`

## Pointers

- See `.env.example` for all required environment variables
- See `lib/bot/src/commands/registry.ts` for the full slash command list (~51 commands)
- See `.local/skills/pnpm-workspace` for workspace structure details
