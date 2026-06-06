import type { ChatInputCommandInteraction } from "discord.js";
import { EmbedBuilder } from "discord.js";
import * as db from "@workspace/db";
import { getServerForInteraction, requireRole } from "./utils.js";

export async function handleRaidlink(interaction: ChatInputCommandInteraction): Promise<void> {
  const server = await getServerForInteraction(interaction);
  if (!server) return;
  await interaction.deferReply({ ephemeral: true });

  const ingameName = interaction.options.getString("ingame_name", true).trim();
  const frequency = interaction.options.getString("frequency", true).trim();

  const existingPlayer = await db.getPlayerByDiscord(server.id, interaction.user.id);
  if (existingPlayer && existingPlayer.ingame_name !== ingameName) {
    await interaction.editReply({ content: `Your linked name is **${existingPlayer.ingame_name}**. Use that name or /link first.` });
    return;
  }

  await db.upsertRaidLink(server.id, ingameName, frequency, interaction.user.id);
  await interaction.editReply({ content: `Registered frequency **${frequency}** for **${ingameName}**. You will be DM'd when your base is being raided.` });
}

export async function handleListRaidlink(interaction: ChatInputCommandInteraction): Promise<void> {
  if (!await requireRole(interaction, "avivmod")) return;
  const server = await getServerForInteraction(interaction);
  if (!server) return;
  await interaction.deferReply({ ephemeral: true });

  const links = await db.getAllRaidLinks(server.id);
  if (links.length === 0) {
    await interaction.editReply({ content: "No raid links registered." });
    return;
  }

  const desc = links.map(l => `**${l.ingame_name}** — freq: \`${l.frequency}\` — <@${l.discord_user_id}>`).join("\n");
  const embed = new EmbedBuilder()
    .setTitle(`Raid Links — Server ${server.server_number} (${links.length})`)
    .setDescription(desc.substring(0, 4096))
    .setColor(0xe74c3c);

  await interaction.editReply({ embeds: [embed] });
}

export async function handleListRaidalert(interaction: ChatInputCommandInteraction): Promise<void> {
  if (!await requireRole(interaction, "avivmod")) return;
  const server = await getServerForInteraction(interaction);
  if (!server) return;
  await interaction.deferReply({ ephemeral: true });

  // Show currently registered raid links as "active alert subscriptions"
  const links = await db.getAllRaidLinks(server.id);
  const embed = new EmbedBuilder()
    .setTitle(`Active Raid Alert Subscriptions — Server ${server.server_number}`)
    .setDescription(links.length > 0 ? `${links.length} player(s) subscribed to raid alerts.` : "No subscribers.")
    .setColor(0xe74c3c);

  await interaction.editReply({ embeds: [embed] });
}

export async function handleWipeRaidlink(interaction: ChatInputCommandInteraction): Promise<void> {
  if (!await requireRole(interaction, "avivadmin")) return;
  const server = await getServerForInteraction(interaction);
  if (!server) return;
  await interaction.deferReply({ ephemeral: true });

  const links = await db.getAllRaidLinks(server.id);
  for (const link of links) {
    await db.deleteRaidLink(server.id, link.ingame_name);
  }
  await interaction.editReply({ content: `Cleared ${links.length} raid link(s) on Server ${server.server_number}.` });
}

export async function handleDelRaidlink(interaction: ChatInputCommandInteraction): Promise<void> {
  if (!await requireRole(interaction, "avivadmin")) return;
  const server = await getServerForInteraction(interaction);
  if (!server) return;

  const ingameName = interaction.options.getString("ingame_name", true);
  await db.deleteRaidLink(server.id, ingameName);
  await interaction.reply({ content: `Removed raid link for **${ingameName}**.`, ephemeral: true });
}
