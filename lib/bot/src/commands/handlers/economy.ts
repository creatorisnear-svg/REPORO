import type { ChatInputCommandInteraction } from "discord.js";
import { EmbedBuilder, MessageFlags } from "discord.js";
import * as db from "@workspace/db";
import { getServerForInteraction, requireRole, getLinkedName, formatCurrency, randomInt, hasRole } from "./utils.js";

async function getCurrencyName(serverId: number): Promise<string> {
  return (await db.getConfig(serverId, "currency_name")) ?? "coins";
}

export async function handleBalance(interaction: ChatInputCommandInteraction): Promise<void> {
  if (!interaction.guild) return;
  await interaction.deferReply({ flags: MessageFlags.Ephemeral });

  const targetUser = interaction.options.getUser("player");

  // Non-admins can only check their own balance
  if (targetUser && !hasRole(interaction, "avivadmin")) {
    await interaction.editReply({ content: "Only admins can check other players' balances." });
    return;
  }

  const userId = targetUser?.id ?? interaction.user.id;
  const servers = await db.getServersByGuild(interaction.guild.id);
  if (!servers.length) {
    await interaction.editReply({ content: "No servers configured yet." });
    return;
  }

  const rows: Array<{ server: db.ServerRow; ingameName: string; balance: number; currency: string }> = [];
  for (const server of servers) {
    const player = await db.getPlayerByDiscord(server.id, userId);
    if (player) {
      const eco = await db.getEconomy(server.id, player.ingame_name);
      const currency = await getCurrencyName(server.id);
      rows.push({ server, ingameName: player.ingame_name, balance: eco?.balance ?? 0, currency });
    }
  }

  if (!rows.length) {
    const who = targetUser ? `<@${userId}>` : "You";
    const verb = targetUser ? "is" : "are";
    await interaction.editReply({ content: `${who} ${verb} not linked on any server. Use /link first.` });
    return;
  }

  const desc = rows
    .map(r => `**Server ${r.server.server_number}** — ${r.server.server_label}\n${r.ingameName}  |  **${formatCurrency(r.balance, r.currency)}**`)
    .join("\n\n");

  const totalLine = rows.length > 1
    ? `\n\n**Total across all servers:** ${rows.reduce((a, r) => a + r.balance, 0)} ${rows[0]!.currency}`
    : "";

  const embed = new EmbedBuilder()
    .setTitle(targetUser ? `Balance — ${targetUser.username}` : "Your Balance")
    .setDescription(desc + totalLine)
    .setColor(0xf1c40f);

  await interaction.editReply({ embeds: [embed] });
}

export async function handleDaily(interaction: ChatInputCommandInteraction): Promise<void> {
  const server = await getServerForInteraction(interaction);
  if (!server) return;
  await interaction.deferReply({ flags: MessageFlags.Ephemeral });

  const ingameName = await getLinkedName(interaction, server.id);
  if (!ingameName) { await interaction.editReply({ content: "You must be linked to claim daily. Use /link." }); return; }

  const economy = await db.ensureEconomy(server.id, ingameName);
  if (economy.last_daily) {
    const last = new Date(economy.last_daily).getTime();
    const cooldown = 20 * 60 * 60 * 1000; // 20 hours
    if (Date.now() - last < cooldown) {
      const remaining = Math.ceil((cooldown - (Date.now() - last)) / 3600000);
      await interaction.editReply({ content: `Daily already claimed. Try again in ~${remaining}h.` });
      return;
    }
  }

  const minStr = (await db.getConfig(server.id, "daily_min")) ?? "30";
  const maxStr = (await db.getConfig(server.id, "daily_max")) ?? "300";
  const amount = randomInt(parseInt(minStr, 10), parseInt(maxStr, 10));

  await db.updateBalance(server.id, ingameName, amount);
  await db.setLastDaily(server.id, ingameName);

  const currency = await getCurrencyName(server.id);
  await interaction.editReply({ content: `You claimed your daily reward: **+${formatCurrency(amount, currency)}**!` });
}

export async function handleTransfer(interaction: ChatInputCommandInteraction): Promise<void> {
  const server = await getServerForInteraction(interaction);
  if (!server) return;
  await interaction.deferReply({ flags: MessageFlags.Ephemeral });

  const ingameName = await getLinkedName(interaction, server.id);
  if (!ingameName) { await interaction.editReply({ content: "You must be linked. Use /link." }); return; }

  const targetUser = interaction.options.getUser("player", true);
  const amount = interaction.options.getInteger("amount", true);

  const targetPlayer = await db.getPlayerByDiscord(server.id, targetUser.id);
  if (!targetPlayer) { await interaction.editReply({ content: `<@${targetUser.id}> is not linked on this server.` }); return; }

  const myEco = await db.getEconomy(server.id, ingameName);
  if ((myEco?.balance ?? 0) < amount) { await interaction.editReply({ content: "Insufficient balance." }); return; }

  await db.updateBalance(server.id, ingameName, -amount);
  await db.updateBalance(server.id, targetPlayer.ingame_name, amount);

  const currency = await getCurrencyName(server.id);
  await interaction.editReply({ content: `Transferred **${formatCurrency(amount, currency)}** to **${targetPlayer.ingame_name}**.` });
}

export async function handleSwap(interaction: ChatInputCommandInteraction): Promise<void> {
  if (!interaction.guild) return;
  await interaction.deferReply({ flags: MessageFlags.Ephemeral });

  const amount = interaction.options.getInteger("amount", true);
  const fromNum = interaction.options.getInteger("from", true);
  const toNum = interaction.options.getInteger("to", true);

  if (fromNum === toNum) { await interaction.editReply({ content: "Source and destination must be different servers." }); return; }

  const fromServer = await db.getServerByGuildAndNumber(interaction.guild.id, fromNum);
  const toServer = await db.getServerByGuildAndNumber(interaction.guild.id, toNum);
  if (!fromServer || !toServer) { await interaction.editReply({ content: "One or both servers not configured." }); return; }

  const fromPlayer = await db.getPlayerByDiscord(fromServer.id, interaction.user.id);
  const toPlayer = await db.getPlayerByDiscord(toServer.id, interaction.user.id);
  if (!fromPlayer) { await interaction.editReply({ content: `You are not linked on Server ${fromNum}.` }); return; }
  if (!toPlayer) { await interaction.editReply({ content: `You are not linked on Server ${toNum}.` }); return; }

  const fromEco = await db.getEconomy(fromServer.id, fromPlayer.ingame_name);
  if ((fromEco?.balance ?? 0) < amount) { await interaction.editReply({ content: "Insufficient balance on source server." }); return; }

  await db.updateBalance(fromServer.id, fromPlayer.ingame_name, -amount);
  await db.updateBalance(toServer.id, toPlayer.ingame_name, amount);

  const currency = await getCurrencyName(fromServer.id);
  await interaction.editReply({ content: `Swapped **${formatCurrency(amount, currency)}** from Server ${fromNum} to Server ${toNum}.` });
}

export async function handleLeaderboard(interaction: ChatInputCommandInteraction): Promise<void> {
  const server = await getServerForInteraction(interaction);
  if (!server) return;
  await interaction.deferReply();

  const top = await db.getLeaderboard(server.id, 10);
  const currency = await getCurrencyName(server.id);

  if (top.length === 0) { await interaction.editReply({ content: "No economy data yet." }); return; }

  const desc = top.map((e, i) => `**${i + 1}.** ${e.ingame_name} — ${formatCurrency(e.balance, currency)}`).join("\n");
  const embed = new EmbedBuilder()
    .setTitle(`Top Earners — Server ${server.server_number}`)
    .setDescription(desc)
    .setColor(0xf1c40f);
  await interaction.editReply({ embeds: [embed] });
}

export async function handleSetdailyscale(interaction: ChatInputCommandInteraction): Promise<void> {
  if (!await requireRole(interaction, "avivadmin")) return;
  const server = await getServerForInteraction(interaction);
  if (!server) return;
  const min = interaction.options.getInteger("min", true);
  const max = interaction.options.getInteger("max", true);
  if (min > max) { await interaction.reply({ content: "Min must be less than or equal to max.", flags: MessageFlags.Ephemeral }); return; }
  await db.setConfig(server.id, "daily_min", String(min));
  await db.setConfig(server.id, "daily_max", String(max));
  await interaction.reply({ content: `Daily reward range set to ${min}-${max} on Server ${server.server_number}.`, flags: MessageFlags.Ephemeral });
}

export async function handleKillpoints(interaction: ChatInputCommandInteraction): Promise<void> {
  if (!await requireRole(interaction, "avivadmin")) return;
  const server = await getServerForInteraction(interaction);
  if (!server) return;
  const type = interaction.options.getString("type", true);
  const amount = interaction.options.getInteger("amount", true);
  const key = type === "player" ? "player_kill_points" : "scientist_kill_points";
  await db.setConfig(server.id, key, String(amount));
  await interaction.reply({ content: `Set ${type} kill points to ${amount} on Server ${server.server_number}.`, flags: MessageFlags.Ephemeral });
}

export async function handleAddPointsPlayer(interaction: ChatInputCommandInteraction): Promise<void> {
  if (!await requireRole(interaction, "avivadmin")) return;
  const server = await getServerForInteraction(interaction);
  if (!server) return;
  const ingameName = interaction.options.getString("ingame_name", true);
  const amount = interaction.options.getInteger("amount", true);
  await db.ensureEconomy(server.id, ingameName);
  await db.updateBalance(server.id, ingameName, amount);
  const currency = await getCurrencyName(server.id);
  await interaction.reply({ content: `Added ${formatCurrency(amount, currency)} to **${ingameName}**.`, flags: MessageFlags.Ephemeral });
}

export async function handleSubPointsPlayer(interaction: ChatInputCommandInteraction): Promise<void> {
  if (!await requireRole(interaction, "avivadmin")) return;
  const server = await getServerForInteraction(interaction);
  if (!server) return;
  const ingameName = interaction.options.getString("ingame_name", true);
  const amount = interaction.options.getInteger("amount", true);
  await db.updateBalance(server.id, ingameName, -amount);
  const currency = await getCurrencyName(server.id);
  await interaction.reply({ content: `Removed ${formatCurrency(amount, currency)} from **${ingameName}**.`, flags: MessageFlags.Ephemeral });
}

export async function handleAddPointsServer(interaction: ChatInputCommandInteraction): Promise<void> {
  if (!await requireRole(interaction, "avivadmin")) return;
  const server = await getServerForInteraction(interaction);
  if (!server) return;
  await interaction.deferReply({ flags: MessageFlags.Ephemeral });
  const amount = interaction.options.getInteger("amount", true);
  const top = await db.getLeaderboard(server.id, 9999);
  for (const e of top) await db.updateBalance(server.id, e.ingame_name, amount);
  const currency = await getCurrencyName(server.id);
  await interaction.editReply({ content: `Added ${formatCurrency(amount, currency)} to all ${top.length} players on Server ${server.server_number}.` });
}

export async function handleSubPointsServer(interaction: ChatInputCommandInteraction): Promise<void> {
  if (!await requireRole(interaction, "avivadmin")) return;
  const server = await getServerForInteraction(interaction);
  if (!server) return;
  await interaction.deferReply({ flags: MessageFlags.Ephemeral });
  const amount = interaction.options.getInteger("amount", true);
  const top = await db.getLeaderboard(server.id, 9999);
  for (const e of top) await db.updateBalance(server.id, e.ingame_name, -amount);
  const currency = await getCurrencyName(server.id);
  await interaction.editReply({ content: `Removed ${formatCurrency(amount, currency)} from all ${top.length} players on Server ${server.server_number}.` });
}

export async function handleWipeEconomy(interaction: ChatInputCommandInteraction): Promise<void> {
  if (!await requireRole(interaction, "avivadmin")) return;
  const server = await getServerForInteraction(interaction);
  if (!server) return;
  await interaction.deferReply({ flags: MessageFlags.Ephemeral });

  await db.wipeEconomy(server.id);

  const logsChannelId = await db.getChannel(server.id, "logs").catch(() => null);
  if (logsChannelId && interaction.guild) {
    try {
      const ch = await interaction.guild.channels.fetch(logsChannelId);
      if (ch?.isTextBased()) {
        await (ch as import("discord.js").TextChannel).send(
          `\u{1F5D1}\uFE0F Economy wiped on Server ${server.server_number} by <@${interaction.user.id}>.`
        );
      }
    } catch { /* ignore */ }
  }

  await interaction.editReply({ content: `All economy balances wiped on Server ${server.server_number}.` });
}
