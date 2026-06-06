import type { Message } from "discord.js";
import * as db from "@workspace/db";

export async function handleMessageCreate(message: Message): Promise<void> {
  if (message.author.bot) return;
  if (!message.guild) return;

  // Chat bridge: relay Discord messages to in-game if channel is configured
  const servers = await db.getServersByGuild(message.guild.id).catch(() => [] as db.ServerRow[]);
  for (const server of servers) {
    const bridgeChannelId = await db.getChannel(server.id, "chatbridge").catch(() => null);
    if (!bridgeChannelId || bridgeChannelId !== message.channel.id) continue;
    if (!server.rcon_host) continue;

    const { rconManager } = await import("../rcon/manager.js");
    const safeMsg = message.content.replace(/"/g, "'").substring(0, 128);
    await rconManager.sendCommand(
      server.id, server.rcon_host, server.rcon_port!, server.rcon_password!,
      `say [Discord] ${message.author.username}: ${safeMsg}`
    ).catch(() => null);
  }
}
