import type { Client } from "discord.js";
import * as db from "@workspace/db";
import { rconManager } from "../rcon/manager.js";
import type { TextChannel } from "discord.js";

// Called every 1 minute: release prisoners whose time is up
export async function runPrisonReleaseCheck(client: Client): Promise<void> {
  for (const [, guild] of client.guilds.cache) {
    const servers = await db.getServersByGuild(guild.id).catch(() => [] as db.ServerRow[]);

    for (const server of servers) {
      const duePrisoners = await db.getDuePrisoners(server.id).catch(() => [] as db.PrisonRow[]);

      for (const prisoner of duePrisoners) {
        await db.releasePrisoner(server.id, prisoner.ingame_name).catch(() => null);

        // Post to logs channel
        const logsChannelId = await db.getChannel(server.id, "logs").catch(() => null);
        if (logsChannelId) {
          try {
            const channel = await guild.channels.fetch(logsChannelId) as TextChannel | null;
            if (channel?.isTextBased()) {
              await channel.send(`\u{1F513} **${prisoner.ingame_name}** has been released from prison.`);
            }
          } catch { /* ignore */ }
        }

        // Try to DM the linked Discord user
        try {
          const player = await db.getPlayerByIngameName(server.id, prisoner.ingame_name);
          if (player?.discord_user_id) {
            const user = await client.users.fetch(player.discord_user_id);
            await user.send(`You have been released from prison on **Server ${server.server_number}**.`).catch(() => null);
          }
        } catch { /* ignore */ }
      }
    }
  }
}

// Called every 30 seconds: keep active prisoners inside prison
export async function runPrisonKeepCheck(client: Client): Promise<void> {
  for (const [, guild] of client.guilds.cache) {
    const servers = await db.getServersByGuild(guild.id).catch(() => [] as db.ServerRow[]);

    for (const server of servers) {
      if (!server.rcon_host) continue;

      const prisoners = await db.getActivePrisoners(server.id).catch(() => [] as db.PrisonRow[]);
      if (prisoners.length === 0) continue;

      // Get prison position
      const prisonPos = await db.getTpPositions(server.id, "prison").catch(() => [] as db.TpPositionRow[]);
      if (prisonPos.length === 0) continue;

      const pos = prisonPos[0];

      for (const prisoner of prisoners) {
        await rconManager.sendFireAndForget(
          server.id, server.rcon_host, server.rcon_port!, server.rcon_password!,
          `teleportpos ${prisoner.ingame_name} ${pos.x} ${pos.y} ${pos.z}`
        ).catch(() => null);
      }
    }
  }
}
