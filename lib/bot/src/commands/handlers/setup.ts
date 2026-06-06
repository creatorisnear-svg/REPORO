import type { ChatInputCommandInteraction, ButtonInteraction } from "discord.js";
import { PermissionFlagsBits, ChannelType, EmbedBuilder, ActionRowBuilder, ButtonBuilder, ButtonStyle } from "discord.js";
import * as db from "@workspace/db";
import { rconManager } from "../../rcon/manager.js";
import { getServerForInteraction, requireRole } from "./utils.js";

export async function handleSetup(interaction: ChatInputCommandInteraction): Promise<void> {
  if (!interaction.guild) { await interaction.reply({ content: "Must be used in a server.", ephemeral: true }); return; }
  if (!interaction.memberPermissions?.has(PermissionFlagsBits.Administrator)) {
    await interaction.reply({ content: "You need Administrator permission to run /setup.", ephemeral: true }); return;
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

  const voiceName = "| Server 1 0 / 0";
  const existingVoice = guild.channels.cache.find(c => c.name.startsWith("| Server 1"));
  if (!existingVoice) {
    const vc = await guild.channels.create({ name: voiceName, type: ChannelType.GuildVoice, reason: "Aviv Bot setup" });
    lines.push("Created voice channel: player count");
    // Save to channels table when we have a server
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

  await interaction.deferReply({ ephemeral: true });

  const host = interaction.options.getString("host", true);
  const port = interaction.options.getInteger("port", true);
  const password = interaction.options.getString("password", true);
  const label = interaction.options.getString("label") ?? "Server 1";
  const serverNum = interaction.options.getInteger("server") ?? 1;

  const email = `discord_${interaction.guild.id}@avivbot.internal`;
  let customer = await db.getCustomerByEmail(email);
  if (!customer) {
    await db.upsertCustomer(email, `discord_${interaction.guild.id}`, "basic");
    customer = await db.getCustomerByEmail(email);
  }

  const serverId = await db.insertServer({
    customerId: customer!.id,
    guildId: interaction.guild.id,
    rconHost: host,
    rconPort: port,
    rconPassword: password,
    label,
    serverNumber: serverNum,
  });

  try {
    await rconManager.sendCommand(serverId, host, port, password, "status");
    await interaction.editReply({ content: `Server ${serverNum} added and RCON connection verified. Server ID: ${serverId}` });
  } catch {
    await interaction.editReply({ content: `Server ${serverNum} added (ID: ${serverId}) but RCON connection failed. Check your credentials.` });
  }
}

export async function handleRemoveServer(interaction: ChatInputCommandInteraction): Promise<void> {
  if (!await requireRole(interaction, "avivadmin")) return;
  const server = await getServerForInteraction(interaction);
  if (!server) return;
  await db.deactivateServer(server.id);
  rconManager.dropConnection(server.id);
  await interaction.reply({ content: `Server ${server.server_number} removed.`, ephemeral: true });
}

export async function handleDiag(interaction: ChatInputCommandInteraction): Promise<void> {
  if (!await requireRole(interaction, "avivadmin")) return;
  if (!interaction.guild) return;
  await interaction.deferReply({ ephemeral: true });

  const servers = await db.getServersByGuild(interaction.guild.id);
  if (servers.length === 0) {
    await interaction.editReply({ content: "No servers configured." });
    return;
  }

  const lines: string[] = [];
  for (const srv of servers) {
    const status = rconManager.getStatus(srv.id);
    const ping = status === "connected" ? "OK" : "N/A";
    lines.push(`**Server ${srv.server_number}** (${srv.server_label}): ${status} | ${srv.rcon_host}:${srv.rcon_port} | ping: ${ping}`);
  }

  const embed = new EmbedBuilder()
    .setTitle("Aviv Bot Diagnostics")
    .setColor(0x5865f2)
    .setDescription(lines.join("\n"));

  await interaction.editReply({ embeds: [embed] });
}

export const CATEGORY_CONFIGS: Record<string, { label: string; keys: string[] }> = {
  kits: {
    label: "🎁 Kits Settings",
    keys: ["FREEkit","FREEkit-time","FREEkit-name","VIPkit","VIPkit-time","VIPkit-name","elitekit_use","elitekit_time","recyclers_use","recyclers_time","recyclers_uselist"],
  },
  economy: {
    label: "💰 Economy Settings",
    keys: ["currency_name","player_kill_points","scientist_kill_points","daily_min","daily_max","BountySystem","BountyReward","BountyMinKills","BountyScale"],
  },
  shop: {
    label: "🛒 Shop Settings",
    keys: ["shop_max_daily_spend","shop-universal"],
  },
  zorp: {
    label: "🛡️ ZORP Settings",
    keys: ["zorp","zorptime","zorpExpiryTime","zorpallowlist"],
  },
  teleports: {
    label: "🌀 Teleport Settings",
    keys: ["TPN_use","TPN_time","TPNE_use","TPE_use","TPSE_use","TPS_use","TPSW_use","TPW_use","TPNW_use","TPHOME_use","combatlock_use","combatlock_time"],
  },
  killfeed: {
    label: "⚔️ Kill Feed Settings",
    keys: ["KillFeedDiscord","KillFeedGame","KillFeedKD","MiscKills","ScientistKiller","ScientistVictim","killercolor","victimcolor","phrasecolor","killphrase","killphraserandomizer"],
  },
  moderation: {
    label: "🔨 Moderation Settings",
    keys: ["notemessaging"],
  },
  misc: {
    label: "⚙️ Other Settings",
    keys: ["chatbridge","scheduler","scheduler-time","SRP","recyclers_use"],
  },
};

export async function handleAviv(interaction: ChatInputCommandInteraction): Promise<void> {
  if (!await requireRole(interaction, "avivadmin")) return;
  if (!interaction.guild) return;
  await interaction.deferReply({ ephemeral: true });

  const servers = await db.getServersByGuild(interaction.guild.id);
  if (servers.length === 0) {
    await interaction.editReply({ content: "No servers configured. Use /setup then /add-server." });
    return;
  }

  const server = servers[0];
  const statusLine = servers.map(s => `Server ${s.server_number}: ${s.server_label} (${rconManager.getStatus(s.id)})`).join("\n");

  const embed = new EmbedBuilder()
    .setTitle("Aviv Bot Control Panel")
    .setColor(0x5865f2)
    .setDescription("Select a category below to view current settings. Use `/set [config] [value]` to change any setting.")
    .addFields(
      { name: "Active Servers", value: statusLine },
      { name: "Quick Reference", value: "`/set` - change a setting\n`/configs` - view all settings\n`/diag` - RCON health check\n`/admin-channels` - reassign channels" }
    );

  const row1 = new ActionRowBuilder<ButtonBuilder>().addComponents(
    new ButtonBuilder().setCustomId("aviv_kits").setLabel("Kits").setStyle(ButtonStyle.Secondary).setEmoji("🎁"),
    new ButtonBuilder().setCustomId("aviv_economy").setLabel("Economy").setStyle(ButtonStyle.Secondary).setEmoji("💰"),
    new ButtonBuilder().setCustomId("aviv_shop").setLabel("Shop").setStyle(ButtonStyle.Secondary).setEmoji("🛒"),
    new ButtonBuilder().setCustomId("aviv_zorp").setLabel("ZORP").setStyle(ButtonStyle.Secondary).setEmoji("🛡️"),
  );

  const row2 = new ActionRowBuilder<ButtonBuilder>().addComponents(
    new ButtonBuilder().setCustomId("aviv_teleports").setLabel("Teleports").setStyle(ButtonStyle.Secondary).setEmoji("🌀"),
    new ButtonBuilder().setCustomId("aviv_killfeed").setLabel("Kill Feed").setStyle(ButtonStyle.Secondary).setEmoji("⚔️"),
    new ButtonBuilder().setCustomId("aviv_moderation").setLabel("Moderation").setStyle(ButtonStyle.Secondary).setEmoji("🔨"),
    new ButtonBuilder().setCustomId("aviv_misc").setLabel("Other").setStyle(ButtonStyle.Secondary).setEmoji("⚙️"),
  );

  await interaction.editReply({ embeds: [embed], components: [row1, row2] });
}

export async function handleAvivButton(interaction: ButtonInteraction): Promise<void> {
  const category = interaction.customId.replace("aviv_", "");

  const catDef = CATEGORY_CONFIGS[category];
  if (!catDef) {
    await interaction.reply({ content: "Unknown category.", ephemeral: true });
    return;
  }

  const servers = await db.getServersByGuild(interaction.guildId ?? "").catch(() => []);
  const server = servers[0];
  if (!server) {
    await interaction.update({ content: "No server configured.", components: [] });
    return;
  }

  await interaction.deferReply({ ephemeral: true });

  const configs = await Promise.all(
    catDef.keys.map(async key => {
      const val = await db.getConfig(server.id, key);
      return `\`${key}\`: ${val ?? "*(not set)*"}`;
    })
  );

  const embed = new EmbedBuilder()
    .setTitle(catDef.label)
    .setColor(0x00d4aa)
    .setDescription(configs.join("\n") || "No settings found.")
    .setFooter({ text: "Use /set [config] [value] to change any setting." });

  await interaction.editReply({ embeds: [embed] });
}
