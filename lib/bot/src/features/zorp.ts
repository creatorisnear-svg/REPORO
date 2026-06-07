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
            await rconManager.sendFireAndForget(
              server.id, server.rcon_host, server.rcon_port!, server.rcon_password!,
              `o.zorp delete "${zone.ingame_name}"`
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
            // Split by line to avoid partial-name false positives (e.g. "john" matching "johnson")
            const plLines = playerListRaw.split("\n").map(l => l.trim()).filter(Boolean);
            const nameLower = zone.ingame_name.toLowerCase();
            const online = plLines.some(l => l.toLowerCase().startsWith(nameLower) || l.toLowerCase().includes(` ${nameLower} `) || l.toLowerCase().includes(`| ${nameLower} |`) || l.toLowerCase() === nameLower);

            const zorpTimeStr = await db.getConfig(server.id, "zorptime") ?? "30";
            const zorpTimeMs = parseFloat(zorpTimeStr) * 60 * 1000;

            let newStatus: string;
            if (online) {
              newStatus = "green";
              await db.updateZorpLastSeen(server.id, zone.ingame_name, new Date().toISOString()).catch(() => null);
            } else {
              const lastSeen = zone.last_seen_at ? new Date(zone.last_seen_at).getTime() : 0;
              const offlineMs = Date.now() - lastSeen;
              newStatus = offlineMs >= zorpTimeMs ? "red" : "yellow";
            }

            if (zone.status !== newStatus) {
              await db.updateZorpStatus(server.id, zone.ingame_name, newStatus).catch(() => null);
            }
          } catch { /* rcon unavailable */ }
        }
      }
    }
  }
}
