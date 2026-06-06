import type { ChatInputCommandInteraction, AutocompleteInteraction } from "discord.js";
import { EmbedBuilder } from "discord.js";
import * as db from "@workspace/db";
import { ALL_CONFIG_KEYS } from "../registry.js";
import { getServerForInteraction, requireRole } from "./utils.js";

export async function handleSet(interaction: ChatInputCommandInteraction): Promise<void> {
  if (!await requireRole(interaction, "avivadmin")) return;
  const server = await getServerForInteraction(interaction);
  if (!server) return;

  const key = interaction.options.getString("config", true);
  const value = interaction.options.getString("value", true);

  if (!ALL_CONFIG_KEYS.includes(key)) {
    await interaction.reply({ content: `Unknown config key: **${key}**. Use autocomplete to pick a valid key.`, ephemeral: true });
    return;
  }

  await db.setConfig(server.id, key, value);
  await interaction.reply({ content: `Set **${key}** = \`${value}\` on Server ${server.server_number}.`, ephemeral: true });
}

export async function autocompleteSet(interaction: AutocompleteInteraction): Promise<void> {
  const focused = interaction.options.getFocused().toLowerCase();
  const choices = ALL_CONFIG_KEYS
    .filter(k => k.toLowerCase().includes(focused))
    .slice(0, 25)
    .map(k => ({ name: k, value: k }));
  await interaction.respond(choices);
}

export async function handleConfigs(interaction: ChatInputCommandInteraction): Promise<void> {
  if (!await requireRole(interaction, "avivadmin")) return;
  const server = await getServerForInteraction(interaction);
  if (!server) return;
  await interaction.deferReply({ ephemeral: true });

  const configs = await db.getAllConfigs(server.id);
  if (configs.length === 0) {
    await interaction.editReply({ content: "No configs set yet. Use /set to configure settings." });
    return;
  }

  const chunks: string[] = [];
  let current = "";
  for (const c of configs) {
    const line = `**${c.config_key}**: ${c.config_value}\n`;
    if (current.length + line.length > 3900) { chunks.push(current); current = ""; }
    current += line;
  }
  if (current) chunks.push(current);

  const embed = new EmbedBuilder()
    .setTitle(`Configuration — Server ${server.server_number} (${configs.length} keys)`)
    .setDescription(chunks[0] ?? "No configs")
    .setColor(0x5865f2);

  await interaction.editReply({ embeds: [embed] });
}
