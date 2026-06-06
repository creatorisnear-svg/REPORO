import type { ChatInputCommandInteraction, ButtonInteraction } from "discord.js";
import { PermissionFlagsBits, ChannelType, EmbedBuilder, ActionRowBuilder, ButtonBuilder, ButtonStyle, MessageFlags } from "discord.js";
import * as db from "@workspace/db";
import { rconManager } from "../../rcon/manager.js";
import { getServerForInteraction, requireRole, hasRole } from "./utils.js";

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

  await interaction.deferReply({ flags: MessageFlags.Ephemeral });

  let host = interaction.options.getString("host", true).trim();
  const port = interaction.options.getInteger("port", true);
  const password = interaction.options.getString("password", true);
  const serverNum = interaction.options.getInteger("server") ?? 1;
  const label = interaction.options.getString("label") ?? `Server ${serverNum}`;
  const guildId = interaction.guild.id;

  // If the user accidentally typed "ip:port" in the host field, strip the port part
  const hostPortMatch = host.match(/^(.+):(\d+)$/);
  if (hostPortMatch) {
    host = hostPortMatch[1]!;
    console.warn(`[AddServer] Host contained port (${hostPortMatch[2]}) — stripped. Using host: ${host}, port: ${port}`);
  }

  // Check subscription server limit (skipped when BYPASS_SUB=true)
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

  // Check if server number is already taken
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

  // Reply with success immediately - RCON connection happens in background
  await interaction.editReply({
    content: `Server **${serverNum}** (${label}) added!\nAttempting RCON connection in the background. Use \`/diag\` to check connection status.`,
  });

  // Fire-and-forget RCON connection test - just checks that the WebSocket can open
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
  if (!interaction.guild) return;
  // Defer immediately — must happen within Discord's 3-second window before any async checks
  await interaction.deferReply({ flags: MessageFlags.Ephemeral });
  if (!hasRole(interaction, "avivadmin")) {
    await interaction.editReply({ content: "You need the **avivadmin** role to use this command." });
    return;
  }

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
    await interaction.reply({ content: "Unknown category.", flags: MessageFlags.Ephemeral });
    return;
  }

  const servers = await db.getServersByGuild(interaction.guildId ?? "").catch(() => []);
  const server = servers[0];
  if (!server) {
    await interaction.update({ content: "No server configured.", components: [] });
    return;
  }

  await interaction.deferReply({ flags: MessageFlags.Ephemeral });

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
