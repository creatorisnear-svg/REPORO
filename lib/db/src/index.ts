import { createClient } from "@libsql/client";
import { runMigrations } from "./schema/index.js";

const url = process.env.TURSO_DATABASE_URL;
const authToken = process.env.TURSO_AUTH_TOKEN;

if (!url) {
  console.warn("[DB] TURSO_DATABASE_URL not set - using local SQLite fallback");
}

export const db = createClient({
  url: url ?? "file:local.db",
  authToken,
});

export async function initDatabase(): Promise<void> {
  await runMigrations(db);
  console.log("[DB] Migrations complete");
}

// ---- types ----

export interface CustomerRow {
  id: number;
  stripe_customer_id: string | null;
  email: string;
  plan: string;
  status: string;
  created_at: string;
}

export interface ServerRow {
  id: number;
  customer_id: number;
  discord_guild_id: string | null;
  rcon_host: string | null;
  rcon_port: number | null;
  rcon_password: string | null;
  server_label: string;
  server_number: number;
  active: number;
}

export interface PlayerRow {
  id: number;
  server_id: number;
  discord_user_id: string;
  ingame_name: string;
  linked_at: string;
}

export interface EconomyRow {
  id: number;
  server_id: number;
  ingame_name: string;
  balance: number;
  last_kill_farm: string | null;
  last_daily: string | null;
}

export interface ListRow {
  id: number;
  server_id: number;
  list_name: string;
  ingame_name: string;
}

export interface KitClaimRow {
  id: number;
  server_id: number;
  ingame_name: string;
  kit_name: string;
  last_claimed: string;
}

export interface WarningRow {
  id: number;
  server_id: number;
  ingame_name: string;
  reason: string;
  issued_at: string;
}

export interface ConfigRow {
  id: number;
  server_id: number;
  config_key: string;
  config_value: string;
}

export interface ChannelRow {
  id: number;
  server_id: number;
  channel_type: string;
  discord_channel_id: string;
}

export interface PrisonRow {
  id: number;
  server_id: number;
  ingame_name: string;
  reason: string;
  release_at: string;
  active: number;
}

export interface ZorpZoneRow {
  id: number;
  server_id: number;
  ingame_name: string;
  team_id: string | null;
  zone_id: string | null;
  created_at: string;
  expires_at: string;
  status: string;
  last_seen_at: string | null;
}

export interface BountyRow {
  id: number;
  server_id: number;
  target_name: string;
  kill_count: number;
  reward: number;
  active: number;
}

export interface SchedulerRow {
  id: number;
  server_id: number;
  message: string;
  interval_minutes: number;
  last_sent: string | null;
}

export interface ShopCategoryRow {
  id: number;
  server_id: number;
  name: string;
  parent_id: number | null;
  category_type: string;
  required_role: string | null;
}

export interface ShopProductRow {
  id: number;
  category_id: number;
  name: string;
  shortname: string;
  price: number;
  stock: number;
  timer_hours: number;
}

export interface RaidLinkRow {
  id: number;
  server_id: number;
  ingame_name: string;
  frequency: string;
  discord_user_id: string;
}

export interface TpPositionRow {
  id: number;
  server_id: number;
  position_type: string;
  x: number;
  y: number;
  z: number;
  label: string | null;
}

// ---- customer queries ----

export async function getCustomerByEmail(email: string): Promise<CustomerRow | null> {
  const r = await db.execute({ sql: "SELECT * FROM customers WHERE email = ?", args: [email] });
  return (r.rows[0] as unknown as CustomerRow) ?? null;
}

export async function getCustomerByStripeId(stripeId: string): Promise<CustomerRow | null> {
  const r = await db.execute({ sql: "SELECT * FROM customers WHERE stripe_customer_id = ?", args: [stripeId] });
  return (r.rows[0] as unknown as CustomerRow) ?? null;
}

export async function upsertCustomer(email: string, stripeId: string, plan: string): Promise<void> {
  await db.execute({
    sql: `INSERT INTO customers (email, stripe_customer_id, plan, status)
          VALUES (?, ?, ?, 'active')
          ON CONFLICT(email) DO UPDATE SET stripe_customer_id = excluded.stripe_customer_id,
          plan = excluded.plan, status = 'active'`,
    args: [email, stripeId, plan]
  });
}

export async function setCustomerStatus(stripeId: string, status: string): Promise<void> {
  await db.execute({ sql: "UPDATE customers SET status = ? WHERE stripe_customer_id = ?", args: [status, stripeId] });
}

// ---- server queries ----

export async function getServersByGuild(guildId: string): Promise<ServerRow[]> {
  const r = await db.execute({ sql: "SELECT * FROM servers WHERE discord_guild_id = ? AND active = 1", args: [guildId] });
  return r.rows as unknown as ServerRow[];
}

export async function getServerByGuildAndNumber(guildId: string, number: number): Promise<ServerRow | null> {
  const r = await db.execute({
    sql: "SELECT * FROM servers WHERE discord_guild_id = ? AND server_number = ? AND active = 1",
    args: [guildId, number]
  });
  return (r.rows[0] as unknown as ServerRow) ?? null;
}

export async function getServerById(id: number): Promise<ServerRow | null> {
  const r = await db.execute({ sql: "SELECT * FROM servers WHERE id = ?", args: [id] });
  return (r.rows[0] as unknown as ServerRow) ?? null;
}

export async function insertServer(data: {
  customerId: number;
  guildId: string;
  rconHost: string;
  rconPort: number;
  rconPassword: string;
  label: string;
  serverNumber: number;
}): Promise<number> {
  const r = await db.execute({
    sql: `INSERT INTO servers (customer_id, discord_guild_id, rcon_host, rcon_port, rcon_password, server_label, server_number)
          VALUES (?, ?, ?, ?, ?, ?, ?)`,
    args: [data.customerId, data.guildId, data.rconHost, data.rconPort, data.rconPassword, data.label, data.serverNumber]
  });
  return Number(r.lastInsertRowid);
}

export async function deactivateServer(serverId: number): Promise<void> {
  await db.execute({ sql: "UPDATE servers SET active = 0 WHERE id = ?", args: [serverId] });
}

// ---- player / linking queries ----

export async function getPlayerByDiscord(serverId: number, discordUserId: string): Promise<PlayerRow | null> {
  const r = await db.execute({
    sql: "SELECT * FROM players WHERE server_id = ? AND discord_user_id = ?",
    args: [serverId, discordUserId]
  });
  return (r.rows[0] as unknown as PlayerRow) ?? null;
}

export async function getPlayerByIngameName(serverId: number, ingameName: string): Promise<PlayerRow | null> {
  const r = await db.execute({
    sql: "SELECT * FROM players WHERE server_id = ? AND ingame_name = ?",
    args: [serverId, ingameName]
  });
  return (r.rows[0] as unknown as PlayerRow) ?? null;
}

export async function linkPlayer(serverId: number, discordUserId: string, ingameName: string): Promise<void> {
  await db.execute({
    sql: `INSERT OR REPLACE INTO players (server_id, discord_user_id, ingame_name, linked_at)
          VALUES (?, ?, ?, datetime('now'))`,
    args: [serverId, discordUserId, ingameName]
  });
}

export async function unlinkPlayer(serverId: number, discordUserId: string): Promise<void> {
  await db.execute({
    sql: "DELETE FROM players WHERE server_id = ? AND discord_user_id = ?",
    args: [serverId, discordUserId]
  });
}

export async function getLinkedPlayersByGuild(guildId: string): Promise<(PlayerRow & { guild_id: string })[]> {
  const r = await db.execute({
    sql: `SELECT p.*, s.discord_guild_id as guild_id FROM players p
          JOIN servers s ON p.server_id = s.id WHERE s.discord_guild_id = ?`,
    args: [guildId]
  });
  return r.rows as unknown as (PlayerRow & { guild_id: string })[];
}

// ---- economy queries ----

export async function getEconomy(serverId: number, ingameName: string): Promise<EconomyRow | null> {
  const r = await db.execute({
    sql: "SELECT * FROM economy WHERE server_id = ? AND ingame_name = ?",
    args: [serverId, ingameName]
  });
  return (r.rows[0] as unknown as EconomyRow) ?? null;
}

export async function ensureEconomy(serverId: number, ingameName: string): Promise<EconomyRow> {
  await db.execute({
    sql: "INSERT OR IGNORE INTO economy (server_id, ingame_name, balance) VALUES (?, ?, 0)",
    args: [serverId, ingameName]
  });
  const r = await db.execute({
    sql: "SELECT * FROM economy WHERE server_id = ? AND ingame_name = ?",
    args: [serverId, ingameName]
  });
  return r.rows[0] as unknown as EconomyRow;
}

export async function updateBalance(serverId: number, ingameName: string, delta: number): Promise<void> {
  await db.execute({
    sql: "UPDATE economy SET balance = MAX(0, balance + ?) WHERE server_id = ? AND ingame_name = ?",
    args: [delta, serverId, ingameName]
  });
}

export async function setBalance(serverId: number, ingameName: string, amount: number): Promise<void> {
  await db.execute({
    sql: "UPDATE economy SET balance = ? WHERE server_id = ? AND ingame_name = ?",
    args: [amount, serverId, ingameName]
  });
}

export async function getBalance(serverId: number, ingameName: string): Promise<number> {
  const r = await db.execute({
    sql: "SELECT balance FROM economy WHERE server_id = ? AND ingame_name = ?",
    args: [serverId, ingameName]
  });
  if (!r.rows[0]) return 0;
  return Number((r.rows[0] as unknown as { balance: number }).balance);
}

export async function getLastDaily(serverId: number, ingameName: string): Promise<string | null> {
  const r = await db.execute({
    sql: "SELECT last_daily FROM economy WHERE server_id = ? AND ingame_name = ?",
    args: [serverId, ingameName]
  });
  if (!r.rows[0]) return null;
  return (r.rows[0] as unknown as { last_daily: string | null }).last_daily;
}

export async function setLastDaily(serverId: number, ingameName: string, timestamp?: string): Promise<void> {
  await db.execute({
    sql: `UPDATE economy SET last_daily = ${timestamp ? "?" : "datetime('now')"} WHERE server_id = ? AND ingame_name = ?`,
    args: timestamp ? [timestamp, serverId, ingameName] : [serverId, ingameName]
  });
}

export async function addPointsAllPlayers(serverId: number, delta: number): Promise<void> {
  await db.execute({
    sql: "UPDATE economy SET balance = MAX(0, balance + ?) WHERE server_id = ?",
    args: [delta, serverId]
  });
}

export async function setLastKillFarm(serverId: number, ingameName: string, victimName: string): Promise<void> {
  await db.execute({
    sql: "UPDATE economy SET last_kill_farm = ? WHERE server_id = ? AND ingame_name = ?",
    args: [`${victimName}:${Date.now()}`, serverId, ingameName]
  });
}

export async function getLeaderboard(serverId: number, limit = 10): Promise<EconomyRow[]> {
  const r = await db.execute({
    sql: "SELECT * FROM economy WHERE server_id = ? ORDER BY balance DESC LIMIT ?",
    args: [serverId, limit]
  });
  return r.rows as unknown as EconomyRow[];
}

// ---- list queries ----

export async function addToList(serverId: number, listName: string, ingameName: string): Promise<void> {
  await db.execute({
    sql: "INSERT OR IGNORE INTO lists (server_id, list_name, ingame_name) VALUES (?, ?, ?)",
    args: [serverId, listName, ingameName]
  });
}

export async function removeFromList(serverId: number, listName: string, ingameName: string): Promise<void> {
  await db.execute({
    sql: "DELETE FROM lists WHERE server_id = ? AND list_name = ? AND ingame_name = ?",
    args: [serverId, listName, ingameName]
  });
}

export async function getList(serverId: number, listName: string): Promise<ListRow[]> {
  const r = await db.execute({
    sql: "SELECT * FROM lists WHERE server_id = ? AND list_name = ?",
    args: [serverId, listName]
  });
  return r.rows as unknown as ListRow[];
}

export async function isOnList(serverId: number, listName: string, ingameName: string): Promise<boolean> {
  const r = await db.execute({
    sql: "SELECT id FROM lists WHERE server_id = ? AND list_name = ? AND ingame_name = ?",
    args: [serverId, listName, ingameName]
  });
  return r.rows.length > 0;
}

// ---- kit claims ----

export async function getLastKitClaim(serverId: number, ingameName: string, kitName: string): Promise<KitClaimRow | null> {
  const r = await db.execute({
    sql: "SELECT * FROM kit_claims WHERE server_id = ? AND ingame_name = ? AND kit_name = ?",
    args: [serverId, ingameName, kitName]
  });
  return (r.rows[0] as unknown as KitClaimRow) ?? null;
}

export async function recordKitClaim(serverId: number, ingameName: string, kitName: string): Promise<void> {
  await db.execute({
    sql: `INSERT INTO kit_claims (server_id, ingame_name, kit_name, last_claimed)
          VALUES (?, ?, ?, datetime('now'))
          ON CONFLICT(rowid) DO UPDATE SET last_claimed = datetime('now')`,
    args: [serverId, ingameName, kitName]
  });
  await db.execute({
    sql: `INSERT OR REPLACE INTO kit_claims (server_id, ingame_name, kit_name, last_claimed)
          VALUES (?, ?, ?, datetime('now'))`,
    args: [serverId, ingameName, kitName]
  });
}

// ---- config queries ----

export async function getConfig(serverId: number, key: string): Promise<string | null> {
  const r = await db.execute({
    sql: "SELECT config_value FROM configs WHERE server_id = ? AND config_key = ?",
    args: [serverId, key]
  });
  if (!r.rows[0]) return null;
  return String((r.rows[0] as unknown as ConfigRow).config_value);
}

export async function setConfig(serverId: number, key: string, value: string): Promise<void> {
  await db.execute({
    sql: `INSERT INTO configs (server_id, config_key, config_value) VALUES (?, ?, ?)
          ON CONFLICT(server_id, config_key) DO UPDATE SET config_value = excluded.config_value`,
    args: [serverId, key, value]
  });
}

export async function getAllConfigs(serverId: number): Promise<ConfigRow[]> {
  const r = await db.execute({
    sql: "SELECT * FROM configs WHERE server_id = ?",
    args: [serverId]
  });
  return r.rows as unknown as ConfigRow[];
}

// ---- channel queries ----

export async function getChannel(serverId: number, channelType: string): Promise<string | null> {
  const r = await db.execute({
    sql: "SELECT discord_channel_id FROM channels WHERE server_id = ? AND channel_type = ?",
    args: [serverId, channelType]
  });
  if (!r.rows[0]) return null;
  return String((r.rows[0] as unknown as ChannelRow).discord_channel_id);
}

export async function setChannel(serverId: number, channelType: string, channelId: string): Promise<void> {
  await db.execute({
    sql: `INSERT INTO channels (server_id, channel_type, discord_channel_id) VALUES (?, ?, ?)
          ON CONFLICT(server_id, channel_type) DO UPDATE SET discord_channel_id = excluded.discord_channel_id`,
    args: [serverId, channelType, channelId]
  });
}

// ---- warning queries ----

export async function addWarning(serverId: number, ingameName: string, reason: string): Promise<void> {
  await db.execute({
    sql: "INSERT INTO warnings (server_id, ingame_name, reason) VALUES (?, ?, ?)",
    args: [serverId, ingameName, reason]
  });
}

export async function getWarnings(serverId: number, ingameName: string): Promise<WarningRow[]> {
  const r = await db.execute({
    sql: "SELECT * FROM warnings WHERE server_id = ? AND ingame_name = ?",
    args: [serverId, ingameName]
  });
  return r.rows as unknown as WarningRow[];
}

export async function clearWarnings(serverId: number, ingameName: string): Promise<void> {
  await db.execute({
    sql: "DELETE FROM warnings WHERE server_id = ? AND ingame_name = ?",
    args: [serverId, ingameName]
  });
}

// ---- prison queries ----

export async function addToPrison(serverId: number, ingameName: string, reason: string, durationMinutes: number): Promise<void> {
  await db.execute({
    sql: `INSERT INTO prison (server_id, ingame_name, reason, release_at, active)
          VALUES (?, ?, ?, datetime('now', '+' || ? || ' minutes'), 1)`,
    args: [serverId, ingameName, reason, durationMinutes]
  });
}

export async function addPrisoner(serverId: number, ingameName: string, reason: string, releaseAt: string): Promise<void> {
  await db.execute({
    sql: "INSERT INTO prison (server_id, ingame_name, reason, release_at, active) VALUES (?, ?, ?, ?, 1)",
    args: [serverId, ingameName, reason, releaseAt]
  });
}

export async function getActivePrisoners(serverId: number): Promise<PrisonRow[]> {
  const r = await db.execute({
    sql: "SELECT * FROM prison WHERE server_id = ? AND active = 1 AND release_at > datetime('now')",
    args: [serverId]
  });
  return r.rows as unknown as PrisonRow[];
}

export async function isPrisoner(serverId: number, ingameName: string): Promise<boolean> {
  const r = await db.execute({
    sql: "SELECT id FROM prison WHERE server_id = ? AND ingame_name = ? AND active = 1 AND release_at > datetime('now')",
    args: [serverId, ingameName]
  });
  return r.rows.length > 0;
}

export async function releasePrisoner(serverId: number, ingameName: string): Promise<void> {
  await db.execute({
    sql: "UPDATE prison SET active = 0 WHERE server_id = ? AND ingame_name = ? AND active = 1",
    args: [serverId, ingameName]
  });
}

// ---- ZORP queries ----

export async function getZorpZone(serverId: number, ingameName: string): Promise<ZorpZoneRow | null> {
  const r = await db.execute({
    sql: "SELECT * FROM zorp_zones WHERE server_id = ? AND ingame_name = ?",
    args: [serverId, ingameName]
  });
  return (r.rows[0] as unknown as ZorpZoneRow) ?? null;
}

export async function upsertZorpZone(serverId: number, ingameName: string, teamId: string, zoneId: string): Promise<void> {
  const existing = await getZorpZone(serverId, ingameName);
  if (existing) {
    await db.execute({
      sql: `UPDATE zorp_zones SET team_id = ?, zone_id = ?, expires_at = datetime('now', '+24 hours'), status = 'white', created_at = datetime('now')
            WHERE server_id = ? AND ingame_name = ?`,
      args: [teamId, zoneId, serverId, ingameName]
    });
  } else {
    await db.execute({
      sql: `INSERT INTO zorp_zones (server_id, ingame_name, team_id, zone_id, created_at, expires_at, status)
            VALUES (?, ?, ?, ?, datetime('now'), datetime('now', '+24 hours'), 'white')`,
      args: [serverId, ingameName, teamId, zoneId]
    });
  }
}

export async function deleteZorpZone(serverId: number, ingameName: string): Promise<void> {
  await db.execute({
    sql: "DELETE FROM zorp_zones WHERE server_id = ? AND ingame_name = ?",
    args: [serverId, ingameName]
  });
}

export async function getAllZorpZones(serverId: number): Promise<ZorpZoneRow[]> {
  const r = await db.execute({
    sql: "SELECT * FROM zorp_zones WHERE server_id = ?",
    args: [serverId]
  });
  return r.rows as unknown as ZorpZoneRow[];
}

export async function updateZorpStatus(serverId: number, ingameName: string, status: string): Promise<void> {
  await db.execute({
    sql: "UPDATE zorp_zones SET status = ? WHERE server_id = ? AND ingame_name = ?",
    args: [status, serverId, ingameName]
  });
}

export async function updateZorpLastSeen(serverId: number, ingameName: string, timestamp: string): Promise<void> {
  await db.execute({
    sql: "UPDATE zorp_zones SET last_seen_at = ? WHERE server_id = ? AND ingame_name = ?",
    args: [timestamp, serverId, ingameName]
  });
}

// ---- scheduler queries ----

export async function getSchedulerMessages(serverId: number): Promise<SchedulerRow[]> {
  const r = await db.execute({
    sql: "SELECT * FROM scheduler WHERE server_id = ?",
    args: [serverId]
  });
  return r.rows as unknown as SchedulerRow[];
}

export async function addSchedulerMessage(serverId: number, message: string, intervalMinutes: number): Promise<void> {
  await db.execute({
    sql: "INSERT INTO scheduler (server_id, message, interval_minutes) VALUES (?, ?, ?)",
    args: [serverId, message, intervalMinutes]
  });
}

export async function removeSchedulerMessage(id: number): Promise<void> {
  await db.execute({ sql: "DELETE FROM scheduler WHERE id = ?", args: [id] });
}

export async function updateSchedulerLastSent(id: number): Promise<void> {
  await db.execute({
    sql: "UPDATE scheduler SET last_sent = datetime('now') WHERE id = ?",
    args: [id]
  });
}

// ---- shop queries ----

export async function getShopCategories(serverId: number): Promise<ShopCategoryRow[]> {
  const r = await db.execute({
    sql: "SELECT * FROM shop_categories WHERE server_id = ?",
    args: [serverId]
  });
  return r.rows as unknown as ShopCategoryRow[];
}

export async function getShopProducts(categoryId: number): Promise<ShopProductRow[]> {
  const r = await db.execute({
    sql: "SELECT * FROM shop_products WHERE category_id = ?",
    args: [categoryId]
  });
  return r.rows as unknown as ShopProductRow[];
}

export async function getShopProductById(productId: number): Promise<ShopProductRow | null> {
  const r = await db.execute({
    sql: "SELECT * FROM shop_products WHERE id = ?",
    args: [productId]
  });
  return (r.rows[0] as unknown as ShopProductRow) ?? null;
}

export async function getLastShopPurchase(serverId: number, ingameName: string, productId: number): Promise<{ purchased_at: string } | null> {
  const r = await db.execute({
    sql: "SELECT purchased_at FROM shop_purchases WHERE server_id = ? AND ingame_name = ? AND product_id = ? ORDER BY purchased_at DESC LIMIT 1",
    args: [serverId, ingameName, productId]
  });
  if (!r.rows[0]) return null;
  return r.rows[0] as unknown as { purchased_at: string };
}

export async function recordShopPurchase(serverId: number, ingameName: string, productId: number): Promise<void> {
  await db.execute({
    sql: "INSERT INTO shop_purchases (server_id, ingame_name, product_id, purchased_at) VALUES (?, ?, ?, datetime('now'))",
    args: [serverId, ingameName, productId]
  });
}

export async function addShopCategory(serverId: number, name: string, parentId: number | null, type: string): Promise<number> {
  const r = await db.execute({
    sql: "INSERT INTO shop_categories (server_id, name, parent_id, category_type) VALUES (?, ?, ?, ?)",
    args: [serverId, name, parentId, type]
  });
  return Number(r.lastInsertRowid);
}

export async function addShopProduct(categoryId: number, name: string, shortname: string, price: number, timerHours = 0): Promise<number> {
  const r = await db.execute({
    sql: "INSERT INTO shop_products (category_id, name, shortname, price, timer_hours) VALUES (?, ?, ?, ?, ?)",
    args: [categoryId, name, shortname, price, timerHours]
  });
  return Number(r.lastInsertRowid);
}

export async function removeShopProduct(productId: number): Promise<void> {
  await db.execute({ sql: "DELETE FROM shop_products WHERE id = ?", args: [productId] });
}

// ---- raid link queries ----

export async function getRaidLink(serverId: number, ingameName: string): Promise<RaidLinkRow | null> {
  const r = await db.execute({
    sql: "SELECT * FROM raid_links WHERE server_id = ? AND ingame_name = ?",
    args: [serverId, ingameName]
  });
  return (r.rows[0] as unknown as RaidLinkRow) ?? null;
}

export async function upsertRaidLink(serverId: number, ingameName: string, frequency: string, discordUserId: string): Promise<void> {
  await db.execute({
    sql: `INSERT INTO raid_links (server_id, ingame_name, frequency, discord_user_id) VALUES (?, ?, ?, ?)
          ON CONFLICT DO NOTHING`,
    args: [serverId, ingameName, frequency, discordUserId]
  });
}

export async function getAllRaidLinks(serverId: number): Promise<RaidLinkRow[]> {
  const r = await db.execute({ sql: "SELECT * FROM raid_links WHERE server_id = ?", args: [serverId] });
  return r.rows as unknown as RaidLinkRow[];
}

export async function deleteRaidLink(serverId: number, ingameName: string): Promise<void> {
  await db.execute({
    sql: "DELETE FROM raid_links WHERE server_id = ? AND ingame_name = ?",
    args: [serverId, ingameName]
  });
}

export async function addRaidLink(serverId: number, ingameName: string, frequency: string, discordUserId: string): Promise<void> {
  await upsertRaidLink(serverId, ingameName, frequency, discordUserId);
}

export async function removeRaidLink(serverId: number, discordUserId: string): Promise<void> {
  await db.execute({
    sql: "DELETE FROM raid_links WHERE server_id = ? AND discord_user_id = ?",
    args: [serverId, discordUserId]
  });
}

export async function wipeRaidLinks(serverId: number): Promise<void> {
  await db.execute({
    sql: "DELETE FROM raid_links WHERE server_id = ?",
    args: [serverId]
  });
}

export async function wipeZorp(serverId: number): Promise<void> {
  await db.execute({
    sql: "DELETE FROM zorp_zones WHERE server_id = ?",
    args: [serverId]
  });
}

export async function getRaidLinkByFrequency(serverId: number, frequency: string): Promise<RaidLinkRow | null> {
  const r = await db.execute({
    sql: "SELECT * FROM raid_links WHERE server_id = ? AND frequency = ?",
    args: [serverId, frequency]
  });
  return (r.rows[0] as unknown as RaidLinkRow) ?? null;
}

// ---- bounty queries ----

export async function getBounty(serverId: number, targetName: string): Promise<BountyRow | null> {
  const r = await db.execute({
    sql: "SELECT * FROM bounties WHERE server_id = ? AND target_name = ? AND active = 1",
    args: [serverId, targetName]
  });
  return (r.rows[0] as unknown as BountyRow) ?? null;
}

export async function upsertBounty(serverId: number, targetName: string, killCount: number, reward: number): Promise<void> {
  await db.execute({
    sql: `INSERT INTO bounties (server_id, target_name, kill_count, reward, active) VALUES (?, ?, ?, ?, 1)
          ON CONFLICT DO NOTHING`,
    args: [serverId, targetName, killCount, reward]
  });
  await db.execute({
    sql: "UPDATE bounties SET kill_count = ?, reward = ? WHERE server_id = ? AND target_name = ? AND active = 1",
    args: [killCount, reward, serverId, targetName]
  });
}

export async function deactivateBounty(serverId: number, targetName: string): Promise<void> {
  await db.execute({
    sql: "UPDATE bounties SET active = 0 WHERE server_id = ? AND target_name = ?",
    args: [serverId, targetName]
  });
}

export async function getActiveBounties(serverId: number): Promise<BountyRow[]> {
  const r = await db.execute({
    sql: "SELECT * FROM bounties WHERE server_id = ? AND active = 1 ORDER BY kill_count DESC",
    args: [serverId]
  });
  return r.rows as unknown as BountyRow[];
}

// ---- TP home queries ----

export async function getTpHome(serverId: number, ingameName: string): Promise<{ home_set: number; set_at: string | null } | null> {
  const r = await db.execute({
    sql: "SELECT home_set, set_at FROM tp_homes WHERE server_id = ? AND ingame_name = ?",
    args: [serverId, ingameName]
  });
  if (!r.rows[0]) return null;
  return r.rows[0] as unknown as { home_set: number; set_at: string | null };
}

export async function setTpHomePending(serverId: number, ingameName: string): Promise<void> {
  await db.execute({
    sql: `INSERT INTO tp_homes (server_id, ingame_name, home_set) VALUES (?, ?, 0)
          ON CONFLICT(rowid) DO NOTHING`,
    args: [serverId, ingameName]
  });
  await db.execute({
    sql: "INSERT OR REPLACE INTO tp_homes (server_id, ingame_name, home_set) VALUES (?, ?, 0)",
    args: [serverId, ingameName]
  });
}

export async function confirmTpHome(serverId: number, ingameName: string): Promise<void> {
  await db.execute({
    sql: "UPDATE tp_homes SET home_set = 1, set_at = datetime('now') WHERE server_id = ? AND ingame_name = ?",
    args: [serverId, ingameName]
  });
}

// ---- TP position queries ----

export async function getTpPositions(serverId: number, positionType: string): Promise<TpPositionRow[]> {
  const r = await db.execute({
    sql: "SELECT * FROM tp_positions WHERE server_id = ? AND position_type = ?",
    args: [serverId, positionType]
  });
  return r.rows as unknown as TpPositionRow[];
}

export async function addTpPosition(serverId: number, positionType: string, x: number, y: number, z: number, label?: string): Promise<void> {
  await db.execute({
    sql: "INSERT INTO tp_positions (server_id, position_type, x, y, z, label) VALUES (?, ?, ?, ?, ?, ?)",
    args: [serverId, positionType, x, y, z, label ?? null]
  });
}

export async function deleteTpPosition(id: number): Promise<void> {
  await db.execute({ sql: "DELETE FROM tp_positions WHERE id = ?", args: [id] });
}

export async function clearTpPositions(serverId: number, positionType: string): Promise<void> {
  await db.execute({
    sql: "DELETE FROM tp_positions WHERE server_id = ? AND position_type = ?",
    args: [serverId, positionType]
  });
}

// ---- prison helpers ----

export async function getDuePrisoners(serverId: number): Promise<PrisonRow[]> {
  const r = await db.execute({
    sql: "SELECT * FROM prison WHERE server_id = ? AND active = 1 AND release_at <= datetime('now')",
    args: [serverId]
  });
  return r.rows as unknown as PrisonRow[];
}

// ---- subscription queries ----

export interface SubscriptionRow {
  id: number;
  discord_guild_id: string;
  discord_user_id: string;
  plan: string;
  stripe_subscription_id: string;
  status: string;
  created_at: string;
}

export async function upsertSubscription(
  guildId: string,
  discordUserId: string,
  plan: string,
  stripeSubscriptionId: string,
  status: string
): Promise<void> {
  await db.execute({
    sql: `INSERT INTO subscriptions (discord_guild_id, discord_user_id, plan, stripe_subscription_id, status)
          VALUES (?, ?, ?, ?, ?)
          ON CONFLICT(discord_guild_id) DO UPDATE SET
            discord_user_id = excluded.discord_user_id,
            plan = excluded.plan,
            stripe_subscription_id = excluded.stripe_subscription_id,
            status = excluded.status`,
    args: [guildId, discordUserId, plan, stripeSubscriptionId, status]
  });
}

export async function getSubscriptionByGuild(guildId: string): Promise<SubscriptionRow | null> {
  const r = await db.execute({
    sql: "SELECT * FROM subscriptions WHERE discord_guild_id = ?",
    args: [guildId]
  });
  return (r.rows[0] as unknown as SubscriptionRow) ?? null;
}

export async function cancelSubscription(stripeSubscriptionId: string): Promise<void> {
  await db.execute({
    sql: "UPDATE subscriptions SET status = 'canceled' WHERE stripe_subscription_id = ?",
    args: [stripeSubscriptionId]
  });
}

// ---- server update ----

export async function updateServerFields(serverId: number, fields: Partial<{
  server_label: string;
  rcon_host: string | null;
  rcon_port: number | null;
  rcon_password: string | null;
}>): Promise<void> {
  const sets: string[] = [];
  const args: (string | number | null)[] = [];
  if (fields.server_label !== undefined) { sets.push("server_label = ?"); args.push(fields.server_label); }
  if (fields.rcon_host !== undefined) { sets.push("rcon_host = ?"); args.push(fields.rcon_host); }
  if (fields.rcon_port !== undefined) { sets.push("rcon_port = ?"); args.push(fields.rcon_port); }
  if (fields.rcon_password !== undefined) { sets.push("rcon_password = ?"); args.push(fields.rcon_password); }
  if (sets.length === 0) return;
  args.push(serverId);
  await db.execute({ sql: `UPDATE servers SET ${sets.join(", ")} WHERE id = ?`, args });
}

// ---- SRP ----

export interface SrpRequestRow {
  id: number;
  server_id: number;
  ingame_name: string;
  category: string;
  item: string;
  amount: number;
  note: string;
  status: string;
  created_at: string;
}

export async function addSrpRequest(
  serverId: number,
  ingameName: string,
  category: string,
  item: string,
  amount: number,
  note: string
): Promise<number> {
  const r = await db.execute({
    sql: `INSERT INTO srp_requests (server_id, ingame_name, category, item, amount, note, status)
          VALUES (?, ?, ?, ?, ?, ?, 'pending')`,
    args: [serverId, ingameName, category, item, amount, note]
  });
  return Number(r.lastInsertRowid);
}

export async function getPendingSrpRequests(serverId: number): Promise<SrpRequestRow[]> {
  const r = await db.execute({
    sql: "SELECT * FROM srp_requests WHERE server_id = ? AND status = 'pending' ORDER BY created_at DESC",
    args: [serverId]
  });
  return r.rows as unknown as SrpRequestRow[];
}

// ---- bounty (with placer) ----

export async function addBounty(
  serverId: number,
  targetName: string,
  placerName: string,
  reward: number
): Promise<void> {
  await db.execute({
    sql: `INSERT INTO bounties (server_id, target_name, kill_count, reward, active) VALUES (?, ?, 0, ?, 1)`,
    args: [serverId, targetName, reward]
  });
  // Store placer in configs as a note
  await db.execute({
    sql: `INSERT INTO configs (server_id, config_key, config_value) VALUES (?, ?, ?)
          ON CONFLICT(server_id, config_key) DO UPDATE SET config_value = excluded.config_value`,
    args: [serverId, `bounty_placer_${targetName}`, placerName]
  });
}

export async function wipeEconomy(serverId: number): Promise<void> {
  await db.execute({
    sql: "UPDATE economy SET balance = 0 WHERE server_id = ?",
    args: [serverId]
  });
}

export async function getBountyWithPlacer(serverId: number): Promise<Array<BountyRow & { placer_name: string }>> {
  const bounties = await getActiveBounties(serverId);
  const result = await Promise.all(bounties.map(async b => {
    const placer = await getConfig(serverId, `bounty_placer_${b.target_name}`);
    return { ...b, placer_name: placer ?? "unknown" };
  }));
  return result;
}
