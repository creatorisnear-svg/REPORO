# AVIV BOT — Full Replit Build Prompt

---

## WHAT YOU ARE BUILDING

A Discord bot SaaS called **Aviv Bot** for Rust Console Edition (RCE) servers. It bridges Discord and Rust servers via WebRCON. Customers pay a monthly subscription, complete a setup form, and Aviv Bot joins their Discord and connects to their Rust server. One single Node.js bot process handles ALL customer servers simultaneously.

---

## TECH STACK

- **Runtime:** Node.js
- **Discord:** discord.js v14
- **Database:** Turso (hosted SQLite) using `@libsql/client`
- **Payments:** Stripe (subscriptions + webhooks)
- **RCON:** `rcon-client` npm package (WebSocket RCON)
- **Web framework:** Express.js (backend API)
- **Frontend:** HTML/CSS/JS (static pages)
- **Email:** Nodemailer or Resend for transactional emails

---

## PROJECT STRUCTURE

```
/
├── bot/
│   ├── index.js              # Bot entry point
│   ├── commands/             # All slash commands
│   ├── events/               # Discord event handlers
│   ├── rcon/
│   │   ├── manager.js        # RCON connection manager (lazy load)
│   │   └── parser.js         # Console log parser
│   └── features/             # One file per feature module
├── web/
│   ├── server.js             # Express API server
│   ├── routes/               # API routes
│   └── public/               # Static frontend files
├── db/
│   └── schema.js             # Database schema + migrations
├── .env
└── package.json
```

---

## DATABASE SCHEMA

Create these tables in Turso:

```sql
-- Customers (one per paying subscriber)
CREATE TABLE customers (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  stripe_customer_id TEXT UNIQUE,
  email TEXT UNIQUE NOT NULL,
  plan TEXT DEFAULT 'basic',
  status TEXT DEFAULT 'pending',
  created_at DATETIME DEFAULT CURRENT_TIMESTAMP
);

-- Servers (each customer can have multiple Rust servers)
CREATE TABLE servers (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  customer_id INTEGER REFERENCES customers(id),
  discord_guild_id TEXT,
  rcon_host TEXT,
  rcon_port INTEGER,
  rcon_password TEXT,
  server_label TEXT DEFAULT 'Server 1',
  server_number INTEGER DEFAULT 1,
  active INTEGER DEFAULT 1
);

-- Players (linked Discord <-> in-game name)
CREATE TABLE players (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  server_id INTEGER REFERENCES servers(id),
  discord_user_id TEXT,
  ingame_name TEXT,
  linked_at DATETIME DEFAULT CURRENT_TIMESTAMP
);

-- Economy (currency balances)
CREATE TABLE economy (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  server_id INTEGER REFERENCES servers(id),
  ingame_name TEXT,
  balance INTEGER DEFAULT 0,
  last_kill_farm TEXT,
  last_daily TEXT
);

-- Lists (viplist, elitelist1..44, zorpallowlist, zorpbanlist, prisonlist, noteblocklist, recyclerlist, etc.)
CREATE TABLE lists (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  server_id INTEGER REFERENCES servers(id),
  list_name TEXT,
  ingame_name TEXT
);

-- Kits cooldowns
CREATE TABLE kit_claims (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  server_id INTEGER REFERENCES servers(id),
  ingame_name TEXT,
  kit_name TEXT,
  last_claimed DATETIME
);

-- ZORP zones
CREATE TABLE zorp_zones (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  server_id INTEGER REFERENCES servers(id),
  ingame_name TEXT,
  team_id TEXT,
  zone_id TEXT,
  created_at DATETIME,
  expires_at DATETIME
);

-- Teleport homes
CREATE TABLE tp_homes (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  server_id INTEGER REFERENCES servers(id),
  ingame_name TEXT,
  home_set INTEGER DEFAULT 0,
  set_at DATETIME
);

-- Prison
CREATE TABLE prison (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  server_id INTEGER REFERENCES servers(id),
  ingame_name TEXT,
  reason TEXT,
  release_at DATETIME
);

-- Bounties
CREATE TABLE bounties (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  server_id INTEGER REFERENCES servers(id),
  target_name TEXT,
  kill_count INTEGER DEFAULT 0,
  reward INTEGER DEFAULT 0,
  active INTEGER DEFAULT 1
);

-- Scheduled messages
CREATE TABLE scheduler (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  server_id INTEGER REFERENCES servers(id),
  message TEXT,
  interval_minutes INTEGER,
  last_sent DATETIME
);

-- Server configs (key-value store for all /set settings)
CREATE TABLE configs (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  server_id INTEGER REFERENCES servers(id),
  config_key TEXT,
  config_value TEXT
);

-- Channel assignments
CREATE TABLE channels (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  server_id INTEGER REFERENCES servers(id),
  channel_type TEXT,
  discord_channel_id TEXT
);

-- Warnings
CREATE TABLE warnings (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  server_id INTEGER REFERENCES servers(id),
  ingame_name TEXT,
  reason TEXT,
  issued_at DATETIME DEFAULT CURRENT_TIMESTAMP
);

-- Shop
CREATE TABLE shop_categories (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  server_id INTEGER REFERENCES servers(id),
  name TEXT,
  parent_id INTEGER,
  category_type TEXT DEFAULT 'item',
  required_role TEXT
);

CREATE TABLE shop_products (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  category_id INTEGER REFERENCES shop_categories(id),
  name TEXT,
  shortname TEXT,
  price INTEGER,
  stock INTEGER DEFAULT -1,
  timer_hours INTEGER DEFAULT 0
);
```

---

## RCON CONNECTION MANAGER

File: `bot/rcon/manager.js`

- Keep a Map of `server_id -> rcon_connection`
- Lazy connect: only connect when a command needs it
- Drop idle connections after 5 minutes of no use
- On connect, start streaming logs via WebSocket
- Reconnect automatically if connection drops
- Expose methods:
  - `getConnection(server_id)` — returns active connection, creates if needed
  - `sendCommand(server_id, command)` — sends RCON command, returns response
  - `dropConnection(server_id)` — manually close connection

---

## CONSOLE LOG PARSER

File: `bot/rcon/parser.js`

Listen to the RCON log stream. Parse these patterns:

```
[CHAT] PlayerName : I need wood           -> Free kit trigger
[CHAT] PlayerName : I need stone          -> VIP kit trigger
[CHAT] PlayerName : I Need Metal Fragments -> elitekit1 trigger
[CHAT] PlayerName : Can I build around here? -> ZORP step 1
[CHAT] PlayerName : Yes                   -> ZORP step 2 (or TP HOME confirm)
[CHAT] PlayerName : Goodbye               -> ZORP delete
[CHAT] PlayerName : Retreat!              -> TP HOME trigger
[CHAT] PlayerName : Repair This           -> Recycler claim trigger
[CHAT] PlayerName : Can I have a key?     -> TP HOME set trigger
[CHAT] PlayerName : N                     -> TPN teleport
[CHAT] PlayerName : NE                    -> TPNE teleport
[CHAT] PlayerName : E                     -> TPE teleport
[CHAT] PlayerName : SE                    -> TPSE teleport
[CHAT] PlayerName : S                     -> TPS teleport
[CHAT] PlayerName : SW                    -> TPSW teleport
[CHAT] PlayerName : W                     -> TPW teleport
[CHAT] PlayerName : NW                    -> TPNW teleport
[CHAT] PlayerName : I'm out of ammo       -> Two-step elitekit prefix (sets 30s window)

[KILL] KillerName killed VictimName with WeaponName
[JOIN] PlayerName joined the server
[LEAVE] PlayerName left the server
```

For the two-step elitekit (kits 23-44): when `I'm out of ammo` is detected, store `{ playerName, timestamp }` in memory. If within 30 seconds that same player sends another phrase, treat it as the two-step kit claim.

---

## PERMISSION ROLES (created by /setup)

- **avivadmin** — full access to all commands
- **avivmod** — limited access, blocked from kit-give and major setting changes by default
- **avivlinked** — regular players after linking

---

## AUTO CHANNEL SETUP (runs on /setup)

When `/setup` runs, automatically create these Discord channels:
- `#aviv-killfeed`
- `#aviv-player-feed`
- `#aviv-raids`
- `#aviv-chat`
- `#aviv-events`
- `#aviv-logs`
- `#aviv-announcements`
- `#aviv-errors`
- `#aviv-cmd-logs`

Also create a voice channel: `| Server 1 ▶ 🌐 0 🕐 0` (auto-updates with player count)

Admin can reassign any channel with `/admin-channels`.

---

## ALL BOT COMMANDS

### Setup & Core
- `/setup` — creates roles, creates channels, sets up initial config, saves server to DB
- `/add-server` — add a second/third Rust server RCON connection
- `/remove-server` — remove a server
- `/configs [server]` — dropdown embed showing ALL settings for every feature
- `/set [config_name] [option] [server]` — change any setting with autocomplete
- `/aviv` — simplified panel UI for settings (like KaosBot's /kaos)
- `/diag` — diagnostics panel: RCON connection health, ping, last response time
- `/admin-channels` — reassign channel feeds
- `/admin-positions` — view/add/remove teleport positions
- `/admin-scheduler` — view/add/remove scheduled messages

### Console / RCON
- `!console [command]` — send RCON command to server 1 (prefix command, not slash)
- `!console2 [command]` — server 2
- `!console3 [command]` — server 3
- `!consoles [command]` — send to ALL servers
- `!say [message]` — send message to in-game chat

### Linking
- `/link [ingame_name]` — link Discord to in-game name, assigns avivlinked role
- `/unlink` — remove link
- `/admin-link [ingame_name] [@discord]` — admin fixes wrong links
- `/whois [@discord or ingame_name]` — look up who is linked to what
- `/sync-me` — player syncs their own roles
- `/sync-target [@player]` — admin syncs another player's roles
- `/get-playerinfo [ingame_name]` — see player info + what lists they're on

### Lists
- `/add-to-list [list_name] [ingame_name] [server]`
- `/remove-from-list [list_name] [ingame_name] [server]`
- `/get-list [list_name] [server]`

Supported list names: `viplist`, `elitelist1` through `elitelist44`, `zorpallowlist`, `zorpbanlist`, `prisonlist`, `noteblocklist`, `recyclerlist`, and any custom list name

### Kits
- `/givekit [ingame_name] [kit_name] [server]` — admin manually gives any kit (avivadmin only)
- `/set freekit [on/off] [server]`
- `/set freekit-time [hours] [server]`
- `/set freekit-name [name] [server]`
- `/set vipkit [on/off] [server]`
- `/set vipkit-time [hours] [server]`
- `/set vipkit-name [name] [server]`
- `/set elitekit [on/off] [server]` — for elitekit1, elitekit2 etc.
- `/set elitekit-time [hours] [server]`
- `/set elitekit_uselist [on/off] [kit_name] [server]`

Kit delivery: send RCON command `giveto [ingame_name] [kit_name]`

### Economy / Currency
- `/balance [ingame_name]` — check balance
- `/daily` — claim daily reward (random between min/max, default 30-300)
- `/transfer [@player] [amount]` — send currency to another player
- `/swap [amount] [server_from] [server_to]` — move currency between servers
- `/leaderboard` — top earners
- `/set currency_name [name] [server]` — rename the currency
- `/setdailyscale [min] [max]` — set daily reward range
- `/killpoints [player/scientist] [amount]` — set points per kill type
- `/add-points-player [ingame_name] [amount] [server]`
- `/sub-points-player [ingame_name] [amount] [server]`
- `/add-points-server [amount] [server]` — give points to ALL players
- `/sub-points-server [amount] [server]`

Economy rules:
- Default: 30 points per player kill, 1 point per scientist kill
- Anti-farm: same player can only earn currency once per 30 minutes from same victim
- Players earn nothing until they have used `/link`

### Virtual Gambling
- `/spin` — play Rust bandit wheel
- `/coinflip` — coinflip
- `/blackjack` — blackjack
- `/maxbet [amount]` — admin sets max bet

### Shop
- `/shop` — browse shop in Discord embed
- `/admin-shop-create-shop [server]`
- `/admin-shop-delete-shop [server]`
- `/admin-shop-add-category [name] [server]`
- `/admin-shop-add-subcategory [name] [parent] [server]`
- `/admin-shop-add-item [name] [shortname] [price] [category] [server]`
- `/admin-shop-add-kit [kit_name] [price] [category] [server]`
- `/admin-shop-edit-product [product] [server]`
- `/admin-shop-remove-product [product] [server]`
- `/delayshop [minutes] [server]` — temporarily close shop
- `/openshop [server]` — reopen early
- `!maxspend [amount]` — set daily spend limit

Notes: items go in item categories, kits go in kit categories. Adding a timer to a product limits it to one purchase per time period.

### Recyclers
- Triggered in-game via Quick Chat: `Repair This`
- Bot spawns recycler at player's location via RCON
- Recyclers always face north — warn players about tight spaces
- `/set recyclers_use [on/off] [server]`
- `/set recyclers_time [hours] [server]`
- `/set recyclers_uselist [on/off] [server]`
- List-based: `recyclerlist` — roles `recycler-1`, `recycler-2`, `recycler-all`
- Sellable in shop: add item with shortname `recycler`, use a timer matching wipe length

### Teleport System
9 teleports total:
| Quick Chat | Config Name |
|---|---|
| N | TPN |
| NE | TPNE |
| E | TPE |
| SE | TPSE |
| S | TPS |
| SW | TPSW |
| W | TPW |
| NW | TPNW |
| Can I have a key? | TPHOME |

TP HOME flow:
1. Player uses "Can I have a key?" — bot kills them via RCON
2. Player selects their bed/sleeping bag at respawn — that is now their home
3. Player uses "Retreat!" to teleport home

Each teleport has these config options (replace TPN with the config name):
- `/set TPN_use [on/off] [server]`
- `/set TPN_name [display_name] [server]`
- `/set TPN_time [hours] [server]` — 1 = 1 hour, 0.0168 = 1 minute
- `/set TPN_uselist [on/off] [server]`
- `/set TPN_usedelay [on/off] [server]`
- `/set TPN_delaytime [seconds] [server]`
- `/set TPN_usekit [on/off] [server]`
- `/set TPN_kitname [kit_name] [server]`
- `/set TPN_kill [on/off] [server]` — kill player before teleporting

Combat lock:
- `/set combatlock_use [on/off] [server]`
- `/set combatlock_time [seconds] [server]` — default 60

Positions:
- Single position only: Outpost, Event, Prison
- Multiple positions allowed for all 9 named teleports — if multiple set, random one picked per player
- `/admin-positions` — manage all positions

Legacy teleports (OutpostTP, EventTP) exist but have no advanced controls.

Access lists: role `tpn-1` auto-adds linked player to TPN list on server 1.

### ZORP (Zoned Offline Raid Protection)
Player flow:
1. Must be team leader
2. Quick Chat: "Can I build around here?" → Quick Chat: "Yes" → zone created
3. Refresh before logging off: "Can I build around here?" → "Yes" → bot replies "ORP REFRESHED"
4. Delete: "Can I build around here?" → "Goodbye"

Zone rules:
- Expires every 24 hours unless refreshed
- Cannot overlap another team's zone
- If team composition changes, zone is removed automatically
- When team all offline for zorptime → zone goes Red (protected)
- When any team member online → Yellow/Green (unprotected)

Zone colours: White (new), Green (team online), Yellow (offline, not long enough), Red (offline, protected)

Admin commands:
- `/set zorp [on/off] [server]`
- `/set zorptime [minutes] [server]`
- `/set zorpExpiryTime [hours] [server]` — 24 to 72
- `/set zorpallowlist [on/off] [server]`
- `/add-to-list zorpallowlist [ingame_name] [server]`
- `/remove-from-list zorpallowlist [ingame_name] [server]`
- `/get-list zorpallowlist [server]`
- `/add-to-list zorpbanlist [ingame_name] [server]`
- `/remove-from-list zorpbanlist [ingame_name] [server]`
- `/get-list zorpbanlist [server]`
- `/wipe-zorp [server]` — delete all zones
- `/del-zorp [ingame_name] [server]` — delete one zone

ZORP logs to player-feed channel: zone created, deleted, expired, collision deleted, invalid SYNC zone.

Discord role `zorp-1` auto-adds linked player to zorpallowlist on server 1.

### Raid Alerts
- Players register a base broadcaster frequency
- When base is attacked and frequency fires, player is pinged in raid-alerts channel
- `/set raidalerts [on/off] [server]`
- `/raidlink` — player registers their frequency
- `/list-raidlink [server]` — admin views all registered frequencies
- `/list-raidalert [server]` — check currently firing frequencies
- `/wipe-raidlink [server]` — clear all frequencies
- `/del-raidlink [ingame_name] [server]` — remove one frequency

### Scheduled Raid Protection (SRP)
- Server-wide raid protection on a set schedule
- `/set SRP [on/off] [server]`
- `/set srp-time-monday [HH:MM~HH:MM] [server]` — one window
- `/set srp-time-monday [HH:MM~HH:MM,HH:MM~HH:MM] [server]` — two windows
- Same pattern for all days: srp-time-tuesday, srp-time-wednesday, etc.
- All times in UTC
- When SRP is active AND ZORP is on: all ZORP zones shift to protected state
- If admin turns SRP off mid-protection: `!console server.allowpvbdamage 1`

### Prison System
- Teleports player to prison location and keeps sending them back
- Auto-release after duration
- `/prison [ingame_name] [duration_minutes] [reason] [server]` — send to prison
- `/unprison [ingame_name] [server]` — release early
- `/prison-list [server]` — see all imprisoned players
- `/set prison-location [server]` — set the prison position (use /admin-positions)
- Prisoner gets Discord DM with reason
- All prison actions posted to logs channel
- List-based: `/add-to-list prisonlist`, `/remove-from-list prisonlist`

### Bounty System (Automatic)
- Automatically targets players with high kill counts — no manual placement
- When a bounty target is killed, killer receives coin reward
- Reward scales based on how many kills the target had
- `/set BountySystem [on/off] [server]`
- `/set BountyReward [amount] [server]` — base coin reward
- `/set BountyScale [decimal] [server]` — e.g. 0.1 = 10% increase per kill
- `/set BountyDuration [minutes] [server]`
- `/set BountyMaxTargets [number] [server]`
- `/set BountyMinKills [number] [server]`
- `/set BountyUnique [on/off] [server]` — recommended on, only unique kills count (anti-abuse)

### Kill Feed
- Post every kill to killfeed channel
- Format (use your own style, NOT KaosBot's): `⚔️ **PlayerA** took down **PlayerB** with *AK47* — 47m`
- Detect and label: headshots, suicides, environmental deaths, scientist kills
- Kill streak milestones: announce at 5, 10, 15+ kills
- Daily most-kills leaderboard auto-posted

Kill feed configs (via `/set`):
- `KillFeedGame` — show kill feed in-game
- `KillFeedDiscord` — show kill feed in Discord
- `KillFeedKD` — show KDR
- `MiscKills` — toggle misc kills
- `AdminLogs` — item spawn logs globally
- `InGameLogs` — item spawn logs in-game
- `DiscordLogs` — item spawn logs in Discord
- `ScientistKiller` — show scientist as killer in feed
- `ScientistVictim` — show scientist as victim in feed
- `killercolor`, `phrasecolor`, `victimcolor` — hex or named colour
- `killphrase` — custom kill phrase word
- `killphraserandomizer` — randomise kill phrases

### Moderation
- `/kick [ingame_name] [reason] [server]`
- `/ban [ingame_name] [reason] [server]`
- `/unban [ingame_name] [server]`
- `/mute [ingame_name] [server]`
- `/unmute [ingame_name] [server]`
- `/warn [ingame_name] [reason] [server]`
- `/warnings [ingame_name] [server]`
- `/clearwarnings [ingame_name] [server]`

All actions auto-posted to logs channel. All require avivadmin or avivmod role.

### Notes System
The notes system is for IN-GAME note messages written by players (not admin notes on players).
- If player is on `noteblocklist` they cannot send note messages
- `/set notemessaging [true/false] [server]`
- `/add-to-list noteblocklist [ingame_name] [server]`
- `/remove-from-list noteblocklist [ingame_name] [server]`
- `/get-list noteblocklist [server]`

Note messages are logged to the note-feed channel.

### Auto Message Scheduler
- `/admin-scheduler` — view/add/remove scheduled in-game chat messages
- `/set scheduler-time [interval_minutes] [server]`
- `/set scheduler [true/false] [server]`

### Chat Bridge
- Everything said in `#aviv-chat` Discord channel → sent to in-game chat
- Everything said in-game → posted to `#aviv-chat`
- Format: `[Discord] Username: message`
- `/set chatbridge [on/off] [server]`

### Channel Feed Setup
All assigned via `/admin-channels`. Available feed types:
- **Kill Feed** — kill log every XX minutes
- **Player Feed** — joins, leaves, ZORP logs
- **Note Feed** — in-game note messages
- **Zorp Feed** — ZORP activity
- **Admin Feed** — commands used by admins in-game
- **Error Feed** — errors like non-existent kits being claimed
- **cmd_logs** — commands used by avivadmin and avivmod in Discord
- **Player Count** — set to a VOICE channel, auto-updates name: `| Server 1 ▶ 🌐 37 🕐 0`
- **Server Info** — auto-updating image showing FPS, players, queued, entities, ZORP zone count
- **Raid Alerts** — players pinged here when base frequency fires
- **Transactions** — used by log parser for Tip4Serv and external services

Multiple feed types can point to the same Discord channel.

---

## ROLE AUTOMATION

When a linked player is given a Discord role, the bot automatically adds them to the corresponding list:

| Discord Role | Action |
|---|---|
| `vip-1` | Add to viplist on server 1 |
| `vip-all` | Add to viplist on all servers |
| `elitekit1-1` | Add to elitelist1 on server 1 |
| `elitekit2-1` | Add to elitelist2 on server 1 |
| `zorp-1` | Add to zorpallowlist on server 1 |
| `recycler-1` | Add to recyclerlist on server 1 |
| `tpn-1` | Add to TPN teleport list on server 1 |
| (same pattern for all features and server numbers) |

When a role is removed, the player is removed from the corresponding list.

---

## WEBSITE (EXPRESS + STATIC HTML)

### Pages
1. `GET /` — Landing page (hero, features, pricing, buy button)
2. `GET /pricing` — Package comparison (Basic / Pro / Elite)
3. `GET /checkout` — Stripe checkout redirect
4. `GET /setup` — 3-step setup form
5. `GET /dashboard` — Customer dashboard (login with Discord OAuth)
6. `GET /docs` — Command list
7. `GET /status` — Bot online/offline indicator

### Setup Page (3 Steps)

**Step 1:** Already purchased? Skip to Step 2. Not yet? → [BUY AVIV] button → Stripe checkout.

**Step 2:** Grant access to your Rust server:
- [GPortal] — add `avivbot` to Permissions in GPortal dashboard
- [Nitrado] — add `avivbot` to Guest Access Rights in Nitrado dashboard
- [Other host] — enable RCON and provide credentials

**Step 3:** Submit form:
- Email used at purchase
- Discord server invite link
- Rust server RCON IP
- RCON port
- RCON password
- Submit → backend verifies Stripe → provisions bot → bot joins Discord → connects to Rust server

### API Routes

```
POST /api/stripe/webhook     — Stripe webhook (subscription created/cancelled)
POST /api/setup              — Process setup form submission
GET  /api/auth/discord       — Discord OAuth login
GET  /api/auth/callback      — Discord OAuth callback
GET  /api/dashboard          — Get customer's bot status + configs
POST /api/dashboard/update   — Update customer settings
```

### After Setup Form Submit
1. Verify email matches a Stripe paid customer in DB
2. Look up their Discord invite link → bot joins server via invite
3. Store RCON credentials in DB
4. Bot registers slash commands on their server
5. Send welcome DM to customer with next steps link

---

## STRIPE INTEGRATION

- Monthly subscription plans (Basic, Pro, Elite)
- On `customer.subscription.created` webhook → create customer record in DB → send setup email
- On `customer.subscription.deleted` webhook → set customer status to inactive → bot leaves their Discord
- Use Stripe Customer Portal for self-service cancel/upgrade
- Store `stripe_customer_id` in customers table to verify setup form submissions

---

## MULTI-SERVER LOGIC

- Every command that affects the Rust server has a `server` parameter: `1`, `2`, `3`, or `All`
- Commands default to server 1 if no server specified
- The RCON manager keeps connections keyed by server_id
- All DB queries filter by server_id

---

## MEMORY / RAM EFFICIENCY (Koyeb 512MB limit)

- Never load all customers at once — query DB on demand
- RCON connections are lazy — only connect when needed
- Drop RCON connections idle for more than 5 minutes
- Cache only the current guild's configs in memory during command execution, then discard
- Use streaming for RCON log parsing, not buffering

---

## ENVIRONMENT VARIABLES NEEDED

```
DISCORD_TOKEN=
DISCORD_CLIENT_ID=
DISCORD_CLIENT_SECRET=
TURSO_DATABASE_URL=
TURSO_AUTH_TOKEN=
STRIPE_SECRET_KEY=
STRIPE_WEBHOOK_SECRET=
SESSION_SECRET=
BASE_URL=https://avivbot.com
```

---

## BUILD ORDER

Build in this exact order so each step is testable:

1. **DB setup** — Turso connection + run schema migrations
2. **Bot skeleton** — Discord.js login, register slash commands
3. **Express server** — basic routes, static files
4. **/setup command** — creates roles, creates channels, saves server to DB
5. **Linking system** — /link, /unlink, /admin-link, /whois
6. **RCON connection manager** — lazy connect, send commands, drop idle
7. **Console commands** — !console, !say
8. **Log parser** — RCON stream listener, pattern matching
9. **Stripe + website** — checkout, webhook, setup form, provisioning
10. **Kits** — free kit, VIP kit, elite kits 1-22, two-step kits 23-44
11. **Economy** — balance, daily, transfer, swap, kill rewards, anti-farm
12. **Gambling** — /spin, /coinflip, /blackjack, /maxbet
13. **Shop** — categories, products, /shop embed, purchase flow
14. **Recyclers** — Repair This trigger, list management
15. **Teleports** — all 9, TP HOME flow, combat lock
16. **ZORP** — zone create/refresh/delete, expiry, team change detection
17. **Raid alerts** — frequency registration, ping on trigger
18. **SRP** — scheduled windows, integration with ZORP
19. **Prison** — teleport to prison, keep sending back, auto-release
20. **Bounty** — automatic kill tracking, reward payout
21. **Kill feed** — kill format, streaks, daily leaderboard
22. **Moderation** — kick, ban, mute, warn, clearwarnings
23. **Notes system** — noteblocklist, notemessaging toggle
24. **Scheduler** — auto in-game messages on interval
25. **Chat bridge** — Discord <-> in-game two-way
26. **Channel feeds** — all feed types, player count voice channel, server info image
27. **Role automation** — Discord role → list sync
28. **/configs command** — dropdown embed showing all settings
29. **Dashboard** — Discord OAuth, customer dashboard UI
30. **Polish** — error handling, /diag, status page, docs page

---

## BRANDING NOTES

- Bot name: **Aviv** (not KaosBot)
- Role names: `avivadmin`, `avivmod`, `avivlinked`
- Panel command: `/aviv` (not /kaos)
- Currency name: configurable via `/set currency_name`
- Kill feed format: design your own — must look different from KaosBot's
- All code written from scratch — do not copy any KaosBot code or UI
