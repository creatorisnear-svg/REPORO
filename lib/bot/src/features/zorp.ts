import type { Client } from "discord.js";
import * as db from "@workspace/db";
import { rconManager } from "../rcon/manager.js";
import type { TextChannel } from "discord.js";

export async function runZorpExpiryCheck(client: Client): Promise<void> {
  for (const [, guild] of client.guilds.cache) {
    const servers = await db.getServersByGuild(guild.id).catch(() => [] as db.ServerRow[]);

    for (const server of servers) {
      const zones = await db.getAllZorpZones(server.id).catch(() => [] as db.ZorpZoneRow[]);
      const now = new Date();

      for (const zone of zones) {
        // Check expiry
        if (zone.expires_at && new Date(zone.expires_at) < now) {
          await db.deleteZorpZone(server.id, zone.ingame_name).catch(() => null);

          // Try to delete zone in-game
          if (server.rcon_host) {
            await rconManager.sendCommand(
              server.id, server.rcon_host, server.rcon_port!, server.rcon_password!,
              `o.zorp delete ${zone.ingame_name}`
            ).catch(() => null);
          }

          // Post to player-feed
          const channelId = await db.getChannel(server.id, "player-feed").catch(() => null);
          if (channelId) {
            try {
              const channel = await guild.channels.fetch(channelId) as TextChannel | null;
              if (channel?.isTextBased()) {
                await channel.send(`\u23F0 **${zone.ingame_name}**'s ZORP zone has expired.`);
              }
            } catch { /* ignore */ }
          }
          continue;
        }

        // Check if any team member is online and update zone status
        if (server.rcon_host) {
          try {
            const playerListRaw = await rconManager.sendCommand(
              server.id, server.rcon_host, server.rcon_port!, server.rcon_password!,
              "playerlist"
            );
            const online = playerListRaw.toLowerCase().includes(zone.ingame_name.toLowerCase());
            const newStatus = online ? "green" : "red";
            if (zone.status !== newStatus) {
              await db.updateZorpStatus(server.id, zone.ingame_name, newStatus).catch(() => null);
            }
          } catch { /* rcon unavailable */ }
        }
      }
    }
  }
}
