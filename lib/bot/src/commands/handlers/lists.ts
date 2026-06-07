import type { ChatInputCommandInteraction } from "discord.js";
import { EmbedBuilder, MessageFlags } from "discord.js";
import * as db from "@workspace/db";
import { getServerForInteraction, requireRole } from "./utils.js";
import { rconManager } from "../../rcon/manager.js";

export async function handleAddToList(interaction: ChatInputCommandInteraction): Promise<void> {
  if (!await requireRole(interaction, "avivmod")) return;
  const server = await getServerForInteraction(interaction);
  if (!server) return;

  const listName = interaction.options.getString("list", true).trim();
  const ingameName = interaction.options.getString("ingame_name", true).trim();

  await db.addToList(server.id, listName, ingameName);

  // Sync to RCON if server is connected
  if (server.rcon_host) {
    const listRconCmds: Record<string, string> = {
      "viplist": `addto viplist "${ingameName}"`,
      "zorpallowlist": `addto zorpallowlist "${ingameName}"`,
      "zorpbanlist": `addto zorpbanlist "${ingameName}"`,
      "prisonlist": `addto prisonlist "${ingameName}"`,
      "recyclerlist": `addto recyclerlist "${ingameName}"`,
      "noteblocklist": `addto noteblocklist "${ingameName}"`,
    };
    const cmd = listRconCmds[listName] ?? (listName.startsWith("elitelist") ? `addto ${listName} "${ingameName}"` : null);
    if (cmd) {
      await rconManager.sendFireAndForget(server.id, server.rcon_host, server.rcon_port!, server.rcon_password!, cmd).catch(() => null);
    }
  }

  await interaction.reply({ content: `Added **${ingameName}** to **${listName}** on Server ${server.server_number}.`, flags: MessageFlags.Ephemeral });
}

export async function handleRemoveFromList(interaction: ChatInputCommandInteraction): Promise<void> {
  if (!await requireRole(interaction, "avivmod")) return;
  const server = await getServerForInteraction(interaction);
  if (!server) return;

  const listName = interaction.options.getString("list", true).trim();
  const ingameName = interaction.options.getString("ingame_name", true).trim();

  await db.removeFromList(server.id, listName, ingameName);

  if (server.rcon_host) {
    await rconManager.sendFireAndForget(server.id, server.rcon_host, server.rcon_port!, server.rcon_password!, `removefrom ${listName} "${ingameName}"`).catch(() => null);
  }

  await interaction.reply({ content: `Removed **${ingameName}** from **${listName}** on Server ${server.server_number}.`, flags: MessageFlags.Ephemeral });
}

export async function handleAddVip(interaction: ChatInputCommandInteraction): Promise<void> {
  if (!await requireRole(interaction, "avivmod")) return;
  const server = await getServerForInteraction(interaction);
  if (!server) return;

  const ingameName = interaction.options.getString("ingame_name", true).trim();

  await db.addToList(server.id, "viplist", ingameName);

  if (server.rcon_host) {
    await rconManager.sendFireAndForget(
      server.id, server.rcon_host, server.rcon_port!, server.rcon_password!,
      `addto viplist "${ingameName}"`
    ).catch(() => null);
  }

  await interaction.reply({
    content: `✅ Added **${ingameName}** to the VIP list on Server ${server.server_number}.`,
    flags: MessageFlags.Ephemeral,
  });
}

export async function handleRemoveVip(interaction: ChatInputCommandInteraction): Promise<void> {
  if (!await requireRole(interaction, "avivmod")) return;
  const server = await getServerForInteraction(interaction);
  if (!server) return;

  const ingameName = interaction.options.getString("ingame_name", true).trim();

  await db.removeFromList(server.id, "viplist", ingameName);

  if (server.rcon_host) {
    await rconManager.sendFireAndForget(
      server.id, server.rcon_host, server.rcon_port!, server.rcon_password!,
      `removefrom viplist "${ingameName}"`
    ).catch(() => null);
  }

  await interaction.reply({
    content: `Removed **${ingameName}** from the VIP list on Server ${server.server_number}.`,
    flags: MessageFlags.Ephemeral,
  });
}

export async function handleGetList(interaction: ChatInputCommandInteraction): Promise<void> {
  if (!await requireRole(interaction, "avivmod")) return;
  const server = await getServerForInteraction(interaction);
  if (!server) return;

  await interaction.deferReply({ flags: MessageFlags.Ephemeral });

  const listName = interaction.options.getString("list", true).trim();
  const entries = await db.getList(server.id, listName);

  if (entries.length === 0) {
    await interaction.editReply({ content: `**${listName}** is empty.` });
    return;
  }

  const chunks: string[] = [];
  let current = "";
  for (const e of entries) {
    const line = `${e.ingame_name}\n`;
    if (current.length + line.length > 3900) { chunks.push(current); current = ""; }
    current += line;
  }
  if (current) chunks.push(current);

  const embed = new EmbedBuilder()
    .setTitle(`${listName} (${entries.length} entries) — Server ${server.server_number}`)
    .setDescription(chunks[0] ?? "Empty")
    .setColor(0x5865f2);

  await interaction.editReply({ embeds: [embed] });
}
