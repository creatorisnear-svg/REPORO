import type { Client } from "discord.js";
import type { TextChannel } from "discord.js";
import * as db from "@workspace/db";
import { rconManager } from "../rcon/manager.js";

async function sendRcon(server: db.ServerRow, cmd: string): Promise<void> {
  if (!server.rcon_host) return;
  await rconManager.sendFireAndForget(
    server.id, server.rcon_host, server.rcon_port!, server.rcon_password!, cmd
  ).catch(() => null);
}

async function postToChannel(client: Client, server: db.ServerRow, channelType: string, content: string): Promise<void> {
  if (!server.discord_guild_id) return;
  const channelId = await db.getChannel(server.id, channelType).catch(() => null);
  if (!channelId) return;
  const guild = client.guilds.cache.get(server.discord_guild_id);
  if (!guild) return;
  try {
    const channel = await guild.channels.fetch(channelId) as TextChannel | null;
    if (channel?.isTextBased()) {
      await channel.send(content);
    }
  } catch { /* ignore */ }
}

async function triggerEvent(client: Client, server: db.ServerRow, eventNum: number): Promise<void> {
  const eventType = await db.getConfig(server.id, `event${eventNum}_type`) ?? "crate";
  const posType = `${eventType}${eventNum}`;
  const positions = await db.getTpPositions(server.id, posType).catch(() => [] as db.TpPositionRow[]);

  if (positions.length === 0) return;

  const pos = positions[Math.floor(Math.random() * positions.length)];

  let cmd: string;
  if (eventType === "airdrop") {
    cmd = `callairlift ${pos.x} ${pos.y} ${pos.z}`;
  } else {
    cmd = `spawnlootcrate ${pos.x} ${pos.y} ${pos.z}`;
  }

  await sendRcon(server, cmd);

  // Pick a random message from event{n}_msg1/2/3
  const msgs = await Promise.all([1, 2, 3].map(n => db.getConfig(server.id, `event${eventNum}_msg${n}`)));
  const validMsgs = msgs.filter(Boolean) as string[];
  const announceMsg = validMsgs.length > 0 ? validMsgs[Math.floor(Math.random() * validMsgs.length)] : null;

  if (announceMsg) {
    await sendRcon(server, `say "${announceMsg}"`);
  }

  const icon = eventType === "airdrop" ? "\u{1F6E9}\uFE0F" : "\u{1F4E6}";
  const discordMsg = `${icon} **Event triggered!** ${announceMsg ?? `${eventType} spawned at ${pos.x}, ${pos.y}, ${pos.z}`}`;
  await postToChannel(client, server, "events", discordMsg);

  await db.setConfig(server.id, `event${eventNum}_last_trigger`, new Date().toISOString());
}

export async function runAutoEvents(client: Client): Promise<void> {
  const guilds = client.guilds.cache;

  for (const [, guild] of guilds) {
    const servers = await db.getServersByGuild(guild.id).catch(() => [] as db.ServerRow[]);

    for (const server of servers) {
      if (!server.rcon_host) continue;

      for (const eventNum of [1, 2, 3]) {
        const enabled = await db.getConfig(server.id, `event${eventNum}_use`).catch(() => "off") ?? "off";
        if (enabled !== "on") continue;

        const intervalStr = await db.getConfig(server.id, `event${eventNum}_interval`) ?? "60";
        const intervalMs = parseFloat(intervalStr) * 60_000;

        const lastTriggerStr = await db.getConfig(server.id, `event${eventNum}_last_trigger`).catch(() => null);
        const lastTrigger = lastTriggerStr ? new Date(lastTriggerStr).getTime() : 0;

        if (Date.now() - lastTrigger >= intervalMs) {
          await triggerEvent(client, server, eventNum).catch(e => {
            console.error(`[Events] Server ${server.server_number} event ${eventNum}:`, e);
          });
        }
      }
    }
  }
}
