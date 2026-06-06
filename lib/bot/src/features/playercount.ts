import * as db from "@workspace/db";
import { rconManager } from "../rcon/manager.js";
import type { Client, VoiceChannel } from "discord.js";

export async function updatePlayerCountChannels(client: Client): Promise<void> {
  for (const [, guild] of client.guilds.cache) {
    const servers = await db.getServersByGuild(guild.id).catch(() => [] as db.ServerRow[]);
    for (const server of servers) {
      const channelId = await db.getChannel(server.id, "playercount").catch(() => null);
      if (!channelId || !server.rcon_host) continue;

      let onlineCount = 0;
      let queueCount = 0;

      try {
        const playerListRaw = await rconManager.sendCommand(
          server.id, server.rcon_host, server.rcon_port!, server.rcon_password!,
          "playerlist"
        );
        onlineCount = parsePlayerCount(playerListRaw);
      } catch { /* offline - leave at 0 */ }

      try {
        const queueRaw = await rconManager.sendCommand(
          server.id, server.rcon_host, server.rcon_port!, server.rcon_password!,
          "server.queued"
        );
        queueCount = parseQueueCount(queueRaw);
      } catch { /* leave at 0 */ }

      const ch = guild.channels.cache.get(channelId) as VoiceChannel | undefined;
      if (ch) {
        const newName = `| Server ${server.server_number} \u25B6 \uD83C\uDF10 ${onlineCount} \uD83D\uDD50 ${queueCount}`;
        if (ch.name !== newName) {
          await ch.setName(newName).catch(() => null);
        }
      }
    }
  }
}

function parsePlayerCount(rconResponse: string): number {
  const match = rconResponse.match(/(\d+)\s+players?/i);
  return match ? parseInt(match[1], 10) : 0;
}

function parseQueueCount(rconResponse: string): number {
  const match = rconResponse.match(/(\d+)/);
  return match ? parseInt(match[1], 10) : 0;
}
