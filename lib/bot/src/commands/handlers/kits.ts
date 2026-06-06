import type { ChatInputCommandInteraction, AutocompleteInteraction } from "discord.js";
import { EmbedBuilder, MessageFlags } from "discord.js";
import * as db from "@workspace/db";
import { getServerForInteraction, requireRole, autocompleteKitNameForGuild, autocompleteIngameNameForGuild } from "./utils.js";
import { rconManager } from "../../rcon/manager.js";

export async function handleGivekit(interaction: ChatInputCommandInteraction): Promise<void> {
  if (!await requireRole(interaction, "avivadmin")) return;
  const server = await getServerForInteraction(interaction);
  if (!server) return;

  await interaction.deferReply({ flags: MessageFlags.Ephemeral });

  const ingameName = interaction.options.getString("ingame_name", true).trim();
  const kitName = interaction.options.getString("kit_name", true).trim();

  if (!server.rcon_host) {
    await interaction.editReply({ content: "RCON not configured for this server." });
    return;
  }

  try {
    await rconManager.sendFireAndForget(server.id, server.rcon_host, server.rcon_port!, server.rcon_password!, `kit givetoplayer "${kitName}" "${ingameName}"`);
    const logsChannelId = await db.getChannel(server.id, "cmd-logs");
    if (logsChannelId && interaction.guild) {
      const ch = interaction.guild.channels.cache.get(logsChannelId);
      if (ch && ch.isTextBased()) {
        await ch.send(`[CMD] ${interaction.user.tag} used /givekit: **${ingameName}** got **${kitName}** on Server ${server.server_number}`);
      }
    }
    await interaction.editReply({ content: `Gave kit **${kitName}** to **${ingameName}** on Server ${server.server_number}.` });
  } catch (err) {
    await interaction.editReply({ content: `Failed to send RCON command: ${String(err)}` });
  }
}

export async function handleRefreshKits(interaction: ChatInputCommandInteraction): Promise<void> {
  if (!await requireRole(interaction, "avivadmin")) return;
  const server = await getServerForInteraction(interaction);
  if (!server) return;

  await interaction.deferReply({ flags: MessageFlags.Ephemeral });

  if (!server.rcon_host) {
    await interaction.editReply({ content: "RCON not configured for this server." });
    return;
  }

  try {
    const response = await rconManager.sendCommand(
      server.id, server.rcon_host, server.rcon_port!, server.rcon_password!,
      "kit.list"
    );

    // Parse kit names from the RCON response - one per line or comma-separated
    const rawLines = response.split(/[\n,]+/).map(l => l.trim()).filter(l => l.length > 0);

    // Filter out header lines / non-kit entries
    const kitNames = rawLines.filter(l =>
      !l.toLowerCase().startsWith("kit") ||
      (l.toLowerCase().startsWith("kit") && !l.includes(":") && !l.includes(" "))
    ).map(l => l.replace(/^kit\./i, "").trim()).filter(l => l.length > 0 && !l.includes(" "));

    if (kitNames.length === 0) {
      await interaction.editReply({
        content: `RCON responded but no kit names could be parsed.\n\nRaw response:\n\`\`\`\n${response.slice(0, 800)}\n\`\`\`\n\nYou can manually add kits with \`/add-to-list list:kitlist ingame_name:<kitname>\`.`,
      });
      return;
    }

    // Clear existing kitlist and repopulate
    for (const name of kitNames) {
      await db.addToList(server.id, "kitlist", name);
    }

    const embed = new EmbedBuilder()
      .setTitle(`Kit List Synced — Server ${server.server_number}`)
      .setColor(0x3dba8c)
      .setDescription(`Found **${kitNames.length}** kits:\n${kitNames.map(k => `• ${k}`).join("\n")}`)
      .setFooter({ text: "These now appear in /givekit autocomplete." });

    await interaction.editReply({ embeds: [embed] });
  } catch (err) {
    await interaction.editReply({
      content: `RCON query failed: ${String(err)}\n\nAdd kits manually with \`/add-to-list list:kitlist ingame_name:<kitname>\`.`,
    });
  }
}

export async function autocompleteGivekit(interaction: AutocompleteInteraction): Promise<void> {
  if (!interaction.guild) { await interaction.respond([]); return; }
  const focused = interaction.options.getFocused(true);

  if (focused.name === "kit_name") {
    await autocompleteKitNameForGuild(interaction, interaction.guild.id);
    return;
  }

  if (focused.name === "ingame_name") {
    await autocompleteIngameNameForGuild(interaction, interaction.guild.id);
    return;
  }

  await interaction.respond([]);
}
