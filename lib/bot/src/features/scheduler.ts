import { EmbedBuilder } from "discord.js";
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
    sendScheduledMessages(client),
    expireBounties(client),
    postLeaderboards(client),
  ]);
}

// ---- Prison releases ----

async function checkPrisonReleases(client: Client): Promise<void> {
  const allGuilds = client.guilds.cache;
  for (const [, guild] of allGuilds) {
    const servers = await db.getServersByGuild(guild.id).catch(() => [] as db.ServerRow[]);
    for (const server of servers) {
      const due = await db.getDuePrisoners(server.id).catch(() => [] as db.PrisonRow[]);
      for (const prisoner of due) {
        await db.releasePrisoner(server.id, prisoner.ingame_name).catch(() => null);

        const positions = await db.getTpPositions(server.id, "prison_release").catch(() => [] as db.TpPositionRow[]);
        if (positions.length > 0 && server.rcon_host) {
          const pos = positions[0]!;
          await rconManager.sendFireAndForget(
            server.id, server.rcon_host, server.rcon_port!, server.rcon_password!,
            `global.teleportpos ${pos.x},${pos.y},${pos.z} "${prisoner.ingame_name}"`
          ).catch(() => null);
        }

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

// ---- Scheduled in-game messages ----

async function sendScheduledMessages(client: Client): Promise<void> {
  for (const [, guild] of client.guilds.cache) {
    const servers = await db.getServersByGuild(guild.id).catch(() => [] as db.ServerRow[]);
    for (const server of servers) {
      if (!server.rcon_host) continue;
      const msgs = await db.getSchedulerMessages(server.id).catch(() => [] as db.SchedulerRow[]);
      const now = Date.now();
      for (const msg of msgs) {
        const intervalMs = msg.interval_minutes * 60_000;
        const lastSent = msg.last_sent ? new Date(msg.last_sent).getTime() : 0;
        if (now - lastSent >= intervalMs) {
          await rconManager.sendFireAndForget(
            server.id, server.rcon_host, server.rcon_port!, server.rcon_password!,
            `global.say "${msg.message}"`
          ).catch(() => null);
          await db.updateSchedulerLastSent(msg.id).catch(() => null);
        }
      }
    }
  }
}

// ---- Bounty expiry ----

async function expireBounties(client: Client): Promise<void> {
  for (const [, guild] of client.guilds.cache) {
    const servers = await db.getServersByGuild(guild.id).catch(() => [] as db.ServerRow[]);
    for (const server of servers) {
      const durationStr = await db.getConfig(server.id, "BountyDuration").catch(() => null) ?? "24";
      const durationMs = parseFloat(durationStr) * 3600_000;
      const bounties = await db.getActiveBounties(server.id).catch(() => [] as db.BountyRow[]);
      for (const bounty of bounties) {
        const placedAtStr = await db.getConfig(server.id, `bounty_placed_at_${bounty.target_name}`).catch(() => null);
        if (placedAtStr && Date.now() - new Date(placedAtStr).getTime() >= durationMs) {
          await db.deactivateBounty(server.id, bounty.target_name).catch(() => null);

          const channelId = await db.getChannel(server.id, "killfeed").catch(() => null);
          if (channelId) {
            const ch = guild.channels.cache.get(channelId);
            if (ch && ch.isTextBased()) {
              await ch.send(`\u{1F3AF} The bounty on **${bounty.target_name}** has expired.`).catch(() => null);
            }
          }
        }
      }
    }
  }
}

// ---- Daily leaderboard auto-post ----

const MEDALS = ["\u{1F947}", "\u{1F948}", "\u{1F949}"];

async function postLeaderboards(client: Client): Promise<void> {
  for (const [, guild] of client.guilds.cache) {
    const servers = await db.getServersByGuild(guild.id).catch(() => [] as db.ServerRow[]);
    for (const server of servers) {
      const lastPostStr = await db.getConfig(server.id, "leaderboard_last_post").catch(() => null);
      if (lastPostStr && Date.now() - new Date(lastPostStr).getTime() < 24 * 3600_000) continue;

      const killsChannelId = await db.getChannel(server.id, "leaderboard-kills").catch(() => null);
      const ecoChannelId = await db.getChannel(server.id, "leaderboard-economy").catch(() => null);
      if (!killsChannelId && !ecoChannelId) continue;

      await db.setConfig(server.id, "leaderboard_last_post", new Date().toISOString()).catch(() => null);
      const currencyName = await db.getConfig(server.id, "currency_name").catch(() => "coins") ?? "coins";

      if (killsChannelId) {
        const topKillers = await db.getTopKillers(server.id, 10).catch(() => []);
        if (topKillers.length > 0) {
          const lines = topKillers.map((k, i) =>
            `${MEDALS[i] ?? `**${i + 1}.**`} **${k.ingame_name}** \u2014 ${k.kill_count} kills`
          );
          const embed = new EmbedBuilder()
            .setTitle("\u2694\uFE0F Top Killers")
            .setDescription(lines.join("\n"))
            .setColor(0xe74c3c)
            .setFooter({ text: `Server ${server.server_number} \u2022 Updated daily` })
            .setTimestamp();
          const ch = guild.channels.cache.get(killsChannelId);
          if (ch && ch.isTextBased()) await ch.send({ embeds: [embed] }).catch(() => null);
        }
      }

      if (ecoChannelId) {
        const topEarners = await db.getLeaderboard(server.id, 10).catch(() => []);
        if (topEarners.length > 0) {
          const lines = topEarners.map((e, i) =>
            `${MEDALS[i] ?? `**${i + 1}.**`} **${e.ingame_name}** \u2014 ${e.balance} ${currencyName}`
          );
          const embed = new EmbedBuilder()
            .setTitle(`\u{1F4B0} Top Earners`)
            .setDescription(lines.join("\n"))
            .setColor(0xf1c40f)
            .setFooter({ text: `Server ${server.server_number} \u2022 Updated daily` })
            .setTimestamp();
          const ch = guild.channels.cache.get(ecoChannelId);
          if (ch && ch.isTextBased()) await ch.send({ embeds: [embed] }).catch(() => null);
        }
      }
    }
  }
}
