import type { ChatInputCommandInteraction } from "discord.js";
import { EmbedBuilder, MessageFlags } from "discord.js";
import * as db from "@workspace/db";
import { getServerForInteraction, requireRole } from "./utils.js";
import { rconManager } from "../../rcon/manager.js";

export async function handlePrison(interaction: ChatInputCommandInteraction): Promise<void> {
  if (!await requireRole(interaction, "avivmod")) return;
  const server = await getServerForInteraction(interaction);
  if (!server) return;
  await interaction.deferReply({ flags: MessageFlags.Ephemeral });

  const ingameName = interaction.options.getString("ingame_name", true);
  const duration = interaction.options.getInteger("duration", true);
  const reason = interaction.options.getString("reason") ?? "No reason given";

  await db.addToPrison(server.id, ingameName, reason, duration);

  const positions = await db.getTpPositions(server.id, "prison");
  if (positions.length > 0 && server.rcon_host) {
    const pos = positions[0];
    await rconManager.sendFireAndForget(server.id, server.rcon_host, server.rcon_port!, server.rcon_password!,
      `teleportpos ${ingameName} ${pos.x} ${pos.y} ${pos.z}`).catch(() => null);
  }

  // DM the linked player
  if (interaction.guild) {
    const player = await db.getPlayerByIngameName(server.id, ingameName);
    if (player) {
      try {
        const member = await interaction.guild.members.fetch(player.discord_user_id);
        await member.send(`You have been sent to prison on Server ${server.server_number} for ${duration} minute(s). Reason: ${reason}`);
      } catch { /* DMs may be closed */ }
    }
  }

  const logsId = await db.getChannel(server.id, "logs");
  if (logsId && interaction.guild) {
    const ch = interaction.guild.channels.cache.get(logsId);
    if (ch && ch.isTextBased()) {
      await ch.send(`[PRISON] ${interaction.user.tag} imprisoned **${ingameName}** for ${duration}m. Reason: ${reason}`).catch(() => null);
    }
  }

  await interaction.editReply({ content: `**${ingameName}** imprisoned for ${duration} minute(s). Reason: ${reason}` });
}

export async function handleUnprison(interaction: ChatInputCommandInteraction): Promise<void> {
  if (!await requireRole(interaction, "avivmod")) return;
  const server = await getServerForInteraction(interaction);
  if (!server) return;

  const ingameName = interaction.options.getString("ingame_name", true);
  await db.releasePrisoner(server.id, ingameName);

  const logsId = await db.getChannel(server.id, "logs");
  if (logsId && interaction.guild) {
    const ch = interaction.guild.channels.cache.get(logsId);
    if (ch && ch.isTextBased()) {
      await ch.send(`[PRISON] ${interaction.user.tag} released **${ingameName}** early.`).catch(() => null);
    }
  }

  await interaction.reply({ content: `**${ingameName}** released from prison.`, flags: MessageFlags.Ephemeral });
}

export async function handlePrisonList(interaction: ChatInputCommandInteraction): Promise<void> {
  if (!await requireRole(interaction, "avivmod")) return;
  const server = await getServerForInteraction(interaction);
  if (!server) return;
  await interaction.deferReply({ flags: MessageFlags.Ephemeral });

  const prisoners = await db.getActivePrisoners(server.id);
  if (prisoners.length === 0) {
    await interaction.editReply({ content: "No active prisoners." });
    return;
  }

  const desc = prisoners.map(p =>
    `**${p.ingame_name}** — until ${new Date(p.release_at).toLocaleString()} — ${p.reason}`
  ).join("\n");

  const embed = new EmbedBuilder()
    .setTitle(`Active Prisoners — Server ${server.server_number}`)
    .setDescription(desc)
    .setColor(0xe74c3c);

  await interaction.editReply({ embeds: [embed] });
}
