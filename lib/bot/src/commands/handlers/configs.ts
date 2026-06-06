import type { ChatInputCommandInteraction, AutocompleteInteraction } from "discord.js";
import { EmbedBuilder, MessageFlags } from "discord.js";
import * as db from "@workspace/db";
import { ALL_CONFIG_KEYS } from "../registry.js";
import { SETTING_CATEGORIES } from "./setup.js";
import { getServerForInteraction, requireRole } from "./utils.js";

// Build a key -> friendly display name map from SETTING_CATEGORIES
const CONFIG_FRIENDLY_NAMES: Record<string, string> = {};
for (const [, cat] of Object.entries(SETTING_CATEGORIES)) {
  for (const setting of cat.settings) {
    CONFIG_FRIENDLY_NAMES[setting.key] = `${cat.emoji} ${cat.label} | ${setting.label}`;
  }
}

function friendlyName(key: string): string {
  return CONFIG_FRIENDLY_NAMES[key] ?? key;
}

export async function handleSet(interaction: ChatInputCommandInteraction): Promise<void> {
  if (!await requireRole(interaction, "avivadmin")) return;
  const server = await getServerForInteraction(interaction);
  if (!server) return;

  const key = interaction.options.getString("config", true);
  const value = interaction.options.getString("value", true);

  if (!ALL_CONFIG_KEYS.includes(key)) {
    await interaction.reply({ content: `Unknown config key: **${key}**. Use autocomplete to pick a valid key.`, flags: MessageFlags.Ephemeral });
    return;
  }

  await db.setConfig(server.id, key, value);
  const friendly = CONFIG_FRIENDLY_NAMES[key];
  const label = friendly ? `**${friendly}**` : `\`${key}\``;
  await interaction.reply({ content: `Set ${label} = \`${value}\` on Server ${server.server_number}.`, flags: MessageFlags.Ephemeral });
}

export async function autocompleteSet(interaction: AutocompleteInteraction): Promise<void> {
  const focused = interaction.options.getFocused().toLowerCase();
  const choices = ALL_CONFIG_KEYS
    .filter(k => {
      const name = friendlyName(k).toLowerCase();
      return name.includes(focused) || k.toLowerCase().includes(focused);
    })
    .slice(0, 25)
    .map(k => ({ name: friendlyName(k).slice(0, 100), value: k }));
  await interaction.respond(choices);
}

export async function handleConfigs(interaction: ChatInputCommandInteraction): Promise<void> {
  if (!await requireRole(interaction, "avivadmin")) return;
  const server = await getServerForInteraction(interaction);
  if (!server) return;
  await interaction.deferReply({ flags: MessageFlags.Ephemeral });

  const configs = await db.getAllConfigs(server.id);
  if (configs.length === 0) {
    await interaction.editReply({ content: "No configs set yet. Use `/aviv` to configure with buttons, or `/set` to set a specific key." });
    return;
  }

  const chunks: string[] = [];
  let current = "";
  for (const c of configs) {
    const name = CONFIG_FRIENDLY_NAMES[c.config_key];
    const displayKey = name ? `${name}` : c.config_key;
    const line = `**${displayKey}**: \`${c.config_value}\`\n`;
    if (current.length + line.length > 3900) { chunks.push(current); current = ""; }
    current += line;
  }
  if (current) chunks.push(current);

  const embed = new EmbedBuilder()
    .setTitle(`Configuration — Server ${server.server_number} (${configs.length} settings)`)
    .setDescription(chunks[0] ?? "No configs")
    .setColor(0x5865f2)
    .setFooter({ text: "Use /aviv for the interactive settings panel." });

  await interaction.editReply({ embeds: [embed] });
}
