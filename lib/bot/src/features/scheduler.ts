import * as db from "@workspace/db";
import { rconManager } from "../rcon/manager.js";
import type { Client } from "discord.js";

let schedulerInterval: ReturnType<typeof setInterval> | null = null;

export function startScheduler(client: Client): void {
  if (schedulerInterval) return;
  schedulerInterval = setInterval(() => runScheduledTasks(client), 60_000);
}

export function stopScheduler(): void {
  if (schedulerInterval) {
    clearInterval(schedulerInterval);
    schedulerInterval = null;
  }
}

async function runScheduledTasks(client: Client): Promise<void> {
  await Promise.allSettled([
    checkPrisonReleases(client),
    cleanupExpiredTimers(),
  ]);
}

async function checkPrisonReleases(client: Client): Promise<void> {
  const allGuilds = client.guilds.cache;
  for (const [, guild] of allGuilds) {
    const servers = await db.getServersByGuild(guild.id).catch(() => [] as db.ServerRow[]);
    for (const server of servers) {
      const due = await db.getDuePrisoners(server.id).catch(() => [] as db.PrisonRow[]);
      for (const prisoner of due) {
        await db.releasePrisoner(server.id, prisoner.ingame_name).catch(() => null);

        // Teleport them out of prison
        const positions = await db.getTpPositions(server.id, "prison_release").catch(() => [] as db.TpPositionRow[]);
        if (positions.length > 0 && server.rcon_host) {
          const pos = positions[0];
          await rconManager.sendFireAndForget(
            server.id, server.rcon_host, server.rcon_port!, server.rcon_password!,
            `teleportpos ${prisoner.ingame_name} ${pos.x} ${pos.y} ${pos.z}`
          ).catch(() => null);
        }

        // Notify the player's Discord
        const player = await db.getPlayerByIngameName(server.id, prisoner.ingame_name).catch(() => null);
        if (player) {
          const member = await guild.members.fetch(player.discord_user_id).catch(() => null);
          await member?.send(`Your prison sentence on Server ${server.server_number} has ended. You have been released.`).catch(() => null);
        }

        const logsId = await db.getChannel(server.id, "logs").catch(() => null);
        if (logsId) {
          const ch = guild.channels.cache.get(logsId);
          if (ch && ch.isTextBased()) {
            await ch.send(`[PRISON] **${prisoner.ingame_name}** has been automatically released.`).catch(() => null);
          }
        }
      }
    }
  }
}

async function cleanupExpiredTimers(): Promise<void> {
  // Expire shop timers (handled per-purchase on DB level)
  // Additional scheduled cleanup can go here
}
