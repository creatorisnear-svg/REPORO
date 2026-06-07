import type { ChatInputCommandInteraction, ButtonInteraction, ModalSubmitInteraction } from "discord.js";
import {
  PermissionFlagsBits, ChannelType, EmbedBuilder, ActionRowBuilder,
  ButtonBuilder, ButtonStyle, MessageFlags, ModalBuilder, TextInputBuilder, TextInputStyle,
} from "discord.js";
import * as db from "@workspace/db";
import { rconManager } from "../../rcon/manager.js";
import { getServerForInteraction, requireRole, hasRole } from "./utils.js";

// ====== Server Management ======

export async function handleSetup(interaction: ChatInputCommandInteraction): Promise<void> {
  if (!interaction.guild) { await interaction.reply({ content: "Must be used in a server.", flags: MessageFlags.Ephemeral }); return; }
  if (!interaction.memberPermissions?.has(PermissionFlagsBits.Administrator)) {
    await interaction.reply({ content: "You need Administrator permission to run /setup.", flags: MessageFlags.Ephemeral }); return;
  }

  await interaction.deferReply();

  const guild = interaction.guild;
  const lines: string[] = [];

  const roleNames = ["avivadmin", "avivmod", "avivlinked"];
  for (const name of roleNames) {
    const existing = guild.roles.cache.find(r => r.name === name);
    if (!existing) {
      await guild.roles.create({ name, reason: "Aviv Bot setup" });
      lines.push(`Created role: ${name}`);
    } else {
      lines.push(`Role already exists: ${name}`);
    }
  }

  const textChannels = [
    "aviv-killfeed", "aviv-player-feed", "aviv-raids", "aviv-chat",
    "aviv-events", "aviv-logs", "aviv-announcements", "aviv-errors", "aviv-cmd-logs"
  ];
  const createdChannelIds: Record<string, string> = {};

  for (const chName of textChannels) {
    const existing = guild.channels.cache.find(c => c.name === chName);
    if (!existing) {
      const ch = await guild.channels.create({ name: chName, type: ChannelType.GuildText, reason: "Aviv Bot setup" });
      createdChannelIds[chName] = ch.id;
      lines.push(`Created channel: #${chName}`);
    } else {
      createdChannelIds[chName] = existing.id;
      lines.push(`Channel exists: #${chName}`);
    }
  }

  const existingVoice = guild.channels.cache.find(c => c.name.startsWith("| Server 1"));
  if (!existingVoice) {
    const vc = await guild.channels.create({ name: "| Server 1 0 / 0", type: ChannelType.GuildVoice, reason: "Aviv Bot setup" });
    lines.push("Created voice channel: player count");
    const servers = await db.getServersByGuild(guild.id);
    if (servers.length > 0) {
      await db.setChannel(servers[0].id, "playercount", vc.id);
    }
  }

  const servers = await db.getServersByGuild(guild.id);
  if (servers.length === 0) {
    lines.push("No server configured yet. Use /add-server to add your Rust server RCON details.");
  } else {
    const serverId = servers[0].id;
    const channelMap: Record<string, string> = {
      "killfeed": "aviv-killfeed",
      "player-feed": "aviv-player-feed",
      "raid-alerts": "aviv-raids",
      "chat": "aviv-chat",
      "events": "aviv-events",
      "logs": "aviv-logs",
      "announcements": "aviv-announcements",
      "errors": "aviv-errors",
      "cmd-logs": "aviv-cmd-logs",
    };
    for (const [feedType, chName] of Object.entries(channelMap)) {
      if (createdChannelIds[chName]) {
        await db.setChannel(serverId, feedType, createdChannelIds[chName]);
      }
    }
    lines.push("Channel assignments saved.");
  }

  const embed = new EmbedBuilder()
    .setTitle("Aviv Bot Setup Complete")
    .setColor(0x5865f2)
    .setDescription(lines.join("\n"))
    .setFooter({ text: "Use /add-server to connect your Rust server." });

  await interaction.editReply({ embeds: [embed] });
}

export async function handleAddServer(interaction: ChatInputCommandInteraction): Promise<void> {
  if (!await requireRole(interaction, "avivadmin")) return;
  if (!interaction.guild) return;

  await interaction.deferReply({ flags: MessageFlags.Ephemeral });

  let host = interaction.options.getString("host", true).trim();
  const port = interaction.options.getInteger("port", true);
  const password = interaction.options.getString("password", true);
  const serverNum = interaction.options.getInteger("server") ?? 1;
  const label = interaction.options.getString("label") ?? `Server ${serverNum}`;
  const guildId = interaction.guild.id;

  const hostPortMatch = host.match(/^(.+):(\d+)$/);
  if (hostPortMatch) {
    host = hostPortMatch[1]!;
    console.warn(`[AddServer] Host contained port (${hostPortMatch[2]}) — stripped. Using host: ${host}, port: ${port}`);
  }

  const existingServers = await db.getServersByGuild(guildId);
  const bypassSub = (process.env["BYPASS_SUB"] ?? "").trim().toLowerCase() === "true";
  if (!bypassSub) {
    const allowedCount = await db.getSubscriptionServerCount(guildId);
    if (existingServers.length >= allowedCount) {
      await interaction.editReply({
        content: `Your subscription allows **${allowedCount}** server${allowedCount === 1 ? "" : "s"}. You already have **${existingServers.length}** connected. Upgrade your plan at https://avivbot.com/pricing to add more servers.`,
      });
      return;
    }
  }

  const existing = existingServers.find(s => s.server_number === serverNum);
  if (existing) {
    await interaction.editReply({
      content: `Server ${serverNum} is already configured (${existing.server_label}). Use /remove-server first, or choose a different server number.`,
    });
    return;
  }

  const email = `discord_${guildId}@avivbot.internal`;
  let customer = await db.getCustomerByEmail(email);
  if (!customer) {
    await db.upsertCustomer(email, `discord_${guildId}`, "basic");
    customer = await db.getCustomerByEmail(email);
  }

  const serverId = await db.insertServer({
    customerId: customer!.id,
    guildId,
    rconHost: host,
    rconPort: port,
    rconPassword: password,
    label,
    serverNumber: serverNum,
  });

  await interaction.editReply({
    content: `Server **${serverNum}** (${label}) added! Connecting to RCON in the background...\nUse \`/diag\` to check connection status.`,
  });

  rconManager.connect(serverId, host, port, password).catch(err => {
    console.warn(`[RCON] Initial connection test for server ${serverId} failed: ${err instanceof Error ? err.message : String(err)}`);
  });
}

export async function handleRemoveServer(interaction: ChatInputCommandInteraction): Promise<void> {
  if (!await requireRole(interaction, "avivadmin")) return;
  const server = await getServerForInteraction(interaction);
  if (!server) return;
  await db.deactivateServer(server.id);
  rconManager.dropConnection(server.id);
  await interaction.reply({ content: `Server ${server.server_number} removed.`, flags: MessageFlags.Ephemeral });
}

export async function handleDiag(interaction: ChatInputCommandInteraction): Promise<void> {
  if (!await requireRole(interaction, "avivadmin")) return;
  if (!interaction.guild) return;
  await interaction.deferReply({ flags: MessageFlags.Ephemeral });

  const servers = await db.getServersByGuild(interaction.guild.id);
  if (servers.length === 0) {
    await interaction.editReply({ content: "No servers configured." });
    return;
  }

  const lines: string[] = [];
  for (const srv of servers) {
    const status = rconManager.getStatus(srv.id);
    const icon = status === "connected" ? "🟢" : "🔴";
    lines.push(`${icon} **Server ${srv.server_number}** (${srv.server_label})\nHost: \`${srv.rcon_host}:${srv.rcon_port}\` — Status: **${status}**`);
  }

  const embed = new EmbedBuilder()
    .setTitle("Aviv Bot Diagnostics")
    .setColor(0x5865f2)
    .setDescription(lines.join("\n\n"))
    .setFooter({ text: "If status shows disconnected, check your RCON host/port/password with /add-server." });

  await interaction.editReply({ embeds: [embed] });
}

// ====== Interactive Settings Panel ======

interface SettingDef {
  key: string;
  label: string;
  type: "boolean" | "string";
  placeholder?: string;
}

interface CategoryDef {
  label: string;
  emoji: string;
  settings: SettingDef[];
}

export const SETTING_CATEGORIES: Record<string, CategoryDef> = {
  killfeed: {
    label: "Kill Feed",
    emoji: "⚔️",
    settings: [
      { key: "KillFeedDiscord", label: "Discord Kill Feed", type: "boolean" },
      { key: "KillFeedGame", label: "In-Game Kill Feed", type: "boolean" },
      { key: "KillFeedKD", label: "Show K/D Stats", type: "boolean" },
      { key: "MiscKills", label: "Misc Kills (bears, wolves, heli, bradley…)", type: "boolean" },
      { key: "ScientistKiller", label: "Show Player Kills Scientist", type: "boolean" },
      { key: "ScientistVictim", label: "Show Scientist Kills Player", type: "boolean" },
      { key: "killphraserandomizer", label: "Random Kill Phrases", type: "boolean" },
      { key: "killphrase", label: "Custom Kill Phrase (e.g. destroyed)", type: "string", placeholder: "e.g. destroyed" },
      { key: "killercolor", label: "Killer Name Color (hex)", type: "string", placeholder: "#FF3333" },
      { key: "victimcolor", label: "Victim Name Color (hex)", type: "string", placeholder: "#FF3333" },
      { key: "phrasecolor", label: "Phrase Color (hex)", type: "string", placeholder: "#4488FF" },
    ],
  },
  economy: {
    label: "Economy",
    emoji: "💰",
    settings: [
      { key: "currency_name", label: "Currency Name", type: "string", placeholder: "e.g. Coins" },
      { key: "player_kill_points", label: "Player Kill Coins", type: "string", placeholder: "e.g. 30" },
      { key: "scientist_kill_points", label: "Scientist Kill Coins", type: "string", placeholder: "e.g. 1" },
      { key: "daily_min", label: "Daily Reward Min", type: "string", placeholder: "e.g. 30" },
      { key: "daily_max", label: "Daily Reward Max", type: "string", placeholder: "e.g. 300" },
    ],
  },
  kits: {
    label: "Kits",
    emoji: "🎁",
    settings: [
      { key: "freekit_use", label: "Free Kit", type: "boolean" },
      { key: "freekit_name", label: "Free Kit Name", type: "string", placeholder: "e.g. starter" },
      { key: "freekit_time", label: "Free Kit Cooldown (hrs)", type: "string", placeholder: "e.g. 24 (0.0168 = 1 min)" },
      { key: "vipkit_use", label: "VIP Kit", type: "boolean" },
      { key: "vipkit_name", label: "VIP Kit Name", type: "string", placeholder: "e.g. vip" },
      { key: "vipkit_time", label: "VIP Kit Cooldown (hrs)", type: "string", placeholder: "e.g. 24" },
      { key: "elitekit_use", label: "Elite Kits", type: "boolean" },
    ],
  },
  features: {
    label: "Features",
    emoji: "⚙️",
    settings: [
      { key: "chatbridge", label: "Chat Bridge", type: "boolean" },
      { key: "raidalerts", label: "Raid Alerts", type: "boolean" },
      { key: "zorp", label: "ZORP System", type: "boolean" },
      { key: "zorptime", label: "ZORP Offline Timer (mins)", type: "string", placeholder: "e.g. 30" },
      { key: "zorpExpiryTime", label: "ZORP Auto-Delete (days)", type: "string", placeholder: "e.g. 7" },
      { key: "zorpMinDistance", label: "ZORP Min Distance Between Zones", type: "string", placeholder: "e.g. 100" },
      { key: "BountySystem", label: "Bounty System", type: "boolean" },
      { key: "SRP", label: "Scheduled Raid Protection", type: "boolean" },
      { key: "notemessaging", label: "Note Messaging", type: "boolean" },
    ],
  },
  teleports: {
    label: "Teleports",
    emoji: "🌀",
    settings: [
      { key: "TPN_use", label: "North (N)", type: "boolean" },
      { key: "TPE_use", label: "East (E)", type: "boolean" },
      { key: "TPS_use", label: "South (S)", type: "boolean" },
      { key: "TPW_use", label: "West (W)", type: "boolean" },
      { key: "TPNE_use", label: "North-East (NE)", type: "boolean" },
      { key: "TPSE_use", label: "South-East (SE)", type: "boolean" },
      { key: "TPSW_use", label: "South-West (SW)", type: "boolean" },
      { key: "TPNW_use", label: "North-West (NW)", type: "boolean" },
      { key: "TPHOME_use", label: "Home TP", type: "boolean" },
      { key: "combatlock_use", label: "Combat Lock", type: "boolean" },
      { key: "combatlock_time", label: "Combat Lock (secs)", type: "string", placeholder: "e.g. 30" },
    ],
  },
};

// Kept for backward compat — configs.ts uses this for /configs autocomplete
export const CATEGORY_CONFIGS: Record<string, { label: string; keys: string[] }> = Object.fromEntries(
  Object.entries(SETTING_CATEGORIES).map(([k, v]) => [
    k,
    { label: `${v.emoji} ${v.label}`, keys: v.settings.map(s => s.key) },
  ])
);

// Build the interactive category settings panel
async function buildCategoryPanel(
  serverId: number,
  catKey: string,
  serverNum: number,
): Promise<{ embeds: EmbedBuilder[]; components: ActionRowBuilder<ButtonBuilder>[] } | null> {
  const cat = SETTING_CATEGORIES[catKey];
  if (!cat) return null;

  // Load all config values in parallel
  const values: Record<string, string | null> = {};
  await Promise.all(cat.settings.map(async s => {
    values[s.key] = await db.getConfig(serverId, s.key);
  }));

  // Build embed description lines
  const lines = cat.settings.map(s => {
    if (s.type === "boolean") {
      const isOn = (values[s.key] ?? "off") === "on";
      return `${isOn ? "🟢" : "🔴"} **${s.label}** — ${isOn ? "ON" : "OFF"}`;
    }
    const val = values[s.key];
    return `✏️ **${s.label}** — ${val ?? "*(not set)*"}`;
  });

  const embed = new EmbedBuilder()
    .setTitle(`${cat.emoji} ${cat.label} — Server ${serverNum}`)
    .setColor(0x5865f2)
    .setDescription(lines.join("\n"))
    .setFooter({ text: "Green/Red = click to toggle ON/OFF  •  Gray = click to set a value" });

  // Build button rows (max 4 setting rows + 1 nav row = 5 rows total)
  const rows: ActionRowBuilder<ButtonBuilder>[] = [];
  let currentRow = new ActionRowBuilder<ButtonBuilder>();
  let buttonsInRow = 0;

  for (const s of cat.settings) {
    if (buttonsInRow >= 5) {
      rows.push(currentRow);
      currentRow = new ActionRowBuilder<ButtonBuilder>();
      buttonsInRow = 0;
    }
    if (rows.length >= 4) break; // Reserve last row for nav

    const val = values[s.key];
    let btn: ButtonBuilder;

    if (s.type === "boolean") {
      const isOn = (val ?? "off") === "on";
      btn = new ButtonBuilder()
        .setCustomId(`at:${serverId}:${catKey}:${s.key}`)
        .setLabel((`${s.label} [${isOn ? "ON" : "OFF"}]`).slice(0, 80))
        .setStyle(isOn ? ButtonStyle.Success : ButtonStyle.Danger);
    } else {
      const displayVal = val ? val.slice(0, 18) : "not set";
      btn = new ButtonBuilder()
        .setCustomId(`ae:${serverId}:${catKey}:${s.key}`)
        .setLabel((`${s.label}: ${displayVal}`).slice(0, 80))
        .setStyle(ButtonStyle.Secondary);
    }

    currentRow.addComponents(btn);
    buttonsInRow++;
  }

  if (buttonsInRow > 0) rows.push(currentRow);

  // Nav row
  const navRow = new ActionRowBuilder<ButtonBuilder>().addComponents(
    new ButtonBuilder()
      .setCustomId(`aviv_back:${serverId}`)
      .setLabel("Back to Categories")
      .setStyle(ButtonStyle.Primary),
  );
  rows.push(navRow);

  return { embeds: [embed], components: rows };
}

// Build the main /aviv panel
async function buildMainPanel(
  guildId: string,
): Promise<{ embeds: EmbedBuilder[]; components: ActionRowBuilder<ButtonBuilder>[] } | null> {
  const servers = await db.getServersByGuild(guildId);
  if (servers.length === 0) return null;

  const statusLines = servers.map(s => {
    const status = rconManager.getStatus(s.id);
    const icon = status === "connected" ? "🟢" : "🔴";
    return `${icon} Server ${s.server_number}: **${s.server_label}** (${status})`;
  }).join("\n");

  const embed = new EmbedBuilder()
    .setTitle("Aviv Bot Settings Panel")
    .setColor(0x5865f2)
    .setDescription("Select a category below to configure your server.\nToggle buttons switch features ON/OFF — no typing required.")
    .addFields(
      { name: "RCON Status", value: statusLines },
      { name: "Other Commands", value: "`/admin-channels` — set feed channels\n`/diag` — RCON health check\n`/set` — manually set any config key" },
    );

  const row = new ActionRowBuilder<ButtonBuilder>().addComponents(
    new ButtonBuilder().setCustomId("aviv_killfeed").setLabel("Kill Feed").setStyle(ButtonStyle.Secondary).setEmoji("⚔️"),
    new ButtonBuilder().setCustomId("aviv_economy").setLabel("Economy").setStyle(ButtonStyle.Secondary).setEmoji("💰"),
    new ButtonBuilder().setCustomId("aviv_kits").setLabel("Kits").setStyle(ButtonStyle.Secondary).setEmoji("🎁"),
    new ButtonBuilder().setCustomId("aviv_features").setLabel("Features").setStyle(ButtonStyle.Secondary).setEmoji("⚙️"),
    new ButtonBuilder().setCustomId("aviv_teleports").setLabel("Teleports").setStyle(ButtonStyle.Secondary).setEmoji("🌀"),
  );

  return { embeds: [embed], components: [row] };
}

export async function handleAviv(interaction: ChatInputCommandInteraction): Promise<void> {
  if (!interaction.guild) return;
  await interaction.deferReply({ flags: MessageFlags.Ephemeral });
  if (!hasRole(interaction, "avivadmin")) {
    await interaction.editReply({ content: "You need the **avivadmin** role to use this command." });
    return;
  }

  const panel = await buildMainPanel(interaction.guild.id);
  if (!panel) {
    await interaction.editReply({ content: "No servers configured. Use `/setup` then `/add-server`." });
    return;
  }

  await interaction.editReply(panel);
}

// Handles all aviv_* category buttons and the back button
export async function handleAvivButton(interaction: ButtonInteraction): Promise<void> {
  const customId = interaction.customId;

  // Back button — return to main panel
  if (customId.startsWith("aviv_back:")) {
    await interaction.deferUpdate();
    const panel = await buildMainPanel(interaction.guildId ?? "");
    if (panel) await interaction.editReply(panel);
    return;
  }

  // Category button
  const catKey = customId.replace("aviv_", "");
  if (!SETTING_CATEGORIES[catKey]) {
    await interaction.reply({ content: "Unknown category.", flags: MessageFlags.Ephemeral });
    return;
  }

  await interaction.deferUpdate();

  const servers = await db.getServersByGuild(interaction.guildId ?? "").catch(() => [] as db.ServerRow[]);
  const server = servers[0];
  if (!server) {
    await interaction.editReply({ content: "No server configured.", components: [] });
    return;
  }

  const panel = await buildCategoryPanel(server.id, catKey, server.server_number);
  if (panel) await interaction.editReply(panel);
}

// Handles toggle button clicks: at:{serverId}:{catKey}:{configKey}
export async function handleAvivToggle(interaction: ButtonInteraction): Promise<void> {
  const parts = interaction.customId.split(":");
  if (parts.length < 4) return;
  const serverId = parseInt(parts[1]!, 10);
  const catKey = parts[2]!;
  const configKey = parts.slice(3).join(":");

  await interaction.deferUpdate();

  const current = await db.getConfig(serverId, configKey);
  const newVal = (current ?? "off") === "on" ? "off" : "on";
  await db.setConfig(serverId, configKey, newVal);

  const servers = await db.getServersByGuild(interaction.guildId ?? "").catch(() => [] as db.ServerRow[]);
  const server = servers.find(s => s.id === serverId) ?? servers[0];
  const serverNum = server?.server_number ?? 1;

  const panel = await buildCategoryPanel(serverId, catKey, serverNum);
  if (panel) await interaction.editReply(panel);
}

// Handles edit button clicks: ae:{serverId}:{catKey}:{configKey}
export async function handleAvivEditModal(interaction: ButtonInteraction): Promise<void> {
  const parts = interaction.customId.split(":");
  if (parts.length < 4) return;
  const serverId = parts[1]!;
  const catKey = parts[2]!;
  const configKey = parts.slice(3).join(":");

  const cat = SETTING_CATEGORIES[catKey];
  const settingDef = cat?.settings.find(s => s.key === configKey);
  const label = (settingDef?.label ?? configKey).slice(0, 45);
  const placeholder = settingDef?.placeholder ?? "Enter a value";
  const current = await db.getConfig(parseInt(serverId, 10), configKey);

  const modal = new ModalBuilder()
    .setCustomId(`aem:${serverId}:${catKey}:${configKey}`)
    .setTitle(`Set: ${label}`.slice(0, 45));

  const input = new TextInputBuilder()
    .setCustomId("value")
    .setLabel(label)
    .setStyle(TextInputStyle.Short)
    .setPlaceholder(placeholder)
    .setRequired(true);

  if (current) input.setValue(current);

  modal.addComponents(new ActionRowBuilder<TextInputBuilder>().addComponents(input));
  await interaction.showModal(modal);
}

// Handles modal submissions: aem:{serverId}:{catKey}:{configKey}
export async function handleAvivEditModalSubmit(interaction: ModalSubmitInteraction): Promise<void> {
  const parts = interaction.customId.split(":");
  if (parts.length < 4) return;
  const serverId = parseInt(parts[1]!, 10);
  const catKey = parts[2]!;
  const configKey = parts.slice(3).join(":");

  const newValue = interaction.fields.getTextInputValue("value").trim();
  await db.setConfig(serverId, configKey, newValue);

  await interaction.deferReply({ flags: MessageFlags.Ephemeral });

  const servers = await db.getServersByGuild(interaction.guildId ?? "").catch(() => [] as db.ServerRow[]);
  const server = servers.find(s => s.id === serverId) ?? servers[0];
  const serverNum = server?.server_number ?? 1;

  const panel = await buildCategoryPanel(serverId, catKey, serverNum);
  if (panel) {
    await interaction.editReply(panel);
  } else {
    await interaction.editReply({ content: `Saved: **${configKey}** = \`${newValue}\`` });
  }
}
