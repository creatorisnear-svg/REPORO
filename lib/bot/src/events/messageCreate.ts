import type { Message, Guild } from "discord.js";
import * as db from "@workspace/db";

function hasRole(guild: Guild, member: import("discord.js").GuildMember, roleName: string): boolean {
  return guild.roles.cache.some(r => r.name === roleName && member.roles.cache.has(r.id));
}

async function isAdminOrMod(message: Message): Promise<boolean> {
  if (!message.guild || !message.member) return false;
  return hasRole(message.guild, message.member, "avivadmin") || hasRole(message.guild, message.member, "avivmod");
}

export async function handleMessageCreate(message: Message): Promise<void> {
  if (message.author.bot) return;
  if (!message.guild) return;

  const content = message.content.trim();

  // Chat bridge: relay Discord messages to in-game
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

  // Prefix commands
  if (!content.startsWith("!")) return;

  const spaceIdx = content.indexOf(" ");
  const prefix = spaceIdx === -1 ? content.toLowerCase() : content.slice(0, spaceIdx).toLowerCase();
  const args = spaceIdx === -1 ? "" : content.slice(spaceIdx + 1).trim();

  // !console, !console2, !console3, !consoles, !say, !whois, !whogot, !maxspend
  const consoleCommands = ["!console", "!console2", "!console3", "!consoles", "!say"];
  const adminCommands = [...consoleCommands, "!whois", "!whogot", "!maxspend"];

  if (!adminCommands.includes(prefix)) return;

  if (!(await isAdminOrMod(message))) {
    await message.reply("You need the **avivadmin** or **avivmod** role to use this command.").catch(() => null);
    return;
  }

  if (!args && prefix !== "!consoles") {
    await message.reply("Usage: `" + prefix + " <command>`").catch(() => null);
    return;
  }

  const guildServers = await db.getServersByGuild(message.guild.id).catch(() => [] as db.ServerRow[]);

  if (prefix === "!whois") {
    // Look up in-game name for a Discord mention
    const mention = message.mentions.users.first();
    if (!mention) {
      await message.reply("Usage: `!whois @discorduser`").catch(() => null);
      return;
    }
    const linked: string[] = [];
    for (const server of guildServers) {
      const player = await db.getPlayerByDiscord(server.id, mention.id).catch(() => null);
      if (player) {
        linked.push(`Server ${server.server_number}: **${player.ingame_name}**`);
      }
    }
    if (linked.length === 0) {
      await message.reply(`${mention.username} is not linked on any server.`).catch(() => null);
    } else {
      await message.reply(`${mention.username} is linked as:\n${linked.join("\n")}`).catch(() => null);
    }
    return;
  }

  if (prefix === "!whogot") {
    // Look up Discord user for an in-game name
    if (!args) {
      await message.reply("Usage: `!whogot <ingame_name>`").catch(() => null);
      return;
    }
    const found: string[] = [];
    for (const server of guildServers) {
      const player = await db.getPlayerByIngameName(server.id, args).catch(() => null);
      if (player) {
        found.push(`Server ${server.server_number}: <@${player.discord_user_id}>`);
      }
    }
    if (found.length === 0) {
      await message.reply(`No Discord user is linked to **${args}**.`).catch(() => null);
    } else {
      await message.reply(`**${args}** is linked to:\n${found.join("\n")}`).catch(() => null);
    }
    return;
  }

  if (prefix === "!maxspend") {
    const amount = parseInt(args, 10);
    if (isNaN(amount) || amount < 0) {
      await message.reply("Usage: `!maxspend <amount>`").catch(() => null);
      return;
    }
    for (const server of guildServers) {
      await db.setConfig(server.id, "shop_max_daily_spend", String(amount)).catch(() => null);
    }
    await message.reply(`Daily shop spend limit set to **${amount}** for all servers.`).catch(() => null);
    return;
  }

  // RCON commands: !console, !console2, !console3, !consoles, !say
  const { rconManager } = await import("../rcon/manager.js");

  const sendToServer = async (server: db.ServerRow, cmd: string): Promise<string> => {
    if (!server.rcon_host) return "No RCON configured.";
    const timeout = new Promise<string>(resolve => setTimeout(() => resolve("No response from server."), 10_000));
    const send = rconManager.sendCommand(server.id, server.rcon_host, server.rcon_port!, server.rcon_password!, cmd)
      .then(r => r || "Command sent (no output).")
      .catch(e => `Error: ${String(e)}`);
    return Promise.race([send, timeout]);
  };

  if (prefix === "!say") {
    const server = guildServers.find(s => s.server_number === 1);
    if (!server) { await message.reply("No server 1 configured.").catch(() => null); return; }
    const response = await sendToServer(server, `say ${args}`);
    await message.reply(`**Server 1 response:** ${response}`).catch(() => null);
    return;
  }

  if (prefix === "!consoles") {
    if (!args) { await message.reply("Usage: `!consoles <command>`").catch(() => null); return; }
    const results: string[] = [];
    for (const server of guildServers) {
      const r = await sendToServer(server, args);
      results.push(`**Server ${server.server_number}:** ${r}`);
    }
    await message.reply(results.join("\n") || "No servers configured.").catch(() => null);
    return;
  }

  const serverNumMap: Record<string, number> = { "!console": 1, "!console2": 2, "!console3": 3 };
  const targetNum = serverNumMap[prefix];
  if (targetNum !== undefined) {
    const server = guildServers.find(s => s.server_number === targetNum);
    if (!server) {
      await message.reply(`Server ${targetNum} is not configured.`).catch(() => null);
      return;
    }
    const response = await sendToServer(server, args);
    await message.reply(`**Server ${targetNum} response:** ${response}`).catch(() => null);
    return;
  }
}
