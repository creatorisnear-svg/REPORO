import type { ChatInputCommandInteraction } from "discord.js";
import { EmbedBuilder, MessageFlags } from "discord.js";
import * as db from "@workspace/db";
import { getServerForInteraction, requireRole } from "./utils.js";

export async function handleAdminChannels(interaction: ChatInputCommandInteraction): Promise<void> {
  if (!await requireRole(interaction, "avivadmin")) return;
  const server = await getServerForInteraction(interaction);
  if (!server) return;

  const feedType = interaction.options.getString("feed", true);
  const channel = interaction.options.getChannel("channel", true);

  await db.setChannel(server.id, feedType, channel.id);
  await interaction.reply({ content: `Set **${feedType}** feed to <#${channel.id}> on Server ${server.server_number}.`, flags: MessageFlags.Ephemeral });
}

export async function handleAdminPositions(interaction: ChatInputCommandInteraction): Promise<void> {
  if (!await requireRole(interaction, "avivadmin")) return;
  const server = await getServerForInteraction(interaction);
  if (!server) return;
  await interaction.deferReply({ flags: MessageFlags.Ephemeral });

  const action = interaction.options.getString("action", true);

  if (action === "list") {
    const allTypes = ["TPN", "TPNE", "TPE", "TPSE", "TPS", "TPSW", "TPW", "TPNW", "prison", "prison_release"];
    const lines: string[] = [];
    for (const type of allTypes) {
      const positions = await db.getTpPositions(server.id, type);
      if (positions.length > 0) {
        lines.push(`**${type}**: ${positions.map(p => `#${p.id} (${p.x}, ${p.y}, ${p.z})${p.label ? ` [${p.label}]` : ""}`).join(", ")}`);
      }
    }
    const embed = new EmbedBuilder()
      .setTitle(`TP Positions — Server ${server.server_number}`)
      .setDescription(lines.join("\n") || "No positions set.")
      .setColor(0x5865f2);
    await interaction.editReply({ embeds: [embed] });
    return;
  }

  if (action === "add") {
    const type = interaction.options.getString("type");
    const x = interaction.options.getNumber("x");
    const y = interaction.options.getNumber("y");
    const z = interaction.options.getNumber("z");

    if (!type || x === null || y === null || z === null) {
      await interaction.editReply({ content: "Provide type, x, y, z to add a position." });
      return;
    }

    await db.addTpPosition(server.id, type, x, y, z);
    await interaction.editReply({ content: `Added **${type}** position (${x}, ${y}, ${z}).` });
    return;
  }

  if (action === "remove") {
    const id = interaction.options.getInteger("id");
    if (!id) { await interaction.editReply({ content: "Provide the position ID to remove." }); return; }
    await db.deleteTpPosition(id);
    await interaction.editReply({ content: `Removed position #${id}.` });
    return;
  }

  await interaction.editReply({ content: "Unknown action." });
}

export async function handleAdminScheduler(interaction: ChatInputCommandInteraction): Promise<void> {
  if (!await requireRole(interaction, "avivadmin")) return;
  const server = await getServerForInteraction(interaction);
  if (!server) return;
  await interaction.deferReply({ flags: MessageFlags.Ephemeral });

  const action = interaction.options.getString("action", true);

  if (action === "list") {
    const msgs = await db.getSchedulerMessages(server.id);
    if (msgs.length === 0) { await interaction.editReply({ content: "No scheduled messages." }); return; }
    const desc = msgs.map(m => `**#${m.id}** every ${m.interval_minutes}min: ${m.message}`).join("\n");
    const embed = new EmbedBuilder()
      .setTitle(`Scheduled Messages — Server ${server.server_number}`)
      .setDescription(desc.substring(0, 4096))
      .setColor(0x5865f2);
    await interaction.editReply({ embeds: [embed] });
    return;
  }

  if (action === "add") {
    const message = interaction.options.getString("message");
    const interval = interaction.options.getInteger("interval");
    if (!message || !interval) { await interaction.editReply({ content: "Provide message and interval." }); return; }
    await db.addSchedulerMessage(server.id, message, interval);
    await interaction.editReply({ content: `Scheduled message added: every ${interval}min.` });
    return;
  }

  if (action === "remove") {
    const id = interaction.options.getInteger("id");
    if (!id) { await interaction.editReply({ content: "Provide the message ID." }); return; }
    await db.removeSchedulerMessage(id);
    await interaction.editReply({ content: `Removed scheduled message #${id}.` });
    return;
  }

  await interaction.editReply({ content: "Unknown action." });
}
