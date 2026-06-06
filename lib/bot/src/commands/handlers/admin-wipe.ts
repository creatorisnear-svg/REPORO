import type { ChatInputCommandInteraction } from "discord.js";
import { EmbedBuilder, MessageFlags } from "discord.js";
import * as db from "@workspace/db";
import { getServerForInteraction, requireRole } from "./utils.js";
import { rconManager } from "../../rcon/manager.js";

async function logCmd(interaction: ChatInputCommandInteraction, server: db.ServerRow, msg: string): Promise<void> {
  if (!interaction.guild) return;
  const channelId = await db.getChannel(server.id, "cmd-logs");
  if (!channelId) return;
  const ch = interaction.guild.channels.cache.get(channelId);
  if (ch && ch.isTextBased()) {
    await ch.send(`[ADMIN] ${interaction.user.tag}: ${msg}`).catch(() => null);
  }
}

async function sendRcon(server: db.ServerRow, cmd: string): Promise<{ ok: boolean; error?: string }> {
  if (!server.rcon_host) return { ok: false, error: "RCON not configured." };
  try {
    await rconManager.sendFireAndForget(server.id, server.rcon_host, server.rcon_port!, server.rcon_password!, cmd);
    return { ok: true };
  } catch (err) {
    return { ok: false, error: String(err) };
  }
}

function rconNote(r: { ok: boolean; error?: string }): string {
  return r.ok ? "" : `\n\n**RCON Warning:** ${r.error}`;
}

// ---- Wipe commands ----

export async function handleWipeClaims(interaction: ChatInputCommandInteraction): Promise<void> {
  if (!await requireRole(interaction, "avivadmin")) return;
  const server = await getServerForInteraction(interaction);
  if (!server) return;
  await interaction.deferReply({ flags: MessageFlags.Ephemeral });

  await db.wipeKitClaims(server.id);
  await logCmd(interaction, server, "wiped all kit claims");
  await interaction.editReply({ content: `All kit claim records wiped for Server ${server.server_number}. Players can claim kits again immediately.` });
}

export async function handleWipeKills(interaction: ChatInputCommandInteraction): Promise<void> {
  if (!await requireRole(interaction, "avivadmin")) return;
  const server = await getServerForInteraction(interaction);
  if (!server) return;
  await interaction.deferReply({ flags: MessageFlags.Ephemeral });

  await db.wipeKills(server.id);
  await logCmd(interaction, server, "wiped all kill counts");
  await interaction.editReply({ content: `All kill counts reset to 0 for Server ${server.server_number}.` });
}

export async function handleWipeTpHome(interaction: ChatInputCommandInteraction): Promise<void> {
  if (!await requireRole(interaction, "avivadmin")) return;
  const server = await getServerForInteraction(interaction);
  if (!server) return;
  await interaction.deferReply({ flags: MessageFlags.Ephemeral });

  await db.wipeTpHomes(server.id);
  await logCmd(interaction, server, "wiped all TP homes");
  await interaction.editReply({ content: `All TP home records wiped for Server ${server.server_number}.` });
}

export async function handleWipeShopTimers(interaction: ChatInputCommandInteraction): Promise<void> {
  if (!await requireRole(interaction, "avivadmin")) return;
  const server = await getServerForInteraction(interaction);
  if (!server) return;
  await interaction.deferReply({ flags: MessageFlags.Ephemeral });

  await db.wipeShopTimers(server.id);
  await logCmd(interaction, server, "wiped all shop timers");
  await interaction.editReply({ content: `All shop purchase cooldowns wiped for Server ${server.server_number}.` });
}

export async function handleWipePositions(interaction: ChatInputCommandInteraction): Promise<void> {
  if (!await requireRole(interaction, "avivadmin")) return;
  const server = await getServerForInteraction(interaction);
  if (!server) return;
  await interaction.deferReply({ flags: MessageFlags.Ephemeral });

  const posType = interaction.options.getString("type", true);
  await db.clearTpPositions(server.id, posType);
  await logCmd(interaction, server, `wiped all positions for type: ${posType}`);
  await interaction.editReply({ content: `All **${posType}** positions cleared for Server ${server.server_number}.` });
}

export async function handleClearList(interaction: ChatInputCommandInteraction): Promise<void> {
  if (!await requireRole(interaction, "avivadmin")) return;
  const server = await getServerForInteraction(interaction);
  if (!server) return;
  await interaction.deferReply({ flags: MessageFlags.Ephemeral });

  const listName = interaction.options.getString("list", true);
  await db.clearAllFromList(server.id, listName);
  await logCmd(interaction, server, `cleared list: ${listName}`);
  await interaction.editReply({ content: `All entries removed from list **${listName}** on Server ${server.server_number}.` });
}

// ---- Banboom / Unbanboom ----

export async function handleBanboom(interaction: ChatInputCommandInteraction): Promise<void> {
  if (!await requireRole(interaction, "avivadmin")) return;
  const server = await getServerForInteraction(interaction);
  if (!server) return;
  await interaction.deferReply({ flags: MessageFlags.Ephemeral });

  const reason = interaction.options.getString("reason") ?? "Server maintenance";

  if (!server.rcon_host) {
    await interaction.editReply({ content: "RCON not configured for this server." });
    return;
  }

  try {
    const playerListRaw = await rconManager.sendCommand(
      server.id, server.rcon_host, server.rcon_port!, server.rcon_password!, "playerlist"
    );
    const lines = playerListRaw.split("\n").filter(l => l.trim());
    const names: string[] = [];
    for (const line of lines) {
      const nameMatch = line.match(/^\s*(.+?)\s+\/\s+\d+\s+\//);
      if (nameMatch) names.push(nameMatch[1].trim());
    }

    if (names.length === 0) {
      await interaction.editReply({ content: "No players currently online to ban." });
      return;
    }

    for (const name of names) {
      await rconManager.sendFireAndForget(
        server.id, server.rcon_host, server.rcon_port!, server.rcon_password!, `global.ban "${name}" 0 "${reason}"`
      ).catch(() => null);
    }

    await logCmd(interaction, server, `banboom — banned ${names.length} players`);
    await interaction.editReply({ content: `Banned **${names.length}** online player(s). Reason: ${reason}` });
  } catch {
    await interaction.editReply({ content: "Failed to retrieve player list from RCON." });
  }
}

export async function handleUnbanboom(interaction: ChatInputCommandInteraction): Promise<void> {
  if (!await requireRole(interaction, "avivadmin")) return;
  const server = await getServerForInteraction(interaction);
  if (!server) return;
  await interaction.deferReply({ flags: MessageFlags.Ephemeral });

  const result = await sendRcon(server, "unbanall");
  await logCmd(interaction, server, "unbanboom — unban all");
  await interaction.editReply({
    content: `Sent unban-all command to Server ${server.server_number}.${rconNote(result)}`,
  });
}

// ---- Timed restart ----

export async function handleTimedrestart(interaction: ChatInputCommandInteraction): Promise<void> {
  if (!await requireRole(interaction, "avivadmin")) return;
  const server = await getServerForInteraction(interaction);
  if (!server) return;
  await interaction.deferReply({ flags: MessageFlags.Ephemeral });

  const minutes = interaction.options.getInteger("minutes", true);

  if (!server.rcon_host) {
    await interaction.editReply({ content: "RCON not configured for this server." });
    return;
  }

  const warningMsg = `Server is restarting in ${minutes} minute(s). Save your progress!`;
  await sendRcon(server, `global.say "${warningMsg}"`);

  setTimeout(async () => {
    await sendRcon(server, "quit");
  }, minutes * 60_000);

  await logCmd(interaction, server, `scheduled restart in ${minutes} minute(s)`);
  await interaction.editReply({
    content: `Server ${server.server_number} will restart in **${minutes} minute(s)**. Warning sent to players.`,
  });
}

// ---- Delay claims ----

export async function handleDelayClaims(interaction: ChatInputCommandInteraction): Promise<void> {
  if (!await requireRole(interaction, "avivadmin")) return;
  const server = await getServerForInteraction(interaction);
  if (!server) return;
  await interaction.deferReply({ flags: MessageFlags.Ephemeral });

  const hours = interaction.options.getInteger("hours", true);
  const resumeAt = new Date(Date.now() + hours * 3600_000).toISOString();

  await db.setConfig(server.id, "claims_delayed_until", resumeAt);
  await logCmd(interaction, server, `delayed kit claims for ${hours}h`);
  await interaction.editReply({
    content: `Kit claims delayed for **${hours} hour(s)** on Server ${server.server_number}. Resumes at <t:${Math.floor(new Date(resumeAt).getTime() / 1000)}:T>.`,
  });
}

// ---- Auto Events ----

export async function handleTriggerEvent(interaction: ChatInputCommandInteraction): Promise<void> {
  if (!await requireRole(interaction, "avivmod")) return;
  const server = await getServerForInteraction(interaction);
  if (!server) return;
  await interaction.deferReply({ flags: MessageFlags.Ephemeral });

  const eventNum = interaction.options.getInteger("event", true);

  if (!server.rcon_host) {
    await interaction.editReply({ content: "RCON not configured for this server." });
    return;
  }

  const eventType = await db.getConfig(server.id, `event${eventNum}_type`) ?? "crate";
  const posType = `${eventType}${eventNum}`;
  const positions = await db.getTpPositions(server.id, posType);

  if (positions.length === 0) {
    await interaction.editReply({ content: `No positions configured for event ${eventNum} (type: ${eventType}). Use \`/admin-positions add type:${posType}\` to add some.` });
    return;
  }

  const pos = positions[Math.floor(Math.random() * positions.length)];

  const cmd = eventType === "airdrop" ? "supply.call" : "supply.drop";
  const result = await sendRcon(server, cmd);

  const msgs = await Promise.all([1, 2, 3].map(n => db.getConfig(server.id, `event${eventNum}_msg${n}`)));
  const validMsgs = msgs.filter(Boolean) as string[];
  const announceMsg = validMsgs.length > 0 ? validMsgs[Math.floor(Math.random() * validMsgs.length)] : null;

  if (announceMsg && server.rcon_host) {
    await sendRcon(server, `global.say "${announceMsg}"`);
  }

  if (interaction.guild) {
    const channelId = await db.getChannel(server.id, "events").catch(() => null);
    if (channelId) {
      const ch = interaction.guild.channels.cache.get(channelId);
      if (ch && ch.isTextBased()) {
        const icon = eventType === "airdrop" ? "\u{1F6E9}" : "\u{1F4E6}";
        await ch.send(`${icon} **Event ${eventNum} triggered!** (${eventType} at ${pos.x}, ${pos.y}, ${pos.z})${announceMsg ? `\n> ${announceMsg}` : ""}`).catch(() => null);
      }
    }
  }

  await logCmd(interaction, server, `manually triggered event ${eventNum} (${eventType})`);
  await interaction.editReply({
    content: `Event ${eventNum} triggered! Spawned **${eventType}** at (${pos.x}, ${pos.y}, ${pos.z}).${rconNote(result)}`,
  });
}

export async function handleClearAnEvent(interaction: ChatInputCommandInteraction): Promise<void> {
  if (!await requireRole(interaction, "avivadmin")) return;
  const server = await getServerForInteraction(interaction);
  if (!server) return;
  await interaction.deferReply({ flags: MessageFlags.Ephemeral });

  const eventNum = interaction.options.getInteger("event", true);
  const eventType = interaction.options.getString("type") ?? await db.getConfig(server.id, `event${eventNum}_type`) ?? "crate";
  const posType = `${eventType}${eventNum}`;

  await db.clearTpPositions(server.id, posType);
  await logCmd(interaction, server, `cleared event ${eventNum} position list (${posType})`);
  await interaction.editReply({
    content: `All **${eventType}** positions for event **${eventNum}** cleared on Server ${server.server_number}.`,
  });
}

export async function handleSetLeaderboard(interaction: ChatInputCommandInteraction): Promise<void> {
  if (!await requireRole(interaction, "avivadmin")) return;
  const server = await getServerForInteraction(interaction);
  if (!server) return;
  await interaction.deferReply({ flags: MessageFlags.Ephemeral });

  const type = interaction.options.getString("type", true);
  const channel = interaction.options.getChannel("channel", true);

  await db.setChannel(server.id, `leaderboard-${type}`, channel.id);
  await logCmd(interaction, server, `set ${type} leaderboard channel to ${channel.id}`);
  await interaction.editReply({
    content: `**${type}** leaderboard will be posted in <#${channel.id}> on Server ${server.server_number}.`,
  });
}
