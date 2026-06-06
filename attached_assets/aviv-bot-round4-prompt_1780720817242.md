# AVIV BOT — Round 4 Final Fixes

This is the final consolidated instruction. Work through every section completely and in order. Do not skip anything.

---

## 1. FIX THE PARSER — "YES" / "RETREAT!" CONFLICT (CRITICAL)

In `lib/bot/src/rcon/parser.ts`, the single-step kit dispatch block must check ALL conflict states before firing. Replace the current single-step kit block with this exact code:

```typescript
const singleKit = singleStepKits[msg];
if (singleKit) {
  const inZorpFlow = zorpState && Date.now() - zorpState.timestamp < 30_000;
  const inTpHomeFlow = tpHomePending.has(`${serverId}:${playerName}`) &&
    Date.now() - tpHomePending.get(`${serverId}:${playerName}`)! < 120_000;
  const inEliteKitFlow = eliteKitPending.has(`${serverId}:${playerName}`) &&
    Date.now() - eliteKitPending.get(`${serverId}:${playerName}`)! < 30_000;

  // "Yes" is used for ZORP confirmation — skip kit if in ZORP flow
  if (msg === "Yes" && inZorpFlow) return;

  // "Retreat!" is used for TP HOME — skip kit if in TP HOME flow
  if (msg === "Retreat!" && inTpHomeFlow) return;

  // Any phrase in the two-step pending state must be handled as two-step, not single-step
  if (inEliteKitFlow) return;

  await handleKit(serverId, playerName, singleKit);
  return;
}
```

Also make sure the two-step elite kit block runs BEFORE the single-step block and correctly clears state:

```typescript
const eliteKey = `${serverId}:${playerName}`;
if (eliteKitPending.has(eliteKey) && Date.now() - eliteKitPending.get(eliteKey)! < 30_000) {
  const twoStepKit = twoStepKits[msg];
  if (twoStepKit) {
    eliteKitPending.delete(eliteKey);
    await handleKit(serverId, playerName, twoStepKit);
    return;
  }
  // Message didn't match — clear pending state
  eliteKitPending.delete(eliteKey);
}
```

---

## 2. FIX handleKit() — VIP LIST CHECK

In `handleKit()` in `parser.ts`, the vipkit list check is missing. Make sure the uselist block includes this case:

```typescript
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
```

---

## 3. ADD ALL MISSING DB FUNCTIONS

Open `lib/db/src/index.ts`. Check each function below. If it is missing or incomplete, add it. Use parameterized queries with `?` placeholders throughout.

```typescript
// Servers
export async function getServersByGuild(guildId: string): Promise<ServerRow[]>
export async function getServerById(serverId: number): Promise<ServerRow | null>
export async function insertServer(data: { customer_id: number; discord_guild_id: string; rcon_host: string; rcon_port: number; rcon_password: string; server_label: string; server_number: number }): Promise<number>

// Players
export async function getPlayerByDiscord(serverId: number, discordUserId: string): Promise<PlayerRow | null>
export async function getPlayerByIngameName(serverId: number, ingameName: string): Promise<PlayerRow | null>
export async function linkPlayer(serverId: number, discordUserId: string, ingameName: string): Promise<void>
export async function unlinkPlayer(serverId: number, discordUserId: string): Promise<void>

// Economy
export async function ensureEconomy(serverId: number, ingameName: string): Promise<void>
export async function updateBalance(serverId: number, ingameName: string, delta: number): Promise<void>
export async function getBalance(serverId: number, ingameName: string): Promise<number>
export async function getLeaderboard(serverId: number, limit: number): Promise<EconomyRow[]>
export async function wipeEconomy(serverId: number): Promise<void>
export async function getLastDaily(serverId: number, ingameName: string): Promise<string | null>
export async function setLastDaily(serverId: number, ingameName: string, timestamp: string): Promise<void>

// Lists
export async function isOnList(serverId: number, listName: string, ingameName: string): Promise<boolean>
export async function addToList(serverId: number, listName: string, ingameName: string): Promise<void>
export async function removeFromList(serverId: number, listName: string, ingameName: string): Promise<void>
export async function getList(serverId: number, listName: string): Promise<ListRow[]>

// Kits
export async function getLastKitClaim(serverId: number, ingameName: string, kitName: string): Promise<KitClaimRow | null>
export async function recordKitClaim(serverId: number, ingameName: string, kitName: string): Promise<void>

// Configs
export async function getConfig(serverId: number, key: string): Promise<string | null>
export async function setConfig(serverId: number, key: string, value: string): Promise<void>
export async function getAllConfigs(serverId: number): Promise<ConfigRow[]>

// Channels
export async function getChannel(serverId: number, channelType: string): Promise<string | null>
export async function setChannel(serverId: number, channelType: string, channelId: string): Promise<void>

// ZORP
export async function getZorpZone(serverId: number, ingameName: string): Promise<ZorpZoneRow | null>
export async function getAllZorpZones(serverId: number): Promise<ZorpZoneRow[]>
export async function upsertZorpZone(serverId: number, ingameName: string, teamId: string, zoneId: string): Promise<void>
export async function deleteZorpZone(serverId: number, ingameName: string): Promise<void>
export async function updateZorpStatus(serverId: number, ingameName: string, status: string): Promise<void>
export async function updateZorpLastSeen(serverId: number, ingameName: string, timestamp: string): Promise<void>
export async function wipeZorp(serverId: number): Promise<void>

// Prison
export async function isPrisoner(serverId: number, ingameName: string): Promise<boolean>
export async function getDuePrisoners(serverId: number): Promise<PrisonRow[]>
export async function getActivePrisoners(serverId: number): Promise<PrisonRow[]>
export async function releasePrisoner(serverId: number, ingameName: string): Promise<void>
export async function addPrisoner(serverId: number, ingameName: string, reason: string, releaseAt: string): Promise<void>

// TP Positions
export async function getTpPositions(serverId: number, positionType: string): Promise<TpPositionRow[]>
export async function addTpPosition(serverId: number, positionType: string, x: number, y: number, z: number, label?: string): Promise<void>
export async function clearTpPositions(serverId: number, positionType: string): Promise<void>

// TP Home
export async function getTpHome(serverId: number, ingameName: string): Promise<{ home_set: number; set_at: string | null } | null>
export async function setTpHomePending(serverId: number, ingameName: string): Promise<void>
export async function confirmTpHome(serverId: number, ingameName: string): Promise<void>

// Bounties
export async function getBounty(serverId: number, targetName: string): Promise<BountyRow | null>
export async function upsertBounty(serverId: number, targetName: string, killCount: number, reward: number): Promise<void>
export async function deactivateBounty(serverId: number, targetName: string): Promise<void>

// Warnings
export async function addWarning(serverId: number, ingameName: string, reason: string): Promise<void>
export async function getWarnings(serverId: number, ingameName: string): Promise<WarningRow[]>

// Raid Links
export async function getRaidLinkByFrequency(serverId: number, frequency: string): Promise<RaidLinkRow | null>
export async function addRaidLink(serverId: number, ingameName: string, frequency: string, discordUserId: string): Promise<void>
export async function removeRaidLink(serverId: number, discordUserId: string): Promise<void>
export async function wipeRaidLinks(serverId: number): Promise<void>

// Scheduler
export async function getSchedulerMessages(serverId: number): Promise<SchedulerRow[]>
export async function addSchedulerMessage(serverId: number, message: string, intervalMinutes: number): Promise<void>
export async function removeSchedulerMessage(serverId: number, id: number): Promise<void>
export async function updateSchedulerLastSent(serverId: number, id: number, timestamp: string): Promise<void>

// Shop
export async function getShopCategories(serverId: number): Promise<ShopCategoryRow[]>
export async function getShopProducts(categoryId: number): Promise<ShopProductRow[]>
export async function getShopProductById(productId: number): Promise<ShopProductRow | null>
export async function getLastShopPurchase(serverId: number, ingameName: string, productId: number): Promise<{ purchased_at: string } | null>
export async function recordShopPurchase(serverId: number, ingameName: string, productId: number): Promise<void>

// Subscriptions
export async function getSubscriptionByGuild(guildId: string): Promise<{ plan: string; status: string; stripe_subscription_id: string } | null>
export async function upsertSubscription(guildId: string, discordUserId: string, plan: string, stripeSubId: string, status: string): Promise<void>
export async function cancelSubscription(stripeSubId: string): Promise<void>
```

For each function, the SQL should be a straightforward SELECT/INSERT/UPDATE/DELETE with parameterized args. Use `INSERT OR IGNORE` for add operations and `INSERT OR REPLACE` for upserts.

---

## 4. ADD SESSION MIDDLEWARE TO API SERVER

In `artifacts/api-server/src/app.ts`, add session support. First add the import at the top:

```typescript
import session from "express-session";
```

Then add the middleware before your routes:

```typescript
app.use(session({
  secret: process.env["SESSION_SECRET"] ?? "aviv-dev-secret-change-in-prod",
  resave: false,
  saveUninitialized: false,
  cookie: {
    secure: process.env["NODE_ENV"] === "production",
    maxAge: 7 * 24 * 60 * 60 * 1000,
  }
}));
```

In `artifacts/api-server/package.json`, add to dependencies:
```json
"express-session": "^1.17.3",
"@types/express-session": "^1.17.10"
```

---

## 5. IMPLEMENT DISCORD OAUTH IN AUTH ROUTES

Replace `artifacts/api-server/src/routes/auth.ts` with a full implementation:

```typescript
import { Router } from "express";
import * as db from "@workspace/db";

const router = Router();

const DISCORD_CLIENT_ID = process.env["DISCORD_CLIENT_ID"] ?? "";
const DISCORD_CLIENT_SECRET = process.env["DISCORD_CLIENT_SECRET"] ?? "";
const DISCORD_REDIRECT_URI = process.env["DISCORD_REDIRECT_URI"] ?? "http://localhost:3000/auth/callback";

// GET /auth/discord → redirect to Discord OAuth
router.get("/discord", (_req, res) => {
  const params = new URLSearchParams({
    client_id: DISCORD_CLIENT_ID,
    redirect_uri: DISCORD_REDIRECT_URI,
    response_type: "code",
    scope: "identify guilds",
  });
  res.redirect(`https://discord.com/api/oauth2/authorize?${params}`);
});

// GET /auth/callback → exchange code, store in session
router.get("/callback", async (req, res) => {
  const code = req.query["code"] as string;
  if (!code) { res.redirect("/?error=no_code"); return; }

  try {
    // Exchange code for token
    const tokenRes = await fetch("https://discord.com/api/oauth2/token", {
      method: "POST",
      headers: { "Content-Type": "application/x-www-form-urlencoded" },
      body: new URLSearchParams({
        client_id: DISCORD_CLIENT_ID,
        client_secret: DISCORD_CLIENT_SECRET,
        grant_type: "authorization_code",
        code,
        redirect_uri: DISCORD_REDIRECT_URI,
      }),
    });
    const tokenData = await tokenRes.json() as { access_token: string };

    // Get user info
    const userRes = await fetch("https://discord.com/api/users/@me", {
      headers: { Authorization: `Bearer ${tokenData.access_token}` },
    });
    const user = await userRes.json() as { id: string; username: string; avatar: string };

    // Get guilds
    const guildsRes = await fetch("https://discord.com/api/users/@me/guilds", {
      headers: { Authorization: `Bearer ${tokenData.access_token}` },
    });
    const guilds = await guildsRes.json() as { id: string; name: string; owner: boolean }[];

    (req.session as any).user = {
      id: user.id,
      username: user.username,
      avatar: user.avatar,
      guilds,
    };

    res.redirect("/dashboard");
  } catch {
    res.redirect("/?error=auth_failed");
  }
});

// GET /auth/me → return current session user or 401
router.get("/me", (req, res) => {
  const user = (req.session as any).user;
  if (!user) { res.status(401).json({ error: "Not authenticated" }); return; }
  res.json(user);
});

// GET /auth/logout → clear session
router.get("/logout", (req, res) => {
  req.session.destroy(() => {
    res.redirect("/");
  });
});

export default router;
```

---

## 6. IMPLEMENT THE /AVIV PANEL COMMAND

In `lib/bot/src/commands/handlers/setup.ts`, replace the `handleAviv` placeholder with:

```typescript
export async function handleAviv(interaction: ChatInputCommandInteraction): Promise<void> {
  if (!await requireRole(interaction, "avivadmin")) return;
  const server = await getServerForInteraction(interaction);
  if (!server) return;

  const embed = new EmbedBuilder()
    .setTitle("⚡ Aviv Bot Settings Panel")
    .setDescription("Select a category to view current settings.\nUse `/set [config] [value]` to change any setting.")
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

---

## 7. ADD AVIV BUTTON HANDLER IN interactionCreate.ts

In `lib/bot/src/events/interactionCreate.ts`, add button handling for the `/aviv` panel. After the slash command handler block, add:

```typescript
if (interaction.isButton() && interaction.customId.startsWith("aviv_")) {
  const category = interaction.customId.replace("aviv_", "");
  const servers = await db.getServersByGuild(interaction.guildId ?? "").catch(() => []);
  const server = servers[0];
  if (!server) { await interaction.update({ content: "No server configured.", components: [] }); return; }

  const configMap: Record<string, string[]> = {
    kits: ["FREEkit", "FREEkit-time", "FREEkit-name", "VIPkit", "VIPkit-time", "VIPkit-name", "elitekit_use", "elitekit_time"],
    economy: ["currency_name", "player_kill_points", "scientist_kill_points", "daily_min", "daily_max", "BountySystem", "BountyReward", "BountyMinKills", "BountyScale"],
    shop: ["shop_max_daily_spend", "shop-universal"],
    zorp: ["zorp", "zorptime", "zorpExpiryTime", "zorpallowlist"],
    teleports: ["TPN_use", "TPN_time", "TPNE_use", "TPE_use", "TPSE_use", "TPS_use", "TPSW_use", "TPW_use", "TPNW_use", "TPHOME_use", "combatlock_use", "combatlock_time"],
    killfeed: ["KillFeedDiscord", "KillFeedGame", "KillFeedKD", "MiscKills", "ScientistKiller", "ScientistVictim", "killercolor", "victimcolor", "phrasecolor", "killphrase", "killphraserandomizer"],
    moderation: ["notemessaging"],
    misc: ["chatbridge", "scheduler", "scheduler-time", "SRP", "recyclers_use"],
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
  return;
}
```

Make sure `db` and `EmbedBuilder` are imported at the top of `interactionCreate.ts`.

---

## 8. ADD /WIPE-ECONOMY AND /WIPE-RAIDLINK COMMANDS

In `lib/bot/src/commands/handlers/economy.ts`, add:

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

In `lib/bot/src/commands/handlers/raidalerts.ts`, add:

```typescript
export async function handleWipeRaidlink(interaction: ChatInputCommandInteraction): Promise<void> {
  if (!await requireRole(interaction, "avivadmin")) return;
  const server = await getServerForInteraction(interaction);
  if (!server) return;
  await interaction.deferReply({ ephemeral: true });
  await db.wipeRaidLinks(server.id);
  await interaction.editReply({ content: `✅ All raid frequency registrations wiped for Server ${server.server_number}.` });
}
```

In `lib/bot/src/commands/registry.ts`, add both commands to the array:

```typescript
{
  data: serverOption(new SlashCommandBuilder()
    .setName("wipe-economy")
    .setDescription("Reset all player coin balances to 0 — use on wipe day (avivadmin only)") as SlashCommandBuilder),
  execute: handleWipeEconomy,
},
{
  data: serverOption(new SlashCommandBuilder()
    .setName("wipe-raidlink")
    .setDescription("Clear all raid frequency registrations — use on wipe day (avivadmin only)") as SlashCommandBuilder),
  execute: handleWipeRaidlink,
},
```

Import `handleWipeEconomy` from economy handler and `handleWipeRaidlink` from raidalerts handler.

---

## 9. ADD /WIPE-ZORP COMMAND

In `lib/bot/src/commands/handlers/zorp.ts`, add:

```typescript
export async function handleWipeZorp(interaction: ChatInputCommandInteraction): Promise<void> {
  if (!await requireRole(interaction, "avivadmin")) return;
  const server = await getServerForInteraction(interaction);
  if (!server) return;
  await interaction.deferReply({ ephemeral: true });
  await db.wipeZorp(server.id);
  await interaction.editReply({ content: `✅ All ZORP zones wiped for Server ${server.server_number}.` });
}
```

Add to `registry.ts`:

```typescript
{
  data: serverOption(new SlashCommandBuilder()
    .setName("wipe-zorp")
    .setDescription("Delete all ZORP zones — use on wipe day (avivadmin only)") as SlashCommandBuilder),
  execute: handleWipeZorp,
},
```

---

## 10. ADD /SETDAILYSCALE AND /KILLPOINTS COMMANDS

In `lib/bot/src/commands/handlers/economy.ts`, add:

```typescript
export async function handleSetDailyScale(interaction: ChatInputCommandInteraction): Promise<void> {
  if (!await requireRole(interaction, "avivadmin")) return;
  const server = await getServerForInteraction(interaction);
  if (!server) return;
  const min = interaction.options.getInteger("min", true);
  const max = interaction.options.getInteger("max", true);
  await db.setConfig(server.id, "daily_min", String(min));
  await db.setConfig(server.id, "daily_max", String(max));
  await interaction.reply({ content: `✅ Daily reward set to ${min}–${max}.`, ephemeral: true });
}

export async function handleKillPoints(interaction: ChatInputCommandInteraction): Promise<void> {
  if (!await requireRole(interaction, "avivadmin")) return;
  const server = await getServerForInteraction(interaction);
  if (!server) return;
  const type = interaction.options.getString("type", true); // "player" or "scientist"
  const amount = interaction.options.getInteger("amount", true);
  const key = type === "scientist" ? "scientist_kill_points" : "player_kill_points";
  await db.setConfig(server.id, key, String(amount));
  await interaction.reply({ content: `✅ ${type === "scientist" ? "Scientist" : "Player"} kill points set to ${amount}.`, ephemeral: true });
}
```

Add to `registry.ts`:

```typescript
{
  data: serverOption(new SlashCommandBuilder()
    .setName("setdailyscale")
    .setDescription("Set the min and max daily currency reward")
    .addIntegerOption(o => o.setName("min").setDescription("Minimum reward").setRequired(true))
    .addIntegerOption(o => o.setName("max").setDescription("Maximum reward").setRequired(true)) as SlashCommandBuilder),
  execute: handleSetDailyScale,
},
{
  data: serverOption(new SlashCommandBuilder()
    .setName("killpoints")
    .setDescription("Set points earned per kill type")
    .addStringOption(o => o.setName("type").setDescription("player or scientist").setRequired(true)
      .addChoices({ name: "player", value: "player" }, { name: "scientist", value: "scientist" }))
    .addIntegerOption(o => o.setName("amount").setDescription("Points to award").setRequired(true)) as SlashCommandBuilder),
  execute: handleKillPoints,
},
```

---

## 11. ADD /ADD-POINTS-PLAYER, /SUB-POINTS-PLAYER, /ADD-POINTS-SERVER, /SUB-POINTS-SERVER

In `lib/bot/src/commands/handlers/economy.ts`, add:

```typescript
export async function handleAddPointsPlayer(interaction: ChatInputCommandInteraction): Promise<void> {
  if (!await requireRole(interaction, "avivadmin")) return;
  const server = await getServerForInteraction(interaction);
  if (!server) return;
  const name = interaction.options.getString("name", true);
  const amount = interaction.options.getInteger("amount", true);
  await db.ensureEconomy(server.id, name);
  await db.updateBalance(server.id, name, amount);
  await interaction.reply({ content: `✅ Added ${amount} to **${name}**.`, ephemeral: true });
}

export async function handleSubPointsPlayer(interaction: ChatInputCommandInteraction): Promise<void> {
  if (!await requireRole(interaction, "avivadmin")) return;
  const server = await getServerForInteraction(interaction);
  if (!server) return;
  const name = interaction.options.getString("name", true);
  const amount = interaction.options.getInteger("amount", true);
  await db.ensureEconomy(server.id, name);
  await db.updateBalance(server.id, name, -amount);
  await interaction.reply({ content: `✅ Removed ${amount} from **${name}**.`, ephemeral: true });
}

export async function handleAddPointsServer(interaction: ChatInputCommandInteraction): Promise<void> {
  if (!await requireRole(interaction, "avivadmin")) return;
  const server = await getServerForInteraction(interaction);
  if (!server) return;
  const amount = interaction.options.getInteger("amount", true);
  await db.addPointsAllPlayers(server.id, amount);
  await interaction.reply({ content: `✅ Added ${amount} to ALL players.`, ephemeral: true });
}

export async function handleSubPointsServer(interaction: ChatInputCommandInteraction): Promise<void> {
  if (!await requireRole(interaction, "avivadmin")) return;
  const server = await getServerForInteraction(interaction);
  if (!server) return;
  const amount = interaction.options.getInteger("amount", true);
  await db.addPointsAllPlayers(server.id, -amount);
  await interaction.reply({ content: `✅ Removed ${amount} from ALL players.`, ephemeral: true });
}
```

Add `addPointsAllPlayers` to `lib/db/src/index.ts`:

```typescript
export async function addPointsAllPlayers(serverId: number, delta: number): Promise<void> {
  await db.execute({
    sql: "UPDATE economy SET balance = MAX(0, balance + ?) WHERE server_id = ?",
    args: [delta, serverId]
  });
}
```

Add all four to `registry.ts` with appropriate options (name string + amount integer).

---

## 12. ADD /SWAP COMMAND (TRANSFER BETWEEN SERVERS)

In `lib/bot/src/commands/handlers/economy.ts`, add:

```typescript
export async function handleSwap(interaction: ChatInputCommandInteraction): Promise<void> {
  if (!interaction.guild) return;
  const fromServerNum = interaction.options.getInteger("from_server", true);
  const toServerNum = interaction.options.getInteger("to_server", true);
  const amount = interaction.options.getInteger("amount", true);

  const servers = await db.getServersByGuild(interaction.guild.id);
  const fromServer = servers.find(s => s.server_number === fromServerNum);
  const toServer = servers.find(s => s.server_number === toServerNum);
  if (!fromServer || !toServer) {
    await interaction.reply({ content: "One or both servers not found.", ephemeral: true }); return;
  }

  const discordUserId = interaction.user.id;
  const fromPlayer = await db.getPlayerByDiscord(fromServer.id, discordUserId);
  const toPlayer = await db.getPlayerByDiscord(toServer.id, discordUserId);
  if (!fromPlayer || !toPlayer) {
    await interaction.reply({ content: "You must be linked on both servers to swap.", ephemeral: true }); return;
  }

  const balance = await db.getBalance(fromServer.id, fromPlayer.ingame_name);
  if (balance < amount) {
    await interaction.reply({ content: `Insufficient balance. You have ${balance}.`, ephemeral: true }); return;
  }

  await db.updateBalance(fromServer.id, fromPlayer.ingame_name, -amount);
  await db.ensureEconomy(toServer.id, toPlayer.ingame_name);
  await db.updateBalance(toServer.id, toPlayer.ingame_name, amount);
  await interaction.reply({ content: `✅ Swapped ${amount} from Server ${fromServerNum} to Server ${toServerNum}.`, ephemeral: true });
}
```

---

## 13. FIX THE DASHBOARD HTML

Replace the script section in `artifacts/api-server/src/public/dashboard.html` with:

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
  } catch {
    document.getElementById('loading').style.display = 'none';
    document.getElementById('error-msg').style.display = 'block';
  }
}

async function loadGuildDashboard(guildId) {
  if (!guildId) return;
  const data = await fetch(`/api/setup/${guildId}`).then(r => r.json()).catch(() => ({ servers: [] }));
  const grid = document.getElementById('servers-grid');
  grid.innerHTML = '';
  for (const server of (data.servers || [])) {
    const host = server.rcon_host ? server.rcon_host.replace(/./g, (c, i) => i > 4 ? '*' : c) : 'Not configured';
    grid.innerHTML += `
      <div class="server-card">
        <h3>${server.server_label || 'Server ' + server.server_number}</h3>
        <div class="server-meta">Host: ${host}</div>
        <span class="rcon-badge ${server.rcon_host ? 'on' : 'off'}">${server.rcon_host ? 'RCON Set' : 'No RCON'}</span>
      </div>`;
  }
  document.getElementById('guild-dash').style.display = 'block';
}

document.getElementById('guild-select')?.addEventListener('change', e => loadGuildDashboard(e.target.value));
init();
```

---

## 14. ADD /API/HEALTH ROUTE AND FIX STATUS PAGE

Add to `artifacts/api-server/src/routes/health.ts`:

```typescript
import { Router } from "express";
import { rconManager } from "@workspace/bot";

const router = Router();

const startTime = Date.now();

router.get("/health", (_req, res) => {
  res.json({
    status: "ok",
    connectedServers: rconManager.getConnectedCount(),
    uptime: Math.floor((Date.now() - startTime) / 1000),
  });
});

export default router;
```

Add `getConnectedCount()` method to `RconManager` in `lib/bot/src/rcon/manager.ts`:

```typescript
getConnectedCount(): number {
  return this.connections.size;
}
```

In `artifacts/api-server/src/public/status.html`, make the script call `GET /api/health` and display the result.

---

## 15. UPDATE .env.example

Add these missing variables to `.env.example`:

```
STRIPE_PRICE_BASIC=price_xxx
STRIPE_PRICE_PRO=price_xxx
STRIPE_PRICE_ENTERPRISE=price_xxx
DISCORD_CLIENT_ID=
DISCORD_CLIENT_SECRET=
DISCORD_REDIRECT_URI=https://yourdomain.com/auth/callback
SESSION_SECRET=change-this-to-a-random-string
```

---

## 16. FIX THE SETUP PAGE (setup.html) — STRIPE VERIFICATION

In `artifacts/api-server/src/routes/setup.ts`, add a verify-email route:

```typescript
router.post("/verify-email", async (req, res) => {
  const { email } = req.body;
  if (!email) { res.status(400).json({ valid: false, error: "Email required" }); return; }
  const customer = await db.getCustomerByEmail(email);
  if (!customer || customer.status !== "active") {
    res.json({ valid: false, error: "No active subscription found for this email" });
    return;
  }
  res.json({ valid: true });
});
```

And the main server provisioning route must check subscription status:

```typescript
router.post("/:guildId/server", async (req, res) => {
  const { guildId } = req.params;
  const { email, rcon_host, rcon_port, rcon_password, server_label } = req.body;

  // Verify subscription
  const customer = await db.getCustomerByEmail(email);
  if (!customer || customer.status !== "active") {
    res.status(403).json({ error: "No active subscription found for this email" });
    return;
  }

  // Insert server record
  const serverId = await db.insertServer({
    customer_id: customer.id,
    discord_guild_id: guildId,
    rcon_host,
    rcon_port: parseInt(rcon_port, 10) || 28016,
    rcon_password,
    server_label: server_label || "Server 1",
    server_number: 1,
  });

  res.json({ success: true, serverId });
});
```

---

## 17. BUILD AND FIX ALL TYPESCRIPT ERRORS

After all the above changes:

1. Run `pnpm install` from the root
2. Run `pnpm -r build`
3. Fix every TypeScript error — do not leave any that prevent compilation
4. Specifically verify:
   - All DB functions exported from `lib/db/src/index.ts` match what bot/server code imports
   - `express-session` types correctly augment `Request`
   - `interactionCreate.ts` handles both slash commands AND button interactions
   - `rconManager.getConnectedCount()` exists
   - All new slash commands are registered and handlers imported in `registry.ts`
5. After clean build, confirm bot starts and `/api/health` returns `{ status: "ok" }`

---

## SUMMARY — WHAT THIS ROUND FIXES

- "Yes"/"Retreat!" conflict with ZORP/TPHOME flows fully resolved
- VIP kit list check added to `handleKit()`
- All missing DB functions implemented
- Session middleware added to API server
- Discord OAuth login fully implemented
- `/aviv` panel works with interactive category buttons
- `/wipe-economy`, `/wipe-raidlink`, `/wipe-zorp` commands added
- `/setdailyscale`, `/killpoints`, point management commands added
- `/swap` cross-server currency transfer added
- Dashboard page properly authenticates and loads guild data
- `/api/health` endpoint added
- `.env.example` updated with all required vars
- Setup page verifies Stripe subscription before provisioning
- Full clean TypeScript build
