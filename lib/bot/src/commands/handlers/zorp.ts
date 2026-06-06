import type { ChatInputCommandInteraction } from "discord.js";
import * as db from "@workspace/db";
import { getServerForInteraction, requireRole } from "./utils.js";
import { rconManager } from "../../rcon/manager.js";

export async function handleWipeZorp(interaction: ChatInputCommandInteraction): Promise<void> {
  if (!await requireRole(interaction, "avivadmin")) return;
  const server = await getServerForInteraction(interaction);
  if (!server) return;
  await interaction.deferReply({ ephemeral: true });

  const zones = await db.getAllZorpZones(server.id);
  for (const zone of zones) {
    if (server.rcon_host) {
      await rconManager.sendCommand(server.id, server.rcon_host, server.rcon_port!, server.rcon_password!,
        `o.zorp delete ${zone.ingame_name}`).catch(() => null);
    }
    await db.deleteZorpZone(server.id, zone.ingame_name);
  }

  await interaction.editReply({ content: `Deleted ${zones.length} ZORP zone(s) on Server ${server.server_number}.` });
}

export async function handleDelZorp(interaction: ChatInputCommandInteraction): Promise<void> {
  if (!await requireRole(interaction, "avivadmin")) return;
  const server = await getServerForInteraction(interaction);
  if (!server) return;

  const ingameName = interaction.options.getString("ingame_name", true);

  if (server.rcon_host) {
    await rconManager.sendCommand(server.id, server.rcon_host, server.rcon_port!, server.rcon_password!,
      `o.zorp delete ${ingameName}`).catch(() => null);
  }
  await db.deleteZorpZone(server.id, ingameName);
  await interaction.reply({ content: `Deleted ZORP zone for **${ingameName}**.`, ephemeral: true });
}
