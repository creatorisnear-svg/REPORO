import type { ChatInputCommandInteraction } from "discord.js";
import { MessageFlags } from "discord.js";
import * as db from "@workspace/db";
import { getServerForInteraction, requireRole } from "./utils.js";
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
    await rconManager.sendCommand(server.id, server.rcon_host, server.rcon_port!, server.rcon_password!, `giveto ${ingameName} ${kitName}`);
    const logsChannelId = await db.getChannel(server.id, "cmd-logs");
    if (logsChannelId && interaction.guild) {
      const ch = interaction.guild.channels.cache.get(logsChannelId);
      if (ch && ch.isTextBased()) {
        await ch.send(`[CMD] ${interaction.user.tag} used /givekit: **${ingameName}** got **${kitName}** on Server ${server.server_number}`);
      }
    }
    await interaction.editReply({ content: `Gave kit **${kitName}** to **${ingameName}**.` });
  } catch (err) {
    await interaction.editReply({ content: `Failed: ${String(err)}` });
  }
}
