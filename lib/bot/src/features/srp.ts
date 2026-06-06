import * as db from "@workspace/db";
import type { Client } from "discord.js";

export async function postSrpRequest(
  client: Client,
  guildId: string,
  serverId: number,
  playerName: string,
  category: string,
  item: string,
  amount: number,
  note: string
): Promise<void> {
  const guild = client.guilds.cache.get(guildId);
  if (!guild) return;

  const srpChannelId = await db.getChannel(serverId, "srp").catch(() => null);
  if (!srpChannelId) return;

  const ch = guild.channels.cache.get(srpChannelId);
  if (!ch || !ch.isTextBased()) return;

  const msg = [
    `**SRP Request** from **${playerName}**`,
    `Category: ${category} | Item: ${item} x${amount}`,
    note ? `Note: ${note}` : null,
  ].filter(Boolean).join("\n");

  await ch.send(msg).catch(() => null);
}
