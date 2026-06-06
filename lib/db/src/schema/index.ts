import type { Client } from "@libsql/client";

export async function runMigrations(db: Client): Promise<void> {
  const statements = [
    `CREATE TABLE IF NOT EXISTS customers (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      stripe_customer_id TEXT UNIQUE,
      email TEXT UNIQUE NOT NULL,
      plan TEXT DEFAULT 'basic',
      status TEXT DEFAULT 'pending',
      created_at DATETIME DEFAULT CURRENT_TIMESTAMP
    )`,
    `CREATE TABLE IF NOT EXISTS servers (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      customer_id INTEGER REFERENCES customers(id),
      discord_guild_id TEXT,
      rcon_host TEXT,
      rcon_port INTEGER,
      rcon_password TEXT,
      server_label TEXT DEFAULT 'Server 1',
      server_number INTEGER DEFAULT 1,
      active INTEGER DEFAULT 1
    )`,
    `CREATE TABLE IF NOT EXISTS players (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      server_id INTEGER REFERENCES servers(id),
      discord_user_id TEXT,
      ingame_name TEXT,
      linked_at DATETIME DEFAULT CURRENT_TIMESTAMP
    )`,
    `CREATE TABLE IF NOT EXISTS economy (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      server_id INTEGER REFERENCES servers(id),
      ingame_name TEXT,
      balance INTEGER DEFAULT 0,
      last_kill_farm TEXT,
      last_daily TEXT
    )`,
    `CREATE TABLE IF NOT EXISTS lists (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      server_id INTEGER REFERENCES servers(id),
      list_name TEXT,
      ingame_name TEXT
    )`,
    `CREATE TABLE IF NOT EXISTS kit_claims (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      server_id INTEGER REFERENCES servers(id),
      ingame_name TEXT,
      kit_name TEXT,
      last_claimed DATETIME
    )`,
    `CREATE TABLE IF NOT EXISTS zorp_zones (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      server_id INTEGER REFERENCES servers(id),
      ingame_name TEXT,
      team_id TEXT,
      zone_id TEXT,
      created_at DATETIME,
      expires_at DATETIME,
      status TEXT DEFAULT 'white'
    )`,
    `CREATE TABLE IF NOT EXISTS zorp_pending (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      server_id INTEGER REFERENCES servers(id),
      ingame_name TEXT,
      step INTEGER DEFAULT 1,
      updated_at DATETIME DEFAULT CURRENT_TIMESTAMP
    )`,
    `CREATE TABLE IF NOT EXISTS tp_homes (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      server_id INTEGER REFERENCES servers(id),
      ingame_name TEXT,
      home_set INTEGER DEFAULT 0,
      set_at DATETIME
    )`,
    `CREATE TABLE IF NOT EXISTS prison (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      server_id INTEGER REFERENCES servers(id),
      ingame_name TEXT,
      reason TEXT,
      release_at DATETIME,
      active INTEGER DEFAULT 1
    )`,
    `CREATE TABLE IF NOT EXISTS bounties (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      server_id INTEGER REFERENCES servers(id),
      target_name TEXT,
      kill_count INTEGER DEFAULT 0,
      reward INTEGER DEFAULT 0,
      active INTEGER DEFAULT 1
    )`,
    `CREATE TABLE IF NOT EXISTS scheduler (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      server_id INTEGER REFERENCES servers(id),
      message TEXT,
      interval_minutes INTEGER,
      last_sent DATETIME
    )`,
    `CREATE TABLE IF NOT EXISTS configs (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      server_id INTEGER REFERENCES servers(id),
      config_key TEXT,
      config_value TEXT,
      UNIQUE(server_id, config_key)
    )`,
    `CREATE TABLE IF NOT EXISTS channels (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      server_id INTEGER REFERENCES servers(id),
      channel_type TEXT,
      discord_channel_id TEXT,
      UNIQUE(server_id, channel_type)
    )`,
    `CREATE TABLE IF NOT EXISTS warnings (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      server_id INTEGER REFERENCES servers(id),
      ingame_name TEXT,
      reason TEXT,
      issued_at DATETIME DEFAULT CURRENT_TIMESTAMP
    )`,
    `CREATE TABLE IF NOT EXISTS shop_categories (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      server_id INTEGER REFERENCES servers(id),
      name TEXT,
      parent_id INTEGER,
      category_type TEXT DEFAULT 'item',
      required_role TEXT
    )`,
    `CREATE TABLE IF NOT EXISTS shop_products (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      category_id INTEGER REFERENCES shop_categories(id),
      name TEXT,
      shortname TEXT,
      price INTEGER,
      stock INTEGER DEFAULT -1,
      timer_hours INTEGER DEFAULT 0
    )`,
    `CREATE TABLE IF NOT EXISTS raid_links (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      server_id INTEGER REFERENCES servers(id),
      ingame_name TEXT,
      frequency TEXT,
      discord_user_id TEXT
    )`,
    `CREATE TABLE IF NOT EXISTS tp_positions (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      server_id INTEGER REFERENCES servers(id),
      position_type TEXT,
      x REAL,
      y REAL,
      z REAL,
      label TEXT
    )`,
    `CREATE TABLE IF NOT EXISTS elitekit_pending (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      server_id INTEGER REFERENCES servers(id),
      ingame_name TEXT,
      created_at DATETIME DEFAULT CURRENT_TIMESTAMP
    )`,
    `CREATE TABLE IF NOT EXISTS shop_purchases (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      server_id INTEGER REFERENCES servers(id),
      ingame_name TEXT,
      product_id INTEGER,
      purchased_at DATETIME DEFAULT CURRENT_TIMESTAMP
    )`,
    `CREATE TABLE IF NOT EXISTS combat_lock (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      server_id INTEGER REFERENCES servers(id),
      ingame_name TEXT,
      locked_until DATETIME
    )`,
    `CREATE TABLE IF NOT EXISTS subscriptions (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      discord_guild_id TEXT UNIQUE,
      discord_user_id TEXT,
      plan TEXT DEFAULT 'basic',
      stripe_subscription_id TEXT UNIQUE,
      status TEXT DEFAULT 'pending',
      created_at DATETIME DEFAULT CURRENT_TIMESTAMP
    )`,
    `CREATE TABLE IF NOT EXISTS srp_requests (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      server_id INTEGER REFERENCES servers(id),
      ingame_name TEXT,
      category TEXT,
      item TEXT,
      amount INTEGER DEFAULT 1,
      note TEXT DEFAULT '',
      status TEXT DEFAULT 'pending',
      created_at DATETIME DEFAULT CURRENT_TIMESTAMP
    )`
  ];

  for (const sql of statements) {
    await db.execute(sql);
  }
}
