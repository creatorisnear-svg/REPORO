import type { ChatInputCommandInteraction } from "discord.js";
import { EmbedBuilder } from "discord.js";
import * as db from "@workspace/db";
import { getServerForInteraction, requireRole } from "./utils.js";
import { rconManager } from "../../rcon/manager.js";

async function logCmd(interaction: ChatInputCommandInteraction, server: db.ServerRow, msg: string): Promise<void> {
  if (!interaction.guild) return;
  const channelId = await db.getChannel(server.id, "cmd-logs");
  if (!channelId) return;
  const ch = interaction.guild.channels.cache.get(channelId);
  if (ch && ch.isTextBased()) {
    await ch.send(`[MOD] ${interaction.user.tag}: ${msg}`).catch(() => null);
  }
}

async function rcon(server: db.ServerRow, cmd: string): Promise<void> {
  if (!server.rcon_host) return;
  await rconManager.sendCommand(server.id, server.rcon_host, server.rcon_port!, server.rcon_password!, cmd).catch(() => null);
}

export async function handleKick(interaction: ChatInputCommandInteraction): Promise<void> {
  if (!await requireRole(interaction, "avivmod")) return;
  const server = await getServerForInteraction(interaction);
  if (!server) return;

  const ingameName = interaction.options.getString("ingame_name", true);
  const reason = interaction.options.getString("reason") ?? "No reason given";

  await rcon(server, `kick ${ingameName} "${reason}"`);
  await logCmd(interaction, server, `kicked **${ingameName}** — ${reason}`);
  await interaction.reply({ content: `Kicked **${ingameName}** (${reason}).`, ephemeral: true });
}

export async function handleBan(interaction: ChatInputCommandInteraction): Promise<void> {
  if (!await requireRole(interaction, "avivmod")) return;
  const server = await getServerForInteraction(interaction);
  if (!server) return;

  const ingameName = interaction.options.getString("ingame_name", true);
  const reason = interaction.options.getString("reason") ?? "No reason given";

  await rcon(server, `ban ${ingameName} "${reason}"`);
  await logCmd(interaction, server, `banned **${ingameName}** — ${reason}`);
  await interaction.reply({ content: `Banned **${ingameName}** (${reason}).`, ephemeral: true });
}

export async function handleUnban(interaction: ChatInputCommandInteraction): Promise<void> {
  if (!await requireRole(interaction, "avivmod")) return;
  const server = await getServerForInteraction(interaction);
  if (!server) return;

  const ingameName = interaction.options.getString("ingame_name", true);
  await rcon(server, `unban ${ingameName}`);
  await logCmd(interaction, server, `unbanned **${ingameName}**`);
  await interaction.reply({ content: `Unbanned **${ingameName}**.`, ephemeral: true });
}

export async function handleMute(interaction: ChatInputCommandInteraction): Promise<void> {
  if (!await requireRole(interaction, "avivmod")) return;
  const server = await getServerForInteraction(interaction);
  if (!server) return;

  const ingameName = interaction.options.getString("ingame_name", true);
  await rcon(server, `mute ${ingameName}`);
  await logCmd(interaction, server, `muted **${ingameName}**`);
  await interaction.reply({ content: `Muted **${ingameName}**.`, ephemeral: true });
}

export async function handleUnmute(interaction: ChatInputCommandInteraction): Promise<void> {
  if (!await requireRole(interaction, "avivmod")) return;
  const server = await getServerForInteraction(interaction);
  if (!server) return;

  const ingameName = interaction.options.getString("ingame_name", true);
  await rcon(server, `unmute ${ingameName}`);
  await logCmd(interaction, server, `unmuted **${ingameName}**`);
  await interaction.reply({ content: `Unmuted **${ingameName}**.`, ephemeral: true });
}

export async function handleWarn(interaction: ChatInputCommandInteraction): Promise<void> {
  if (!await requireRole(interaction, "avivmod")) return;
  const server = await getServerForInteraction(interaction);
  if (!server) return;

  const ingameName = interaction.options.getString("ingame_name", true);
  const reason = interaction.options.getString("reason", true);

  await db.addWarning(server.id, ingameName, reason);
  const allWarnings = await db.getWarnings(server.id, ingameName);

  await rcon(server, `say ${ingameName} has received a warning: ${reason}`);
  await logCmd(interaction, server, `warned **${ingameName}** (${allWarnings.length} total) — ${reason}`);
  await interaction.reply({ content: `Warning issued to **${ingameName}** (${allWarnings.length} total). Reason: ${reason}`, ephemeral: true });
}

export async function handleWarnings(interaction: ChatInputCommandInteraction): Promise<void> {
  if (!await requireRole(interaction, "avivmod")) return;
  const server = await getServerForInteraction(interaction);
  if (!server) return;

  const ingameName = interaction.options.getString("ingame_name", true);
  const warnings = await db.getWarnings(server.id, ingameName);

  if (warnings.length === 0) {
    await interaction.reply({ content: `**${ingameName}** has no warnings.`, ephemeral: true });
    return;
  }

  const desc = warnings.map((w, i) => `**${i + 1}.** ${w.reason} (${new Date(w.issued_at).toLocaleDateString()})`).join("\n");
  const embed = new EmbedBuilder()
    .setTitle(`Warnings: ${ingameName}`)
    .setDescription(desc)
    .setColor(0xe74c3c);
  await interaction.reply({ embeds: [embed], ephemeral: true });
}

export async function handleClearwarnings(interaction: ChatInputCommandInteraction): Promise<void> {
  if (!await requireRole(interaction, "avivadmin")) return;
  const server = await getServerForInteraction(interaction);
  if (!server) return;

  const ingameName = interaction.options.getString("ingame_name", true);
  await db.clearWarnings(server.id, ingameName);
  await logCmd(interaction, server, `cleared warnings for **${ingameName}**`);
  await interaction.reply({ content: `Cleared all warnings for **${ingameName}**.`, ephemeral: true });
}
