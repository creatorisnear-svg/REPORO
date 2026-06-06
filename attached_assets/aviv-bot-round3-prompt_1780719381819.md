# AVIV BOT — Round 3 Fixes

Good progress on v2. Here is what still needs fixing. Work through each section completely.

---

## 1. CRITICAL: FIX THE "YES" / "RETREAT!" CONFLICT IN PARSER

In `lib/bot/src/rcon/parser.ts`, the conflict check for "Yes" only guards against ZORP but NOT against the elitekit two-step pending state. "Retreat!" has no conflict guard at all.

Fix the single-step kit dispatch block (around line 340) to handle ALL conflicts:

```typescript
const singleKit = singleStepKits[msg];
if (singleKit) {
  const inZorpFlow = zorpState && Date.now() - zorpState.timestamp < 30_000;
  const inTpHomeFlow = tpHomePending.has(`${serverId}:${playerName}`) &&
    Date.now() - tpHomePending.get(`${serverId}:${playerName}`)! < 120_000;
  const inEliteKitFlow = eliteKitPending.has(`${serverId}:${playerName}`) &&
    Date.now() - eliteKitPending.get(`${serverId}:${playerName}`)! < 30_000;

  // "Yes" conflicts with ZORP flow
  if (msg === "Yes" && inZorpFlow) return;

  // "Retreat!" conflicts with TPHOME flow
  if (msg === "Retreat!" && inTpHomeFlow) return;

  // If player is in two-step elite kit pending, any message should be handled
  // as a two-step kit, NOT a single-step kit
  if (inEliteKitFlow) return;

  await handleKit(serverId, playerName, singleKit);
  return;
}
```

Also fix the two-step kit block — it currently runs BEFORE the single-step check. The two-step block must check the pending map correctly and then clear it:

```typescript
const eliteKey = `${serverId}:${playerName}`;
if (eliteKitPending.has(eliteKey) && Date.now() - eliteKitPending.get(eliteKey)! < 30_000) {
  const twoStepKit = twoStepKits[msg];
  if (twoStepKit) {
    eliteKitPending.delete(eliteKey);
    await handleKit(serverId, playerName, twoStepKit);
    return;
  }
  // Message didn't match any two-step kit phrase — clear the pending state
  eliteKitPending.delete(eliteKey);
}
```

---

## 2. FIX THE KIT CONFIG KEY LOOKUP IN handleKit()

The current `handleKit()` function has the right comment but may not be building config keys correctly for kits numbered 2-22. Verify this exact logic is in place:

```typescript
async function handleKit(serverId: number, playerName: string, kitType: string): Promise<void> {
  // Config key prefix: "elitekit" for kit1, "elitekit2" for kit2, etc.
  const configPrefix = kitType; // e.g. "elitekit", "elitekit2", "freekit", "vipkit"

  const enabled = await getConfig(serverId, `${configPrefix}_use`) ?? "off";
  if (enabled !== "on") return;

  const cooldownHours = parseFloat(await getConfig(serverId, `${configPrefix}_time`) ?? "24");
  const kitDisplayName = await getConfig(serverId, `${configPrefix}_name`) ?? kitType;

  // Determine list name for elite kits
  // elitekit -> elitelist1, elitekit2 -> elitelist2, elitekit3 -> elitelist3, etc.
  const useList = await getConfig(serverId, `${configPrefix}_uselist`) ?? "off";
  if (useList === "on") {
    let listName: string;
    if (kitType === "elitekit") {
      listName = "elitelist1";
    } else if (kitType.startsWith("elitekit")) {
      const num = kitType.replace("elitekit", "");
      listName = `elitelist${num}`;
    } else if (kitType === "vipkit") {
      listName = "viplist";
    } else {
      listName = `${kitType}list`;
    }
    const onList = await db.isOnList(serverId, listName, playerName);
    if (!onList) return;
  }

  // Check cooldown
  const lastClaim = await db.getLastKitClaim(serverId, playerName, kitType);
  if (lastClaim) {
    const cooldownMs = cooldownHours * 3600 * 1000;
    if (Date.now() - new Date(lastClaim.last_claimed).getTime() < cooldownMs) return;
  }

  const server = await getServerInfo(serverId);
  if (!server?.rcon_host) return;

  try {
    await rconManager.sendCommand(
      serverId, server.rcon_host, server.rcon_port!, server.rcon_password!,
      `giveto ${playerName} ${kitDisplayName}`
    );
    await db.recordKitClaim(serverId, playerName, kitType);
  } catch (err) {
    await postToChannel(serverId, "errors", `Kit error for **${playerName}** (${kitType}): ${String(err)}`);
  }
}
```

---

## 3. FIX THE ZORP STATUS — ADD YELLOW STATE

The current ZORP expiry check only sets "green" or "red". It's missing the "yellow" state (team offline but not long enough yet). Fix `lib/bot/src/features/zorp.ts`:

```typescript
// In the status check block, replace the binary green/red with:
const zorpTimeStr = await db.getConfig(server.id, "zorptime") ?? "30";
const zorpTimeMs = parseFloat(zorpTimeStr) * 60 * 1000;

// Check last time ANY team member was online
// For simplicity, use the zone's own last-seen timestamp
// If online → green
// If offline < zorptime → yellow  
// If offline >= zorptime → red
let newStatus: string;
if (online) {
  newStatus = "green";
  await db.updateZorpLastSeen(server.id, zone.ingame_name, new Date().toISOString());
} else {
  const lastSeen = zone.last_seen_at ? new Date(zone.last_seen_at).getTime() : 0;
  const offlineMs = Date.now() - lastSeen;
  newStatus = offlineMs >= zorpTimeMs ? "red" : "yellow";
}
if (zone.status !== newStatus) {
  await db.updateZorpStatus(server.id, zone.ingame_name, newStatus).catch(() => null);
}
```

Also add `last_seen_at DATETIME` column to the `zorp_zones` table in `lib/db/src/schema/index.ts` and add `updateZorpLastSeen` to `lib/db/src/index.ts`.

---

## 4. ADD THE /AVIV PANEL COMMAND

In `lib/bot/src/commands/handlers/setup.ts`, the `handleAviv` function needs to be a real interactive settings panel. Replace the placeholder with:

```typescript
export async function handleAviv(interaction: ChatInputCommandInteraction): Promise<void> {
  if (!await requireRole(interaction, "avivadmin")) return;
  const server = await getServerForInteraction(interaction);
  if (!server) return;

  const { ActionRowBuilder, ButtonBuilder, ButtonStyle, EmbedBuilder } = await import("discord.js");

  const embed = new EmbedBuilder()
    .setTitle("⚡ Aviv Bot Settings Panel")
    .setDescription("Select a category to view current settings. Use `/set [config] [value]` to change any setting.")
    .setColor(0x00d4aa)
    .addFields(
      { name: "Server", value: server.server_label ?? `Server ${server.server_number}`, inline: true },
      { name: "RCON", value: server.rcon_host ? "✅ Configured" : "❌ Not set", inline: true }
    );

  const row1 = new ActionRowBuilder<ButtonBuilder>().addComponents(
    new ButtonBuilder().setCustomId("aviv_kits").setLabel("🎁 Kits").setStyle(ButtonStyle.Secondary),
    new ButtonBuilder().setCustomId("aviv_economy").setLabel("💰 Economy").setStyle(ButtonStyle.Secondary),
    new ButtonBuilder().setCustomId("aviv_shop").setLabel("🛒 Shop").setStyle(ButtonStyle.Secondary),
    new ButtonBuilder().setCustomId("aviv_zorp").setLabel("🛡️ ZORP").setStyle(ButtonStyle.Secondary),
  );

  const row2 = new ActionRowBuilder<ButtonBuilder>().addComponents(
    new ButtonBuilder().setCustomId("aviv_teleports").setLabel("🌀 Teleports").setStyle(ButtonStyle.Secondary),
    new ButtonBuilder().setCustomId("aviv_killfeed").setLabel("⚔️ Kill Feed").setStyle(ButtonStyle.Secondary),
    new ButtonBuilder().setCustomId("aviv_moderation").setLabel("🔨 Moderation").setStyle(ButtonStyle.Secondary),
    new ButtonBuilder().setCustomId("aviv_misc").setLabel("⚙️ Other").setStyle(ButtonStyle.Secondary),
  );

  await interaction.reply({ embeds: [embed], components: [row1, row2], ephemeral: true });
}
```

Then in `lib/bot/src/events/interactionCreate.ts`, add handling for these button interactions. When a button like `aviv_kits` is clicked, fetch the relevant configs from DB and show them in a new embed. Example for kits:

```typescript
if (interaction.isButton() && interaction.customId.startsWith("aviv_")) {
  const category = interaction.customId.replace("aviv_", "");
  const server = await getServerForInteraction(interaction as any);
  if (!server) return;

  const configMap: Record<string, string[]> = {
    kits: ["freekit_use","freekit_time","freekit_name","vipkit_use","vipkit_time","vipkit_name","elitekit_use","elitekit_time"],
    economy: ["currency_name","player_kill_points","scientist_kill_points","daily_min","daily_max","BountySystem","BountyReward"],
    shop: ["shop_max_daily_spend"],
    zorp: ["zorp","zorptime","zorpExpiryTime","zorpallowlist"],
    teleports: ["TPN_use","TPN_time","TPNE_use","TPE_use","TPSE_use","TPS_use","TPSW_use","TPW_use","TPNW_use","TPHOME_use","combatlock_use","combatlock_time"],
    killfeed: ["KillFeedDiscord","KillFeedGame","KillFeedKD","MiscKills","ScientistKiller","ScientistVictim","killercolor","victimcolor","killphrase"],
    moderation: ["notemessaging"],
    misc: ["chatbridge","scheduler","scheduler-time","raidalerts","SRP"],
  };

  const keys = configMap[category] ?? [];
  const lines: string[] = [];
  for (const key of keys) {
    const val = await db.getConfig(server.id, key) ?? "*(not set)*";
    lines.push(`**${key}**: ${val}`);
  }

  const embed = new EmbedBuilder()
    .setTitle(`⚡ ${category.charAt(0).toUpperCase() + category.slice(1)} Settings`)
    .setDescription(lines.join("\n") || "No settings found.")
    .setColor(0x00d4aa)
    .setFooter({ text: "Use /set [config] [value] to change any setting" });

  await interaction.update({ embeds: [embed], components: [] });
}
```

---

## 5. ADD MISSING /WIPE-ECONOMY AND /WIPE-RAIDLINK COMMANDS

Add to `lib/bot/src/commands/registry.ts`:

```typescript
{
  data: serverOption(new SlashCommandBuilder()
    .setName("wipe-economy")
    .setDescription("Reset all player coin balances to 0 (admin only - use on wipe day)") as SlashCommandBuilder),
  execute: handleWipeEconomy,
},
{
  data: serverOption(new SlashCommandBuilder()
    .setName("wipe-raidlink")
    .setDescription("Clear all raid frequency registrations (admin only - use on wipe day)") as SlashCommandBuilder),
  execute: handleWipeRaidlink,  // already exists in raidalerts handler
},
```

Add `handleWipeEconomy` to `lib/bot/src/commands/handlers/economy.ts`:

```typescript
export async function handleWipeEconomy(interaction: ChatInputCommandInteraction): Promise<void> {
  if (!await requireRole(interaction, "avivadmin")) return;
  const server = await getServerForInteraction(interaction);
  if (!server) return;
  await interaction.deferReply({ ephemeral: true });
  await db.wipeEconomy(server.id);
  await interaction.editReply({ content: `✅ All economy balances wiped for Server ${server.server_number}.` });
}
```

Add `wipeEconomy` to `lib/db/src/index.ts`:
```typescript
export async function wipeEconomy(serverId: number): Promise<void> {
  await dbClient.execute({
    sql: "UPDATE economy SET balance = 0 WHERE server_id = ?",
    args: [serverId]
  });
}
```

---

## 6. FIX THE APP.TS TO INCLUDE SESSION MIDDLEWARE

The auth routes use `req.session` but `app.ts` may not have session middleware configured. In `artifacts/api-server/src/app.ts`, make sure these are added:

```typescript
import session from "express-session";

app.use(session({
  secret: process.env["SESSION_SECRET"] ?? "aviv-dev-secret-change-in-prod",
  resave: false,
  saveUninitialized: false,
  cookie: {
    secure: process.env["NODE_ENV"] === "production",
    maxAge: 7 * 24 * 60 * 60 * 1000, // 7 days
  }
}));
```

Install the package: add `"express-session": "^1.17.3"` and `"@types/express-session": "^1.17.10"` to `artifacts/api-server/package.json` dependencies.

---

## 7. FIX THE DASHBOARD HTML — WIRE UP THE API CALLS

The dashboard HTML loads but the JavaScript needs to actually call the real API endpoints. In `artifacts/api-server/src/public/dashboard.html`, make sure the script section:

1. On page load, calls `GET /auth/me` — if 401, redirect to `/auth/discord`
2. Populates the guild dropdown with the user's guilds that have an active Aviv Bot subscription (call `GET /api/stripe/status/:guildId` for each guild)
3. When a guild is selected, calls `GET /api/setup/:guildId` to load servers
4. Renders each server as a card showing: server label, RCON host (masked), connection status
5. The "Add Another Server" link goes to `/setup-wizard`

The full JavaScript block should look like this:

```javascript
async function init() {
  try {
    const me = await fetch('/auth/me').then(r => r.ok ? r.json() : null);
    if (!me) { window.location.href = '/auth/discord'; return; }

    document.getElementById('user-name').textContent = me.username;
    if (me.avatar) {
      document.getElementById('user-avatar').src =
        `https://cdn.discordapp.com/avatars/${me.id}/${me.avatar}.png?size=64`;
    }

    const select = document.getElementById('guild-select');
    for (const guild of (me.guilds || [])) {
      const status = await fetch(`/api/stripe/status/${guild.id}`).then(r => r.json()).catch(() => ({ active: false }));
      if (status.active) {
        const opt = document.createElement('option');
        opt.value = guild.id;
        opt.textContent = guild.name;
        select.appendChild(opt);
      }
    }

    document.getElementById('loading').style.display = 'none';
    document.getElementById('dash-content').style.display = 'block';
  } catch (e) {
    document.getElementById('loading').style.display = 'none';
    document.getElementById('error-msg').style.display = 'block';
  }
}

async function loadGuildDashboard(guildId) {
  if (!guildId) return;
  const data = await fetch(`/api/setup/${guildId}`).then(r => r.json());
  const grid = document.getElementById('servers-grid');
  grid.innerHTML = '';
  for (const server of (data.servers || [])) {
    grid.innerHTML += `
      <div class="server-card">
        <h3>${server.server_label || 'Server ' + server.server_number}</h3>
        <div class="server-meta">Host: ${server.rcon_host ? server.rcon_host.replace(/./g, (c,i) => i > 4 ? '*' : c) : 'Not configured'}</div>
        <div class="stat-row">
          <div class="stat"><div class="val">—</div><div class="lbl">Players</div></div>
        </div>
        <span class="rcon-badge ${server.rcon_host ? 'on' : 'off'}">${server.rcon_host ? 'RCON Set' : 'No RCON'}</span>
      </div>`;
  }
  document.getElementById('guild-dash').style.display = 'block';
}

init();
```

---

## 8. ADD MISSING DB FUNCTIONS

Several DB functions are called in the code but may not exist in `lib/db/src/index.ts`. Make sure ALL of these are implemented:

- `getConfig(serverId, key)` → `SELECT config_value FROM configs WHERE server_id=? AND config_key=?`
- `setConfig(serverId, key, value)` → `INSERT OR REPLACE INTO configs ...`
- `getAllZorpZones(serverId)` → `SELECT * FROM zorp_zones WHERE server_id=?`
- `updateZorpStatus(serverId, ingameName, status)` → `UPDATE zorp_zones SET status=? WHERE server_id=? AND ingame_name=?`
- `updateZorpLastSeen(serverId, ingameName, timestamp)` → `UPDATE zorp_zones SET last_seen_at=? WHERE server_id=? AND ingame_name=?`
- `getDuePrisoners(serverId)` → `SELECT * FROM prison WHERE server_id=? AND active=1 AND release_at < datetime('now')`
- `getActivePrisoners(serverId)` → `SELECT * FROM prison WHERE server_id=? AND active=1`
- `releasePrisoner(serverId, ingameName)` → `UPDATE prison SET active=0 WHERE server_id=? AND ingame_name=?`
- `isPrisoner(serverId, ingameName)` → `SELECT 1 FROM prison WHERE server_id=? AND ingame_name=? AND active=1`
- `getZorpZone(serverId, ingameName)` → `SELECT * FROM zorp_zones WHERE server_id=? AND ingame_name=?`
- `upsertZorpZone(serverId, ingameName, teamId, zoneId)` → INSERT OR REPLACE
- `deleteZorpZone(serverId, ingameName)` → DELETE
- `getBounty(serverId, targetName)` → `SELECT * FROM bounties WHERE server_id=? AND target_name=? AND active=1`
- `upsertBounty(serverId, targetName, killCount, reward)` → INSERT OR REPLACE
- `deactivateBounty(serverId, targetName)` → `UPDATE bounties SET active=0 WHERE server_id=? AND target_name=?`
- `getRaidLinkByFrequency(serverId, frequency)` → `SELECT * FROM raid_links WHERE server_id=? AND frequency=?`
- `getTpPositions(serverId, positionType)` → `SELECT * FROM tp_positions WHERE server_id=? AND position_type=?`
- `setTpHomePending(serverId, ingameName)` → `INSERT OR REPLACE INTO tp_homes (server_id, ingame_name, home_set) VALUES (?,?,0)`
- `confirmTpHome(serverId, ingameName)` → `UPDATE tp_homes SET home_set=1, set_at=datetime('now') WHERE server_id=? AND ingame_name=?`
- `getTpHome(serverId, ingameName)` → `SELECT * FROM tp_homes WHERE server_id=? AND ingame_name=?`
- `ensureEconomy(serverId, ingameName)` → `INSERT OR IGNORE INTO economy (server_id, ingame_name) VALUES (?,?)`
- `updateBalance(serverId, ingameName, delta)` → `UPDATE economy SET balance = balance + ? WHERE server_id=? AND ingame_name=?`
- `getBalance(serverId, ingameName)` → `SELECT balance FROM economy WHERE server_id=? AND ingame_name=?`
- `getLeaderboard(serverId, limit)` → `SELECT ingame_name, balance FROM economy WHERE server_id=? ORDER BY balance DESC LIMIT ?`
- `wipeEconomy(serverId)` → `UPDATE economy SET balance=0 WHERE server_id=?`
- `isOnList(serverId, listName, ingameName)` → `SELECT 1 FROM lists WHERE server_id=? AND list_name=? AND ingame_name=?`
- `addToList(serverId, listName, ingameName)` → INSERT OR IGNORE
- `removeFromList(serverId, listName, ingameName)` → DELETE
- `getList(serverId, listName)` → SELECT all
- `getLastKitClaim(serverId, ingameName, kitName)` → SELECT
- `recordKitClaim(serverId, ingameName, kitName)` → INSERT OR REPLACE with current timestamp
- `getPlayerByDiscord(serverId, discordUserId)` → SELECT
- `getPlayerByIngameName(serverId, ingameName)` → SELECT
- `getServersByGuild(guildId)` → SELECT all servers for guild
- `getServerById(serverId)` → SELECT
- `getChannel(serverId, channelType)` → returns discord_channel_id string or null
- `setChannel(serverId, channelType, channelId)` → INSERT OR REPLACE
- `getSubscriptionByGuild(guildId)` → SELECT from subscriptions
- `upsertSubscription(guildId, userId, plan, subId, status)` → INSERT OR REPLACE
- `cancelSubscription(stripeSubId)` → UPDATE status='cancelled'
- `getCustomerByEmail(email)` → SELECT
- `upsertCustomer(email, stripeId, plan)` → INSERT OR REPLACE
- `insertServer(data)` → INSERT, returns new id

If any of these are missing, add them. Each should use parameterized queries with `?` placeholders.

---

## 9. RUN THE BUILD AND FIX ALL TYPESCRIPT ERRORS

After all the above changes:

1. Run `pnpm install` from the root to ensure `express-session` and `@types/express-session` are installed
2. Run `pnpm build` or `pnpm -r build` to build all packages
3. Fix every TypeScript error that appears — do not leave any `any` types that cause build failures
4. Specifically check:
   - All imported DB functions exist in `lib/db/src/index.ts`
   - All exported types from `lib/db/src/index.ts` match what bot code imports (`ServerRow`, `ZorpZoneRow`, `PrisonRow`, `TpPositionRow`)
   - The `interactionCreate` handler handles both slash command interactions AND button interactions
   - `express-session` types are augmenting the Express `Request` type properly

5. After a clean build, test that the bot starts without crashing by checking startup logs

---

## SUMMARY — WHAT THIS FIXES

- "Yes" / "Retreat!" now correctly prioritize ZORP/TPHOME over kit triggers
- Two-step kit pending state is properly cleared after use
- Kit config key lookup works correctly for all 44 elite kits
- ZORP now has proper yellow state (offline but not long enough)
- `/aviv` panel is a real interactive settings panel with category buttons
- `/wipe-economy` and `/wipe-raidlink` commands added
- Dashboard page properly calls auth and loads guild data
- Session middleware is properly configured
- All DB helper functions are implemented
- Full clean TypeScript build
