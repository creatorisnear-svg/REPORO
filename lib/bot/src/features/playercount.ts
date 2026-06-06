import * as db from "@workspace/db";
import { rconManager } from "../rcon/manager.js";
import type { Client, TextChannel, VoiceChannel } from "discord.js";

export async function updatePlayerCountChannels(client: Client): Promise<void> {
  for (const [, guild] of client.guilds.cache) {
    const servers = await db.getServersByGuild(guild.id).catch(() => [] as db.ServerRow[]);
    for (const server of servers) {
      const channelId = await db.getChannel(server.id, "playercount").catch(() => null);
      if (!channelId || !server.rcon_host) continue;

      try {
        const response = await rconManager.sendCommand(
          server.id, server.rcon_host, server.rcon_port!, server.rcon_password!,
          "playerlist"
        );
        const count = parsePlayerCount(response);
        const ch = guild.channels.cache.get(channelId) as VoiceChannel | TextChannel | undefined;
        if (ch) {
          const newName = `Server ${server.server_number}: ${count} online`;
          if (ch.name !== newName) {
            await ch.setName(newName).catch(() => null);
          }
        }
      } catch { /* ignore if offline */ }
    }
  }
}

function parsePlayerCount(rconResponse: string): number {
  const match = rconResponse.match(/(\d+)\s+players?/i);
  return match ? parseInt(match[1], 10) : 0;
}
