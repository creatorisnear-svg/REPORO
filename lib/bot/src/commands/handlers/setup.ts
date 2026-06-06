import type { ChatInputCommandInteraction } from "discord.js";
import { PermissionFlagsBits, ChannelType, EmbedBuilder } from "discord.js";
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

  // Create roles
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

  // Create channels
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

  // Create voice channel for player count
  const voiceName = "| Server 1 0 / 0";
  const existingVoice = guild.channels.cache.find(c => c.name.startsWith("| Server 1"));
  if (!existingVoice) {
    await guild.channels.create({ name: voiceName, type: ChannelType.GuildVoice, reason: "Aviv Bot setup" });
    lines.push("Created voice channel: player count");
  }

  // Check if server already in DB
  const servers = await db.getServersByGuild(guild.id);
  if (servers.length === 0) {
    lines.push("No server configured yet. Use /add-server to add your Rust server RCON details.");
  } else {
    // Save channel assignments
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

  // Verify customer exists
  // For setup, we allow any admin to add server (we trust the guild admin)
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

  // Test RCON connection
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

export async function handleAviv(interaction: ChatInputCommandInteraction): Promise<void> {
  if (!await requireRole(interaction, "avivadmin")) return;
  if (!interaction.guild) return;
  await interaction.deferReply({ ephemeral: true });

  const servers = await db.getServersByGuild(interaction.guild.id);
  if (servers.length === 0) {
    await interaction.editReply({ content: "No servers configured. Use /setup then /add-server." });
    return;
  }

  const embed = new EmbedBuilder()
    .setTitle("Aviv Bot Control Panel")
    .setColor(0x5865f2)
    .addFields(
      { name: "Servers", value: servers.map(s => `Server ${s.server_number}: ${s.server_label} (${rconManager.getStatus(s.id)})`).join("\n") },
      { name: "Quick Commands", value: "/set - change settings\n/configs - view all settings\n/diag - check RCON health" }
    );

  await interaction.editReply({ embeds: [embed] });
}
