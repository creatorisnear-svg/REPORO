# AVIV BOT — Continue Building (What's Missing)

The foundation is solid. Here is exactly what needs to be completed. Work through each section fully before moving to the next.

---

## 1. FIX THE ELITE KIT PHRASE MAPPING (CRITICAL)

In `lib/bot/src/rcon/parser.ts`, the `handleChatMessage` function only handles elitekit1. You need to add ALL single-step elitekits (2–22) and fix the two-step elitekits (23–44).

### Single-step elitekits 1–22
Replace the current single elitekit1 block with this complete mapping:

```typescript
const singleStepKits: Record<string, string> = {
  "I Need Metal Fragments": "elitekit",       // elitekit1
  "I Need Scrap": "elitekit2",
  "I Need Low Grade Fuel": "elitekit3",
  "I Need Food": "elitekit4",
  "Follow Me": "elitekit5",
  "Help!": "elitekit6",
  "Nice": "elitekit7",
  "Sorry": "elitekit8",
  "Thank You": "elitekit9",
  "You're Welcome": "elitekit10",
  "Good Game": "elitekit11",
  "Watch Out": "elitekit12",
  "Good Luck": "elitekit13",
  "Well Played": "elitekit14",
  "Yes": "elitekit15",       // NOTE: only when NOT in ZORP flow
  "No": "elitekit16",
  "Retreat!": "elitekit17",  // NOTE: only when NOT in TPHOME flow
  "Attack": "elitekit18",
  "Wait": "elitekit19",
  "Go Go Go": "elitekit20",
  "Need Backup": "elitekit21",
  "On My Way": "elitekit22",
};
```

IMPORTANT: "Yes" and "Retreat!" are already used for ZORP and TPHOME. The kit check for these must only fire if the player is NOT currently in a ZORP pending state or TPHOME pending state. Check those Maps first — if no pending state exists for the player, then treat it as a kit trigger.

### Two-step elitekits 23–44
When `"I'm out of ammo"` is detected, set a 30-second window for that player. When their next message comes in within that window, map it to the correct kit using this table:

```typescript
const twoStepKits: Record<string, string> = {
  "I Need Wood": "elitekit23",
  "I Need Stone": "elitekit24",
  "I Need Scrap": "elitekit25",
  "I Need Metal Fragments": "elitekit26",
  "I Need Low Grade Fuel": "elitekit27",
  "I Need Food": "elitekit28",
  "Follow Me": "elitekit29",
  "Help!": "elitekit30",
  "Nice": "elitekit31",
  "Sorry": "elitekit32",
  "Thank You": "elitekit33",
  "You're Welcome": "elitekit34",
  "Good Game": "elitekit35",
  "Watch Out": "elitekit36",
  "Good Luck": "elitekit37",
  "Well Played": "elitekit38",
  "Yes": "elitekit39",
  "No": "elitekit40",
  "Attack": "elitekit41",
  "Wait": "elitekit42",
  "Go Go Go": "elitekit43",
  "Need Backup": "elitekit44",
};
```

When a two-step kit is triggered, delete the pending state immediately so it can't be triggered again.

---

## 2. FIX THE KIT CONFIG KEY NAMING

In `handleKit()` in parser.ts, the config key lookup uses `${kitType}_use` but the first elite kit is named `elitekit` (not `elitekit1`). Make sure:

- Kit named `elitekit` uses config keys: `elitekit_use`, `elitekit_time`, `elitekit_name`, `elitekit_uselist`, list name `elitelist1`
- Kit named `elitekit2` uses: `elitekit2_use`, `elitekit2_time`, etc., list name `elitelist2`
- And so on for all 44

The RCON delivery command must use the kit's config name value (from `${kitType}_name` config), falling back to the kitType itself if not set.

---

## 3. FIX THE SETUP FLOW — STRIPE VERIFICATION

The setup form at `/setup` currently has no verification that the person submitting it has actually paid. Fix this:

In `artifacts/api-server/src/routes/setup.ts`, the `POST /setup/:guildId/server` route must:

1. Accept an `email` field in the request body
2. Look up that email in the `customers` table
3. Check the `subscriptions` table — verify `status = 'active'` for this guild OR verify there is a customer with that email whose Stripe subscription is active
4. If no active subscription found → return `{ error: "No active subscription found for this email" }` with status 403
5. Only if verified → proceed to insert the server

Also add a `POST /setup/verify-email` route that accepts `{ email }` and returns `{ valid: true/false }` — used by the frontend to check before showing step 3.

---

## 4. COMPLETE THE WEBSITE PAGES

### `artifacts/api-server/src/public/setup.html`
The 3-step setup page must actually work end to end:

**Step 1:** 
- Show a "Have you purchased?" question
- If yes → show Step 2
- If no → show a "Buy Aviv Bot" button that calls `POST /api/stripe/checkout` with the selected plan and redirects to Stripe

**Step 2:**
- Show instructions for GPortal: "Go to your GPortal dashboard → Permissions → add `avivbot`"
- Show instructions for Nitrado: "Go to your Nitrado dashboard → Guest Access Rights → add `avivbot`"
- Show instructions for other hosts: "Enable WebRCON on your server. You will need your RCON IP, port, and password."
- Next button → Step 3

**Step 3:**
- Form fields:
  - Email address (used at purchase)
  - Discord server invite link
  - RCON Host/IP
  - RCON Port (default 28016)
  - RCON Password
- On submit:
  1. Call `POST /api/setup/verify-email` with email → if invalid, show error "No subscription found for this email"
  2. If valid, call `POST /api/setup/:guildId/server` — but we need the guildId. Get it by having the user connect with Discord OAuth first (see section 5), OR accept it as a text input labeled "Your Discord Server ID"
  3. On success → show "✅ Aviv Bot is being set up! It will join your Discord server shortly."

### `artifacts/api-server/src/public/pricing.html`
Must show 3 plan cards (Basic, Pro, Elite) with a Buy button on each. Each button calls `POST /api/stripe/checkout` with the correct planId. Add real placeholder prices (e.g. $9.99 / $19.99 / $34.99 per month).

### `artifacts/api-server/src/public/status.html`
Must call `GET /api/health` and show:
- Bot online/offline indicator (green/red dot)
- Number of connected servers
- Uptime

Add a `GET /api/health` route that returns `{ status: "ok", connectedServers: N, uptime: seconds }`.

---

## 5. ADD DISCORD OAUTH LOGIN

In `artifacts/api-server/src/routes/auth.ts`, implement Discord OAuth:

```
GET /auth/discord → redirects to Discord OAuth URL
GET /auth/callback → exchanges code for token, gets user info, stores in session, redirects to /dashboard
GET /auth/me → returns current logged-in user { id, username, avatar } or 401
GET /auth/logout → clears session
```

Use `express-session` for session storage. After login, store `{ discordUserId, discordUsername, discordAvatar, guilds }` in the session.

Required env vars (add to .env.example):
```
DISCORD_CLIENT_ID=
DISCORD_CLIENT_SECRET=
DISCORD_REDIRECT_URI=https://yourdomain.com/auth/callback
SESSION_SECRET=
```

---

## 6. BUILD THE DASHBOARD PAGE

`artifacts/api-server/src/public/dashboard.html` — customer logs in with Discord and sees:

- Their bot status per server (online/offline, player count)
- Quick toggle for main features (economy on/off, shop on/off, ZORP on/off, kill feed on/off)
- Link to manage shop items
- Link to manage kits
- View current RCON connection status
- Change RCON credentials button

The dashboard must call `GET /api/auth/me` first — if not logged in, redirect to `/auth/discord`. Then load their servers via `GET /api/setup/:guildId`.

---

## 7. ADD THE !CONSOLE PREFIX COMMANDS

In `lib/bot/src/events/messageCreate.ts`, add handling for prefix commands (not slash commands):

```
!console [command]   → send RCON to server 1
!console2 [command]  → send RCON to server 2
!console3 [command]  → send RCON to server 3
!consoles [command]  → send RCON to ALL servers
!say [message]       → send say [message] to server 1
!whois @mention      → look up linked in-game name for a Discord user
!whogot [ingamename] → look up which Discord user is linked to that name
!maxspend [amount]   → set daily shop spend limit for this server
```

For `!console` commands: require the user to have the `avivadmin` or `avivmod` role. Send the RCON command and reply in Discord with the server's response. If no response within 10 seconds, reply "No response from server."

---

## 8. COMPLETE THE ZORP EXPIRY TIMER

There is a features folder but no `zorp.ts` feature file. Create `lib/bot/src/features/zorp.ts`:

```typescript
// Run every 5 minutes
// 1. Query all zorp_zones where expires_at < NOW() → delete them, post to player-feed "zone expired"
// 2. Query all zorp_zones — for each zone, check if any team member is online
//    (use RCON: `playerlist` command → parse response for player names)
//    If all team members offline for longer than zorptime → update zone status to 'red'
//    If any team member online → update zone status to 'green'
// 3. Start this loop in bot/src/index.ts on ready
```

Also in the ready event, start all the feature loops:
- ZORP expiry check every 5 minutes
- Prison auto-release check every 1 minute (query prison table for release_at < NOW(), release them)
- SRP enforcement every 1 minute (check if current time is within any SRP window, apply/remove PvP setting)
- Player count voice channel update every 2 minutes

---

## 9. FIX THE PRISON AUTO-RELEASE AND KEEP-SENDING-BACK

In `lib/bot/src/features/` create `prison.ts`:

```typescript
// Every 1 minute:
// 1. Find all active prisoners where release_at < NOW()
//    → Remove from prison table (set active = 0)
//    → Try to DM them: "You have been released from prison"
//    → Post to logs channel

// The "keep sending back" logic is already in handleJoin (parser.ts)
// But it only triggers on join. Also add a periodic check:
// Every 30 seconds, for any active prisoner, send teleportpos to prison location
// This prevents them from escaping if they were already online when imprisoned
```

---

## 10. FIX THE PLAYER COUNT VOICE CHANNEL UPDATE

In `lib/bot/src/features/playercount.ts`, implement the update properly:

```typescript
// Every 2 minutes per server:
// 1. Send RCON command: `playerlist` → parse response to get count
// 2. Find the voice channel assigned to "player-count" feed for this server
// 3. Rename the channel to: `| Server ${serverNumber} ▶ 🌐 ${onlineCount} 🕐 ${queueCount}`
// Queue count: send RCON `server.queued` to get it
// If RCON is not connected, show 0 for both
```

---

## 11. ADD MISSING WIPE COMMANDS

Add these slash commands to `lib/bot/src/commands/registry.ts` and implement them:

```
/wipe-economy [server]  → set all economy balances to 0 for that server
/wipe-raidlink [server] → delete all raid_links rows for that server  
```

Both require `avivadmin` role. Post confirmation to logs channel.

---

## 12. FIX THE GUILDMEMBERUPDATE ROLE AUTOMATION

In `lib/bot/src/events/guildMemberUpdate.ts`, implement the full role automation:

When a member's roles change, check the added/removed roles against these patterns:

**Role added → add to list:**
- `vip-1` → add to `viplist` on server 1
- `vip-2` → add to `viplist` on server 2  
- `vip-all` → add to `viplist` on all servers
- `elitekit1-1` → add to `elitelist1` on server 1
- `elitekit2-1` → add to `elitelist2` on server 1
- (same pattern for elitekit1-44 and server numbers 1-3)
- `zorp-1` → add to `zorpallowlist` on server 1
- `recycler-1` → add to `recyclerlist` on server 1
- `tpn-1` → add to `tpnlist` on server 1
- `tpne-1`, `tpe-1`, `tpse-1`, `tps-1`, `tpsw-1`, `tpw-1`, `tpnw-1` → same pattern

**Role removed → remove from list** (same pattern in reverse)

To get the player's in-game name: look up their Discord user ID in the `players` table for this guild's servers. If not linked, do nothing.

---

## 13. ADD THE /AVIV PANEL COMMAND

The `/aviv` command currently just replies with a placeholder. Implement it as a proper Discord embed with buttons/select menus showing the main settings categories. When a category is selected, show the current values of those settings as an embed. Users with `avivadmin` role can then use `/set` to change individual values.

At minimum show these categories as buttons:
- Kits Settings
- Economy Settings  
- Shop Settings
- ZORP Settings
- Teleport Settings
- Kill Feed Settings
- Moderation Settings

Each button opens an ephemeral embed showing current config values for that category, with a note "Use /set [config_name] [value] to change any setting".

---

## 14. ADD MISSING ENV VARS TO .env.example

Add these to `.env.example`:
```
STRIPE_PRICE_BASIC=
STRIPE_PRICE_PRO=
STRIPE_PRICE_ENTERPRISE=
DISCORD_CLIENT_ID=
DISCORD_CLIENT_SECRET=
DISCORD_REDIRECT_URI=
SESSION_SECRET=
```

---

## 15. FIX THE BUILD — MAKE SURE EVERYTHING COMPILES

After all changes:
1. Run `pnpm install` from the root
2. Run `pnpm build` — fix any TypeScript errors
3. Make sure both the bot (`lib/bot`) and API server (`artifacts/api-server`) build without errors
4. Test that the bot logs in and registers slash commands successfully
5. Test that the API server starts and `/api/health` returns a valid response

---

## SUMMARY OF PRIORITY ORDER

Do these in this order:

1. Elite kit phrase mapping (section 1 + 2) — this is the core gameplay mechanic
2. !console prefix commands (section 7) — admins need this immediately
3. Role automation fix (section 12) — essential for VIP/kit access
4. ZORP expiry timer (section 8) — needs to run continuously
5. Prison auto-release (section 9)
6. Player count voice channel (section 10)
7. Wipe commands (section 11)
8. Stripe verification on setup (section 3)
9. Website setup page working end to end (section 4)
10. Discord OAuth + dashboard (sections 5 + 6)
11. /aviv panel (section 13)
12. Build fix + testing (section 15)
