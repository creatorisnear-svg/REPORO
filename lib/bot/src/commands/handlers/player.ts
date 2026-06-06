import type { ChatInputCommandInteraction } from "discord.js";
import { EmbedBuilder, MessageFlags } from "discord.js";
import * as db from "@workspace/db";
import { getServerForInteraction } from "./utils.js";

// ---- /stats ----

export async function handleStats(interaction: ChatInputCommandInteraction): Promise<void> {
  await interaction.deferReply({ flags: MessageFlags.Ephemeral });

  const server = await getServerForInteraction(interaction);
  if (!server) return;

  const targetUser = interaction.options.getUser("player");
  let ingameName: string | null = null;

  if (targetUser) {
    const linked = await db.getPlayerByDiscord(server.id, targetUser.id).catch(() => null);
    ingameName = linked?.ingame_name ?? null;
    if (!ingameName) {
      await interaction.editReply({ content: `${targetUser.username} is not linked on Server ${server.server_number}.` });
      return;
    }
  } else {
    const linked = await db.getPlayerByDiscord(server.id, interaction.user.id).catch(() => null);
    ingameName = linked?.ingame_name ?? null;
    if (!ingameName) {
      await interaction.editReply({ content: "You are not linked. Use `/link` to connect your Discord account." });
      return;
    }
  }

  const stats = await db.getPlayerStats(server.id, ingameName).catch(() => null);
  const currencyName = await db.getConfig(server.id, "currency_name") ?? "coins";
  const warnings = await db.getWarnings(server.id, ingameName).catch(() => []);
  const isPrison = await db.isPrisoner(server.id, ingameName).catch(() => false);
  const zorpZone = await db.getZorpZone(server.id, ingameName).catch(() => null);
  const tpHome = await db.getTpHome(server.id, ingameName).catch(() => null);

  const embed = new EmbedBuilder()
    .setTitle(`\u{1F4CA} Stats: ${ingameName}`)
    .setColor(0x5865f2)
    .addFields(
      { name: `\u{1F4B0} ${currencyName}`, value: String(stats?.balance ?? 0), inline: true },
      { name: "\u2694\uFE0F Kills", value: String(stats?.kill_count ?? 0), inline: true },
      { name: "\u26A0\uFE0F Warnings", value: String(warnings.length), inline: true },
      { name: "\u{1F3E0} TP Home", value: tpHome?.home_set ? "Set" : "Not set", inline: true },
      { name: "\u{1F7E3} ZORP Zone", value: zorpZone ? `Active (${zorpZone.status})` : "None", inline: true },
      { name: "\u{1F513} Prison", value: isPrison ? "Yes" : "No", inline: true },
    )
    .setFooter({ text: `Server ${server.server_number}` });

  await interaction.editReply({ embeds: [embed] });
}

// ---- /profile ----

export async function handleProfile(interaction: ChatInputCommandInteraction): Promise<void> {
  await interaction.deferReply({ flags: MessageFlags.Ephemeral });

  const server = await getServerForInteraction(interaction);
  if (!server) return;

  const ingameNameOpt = interaction.options.getString("ingame_name");
  let ingameName = ingameNameOpt;

  if (!ingameName) {
    const linked = await db.getPlayerByDiscord(server.id, interaction.user.id).catch(() => null);
    ingameName = linked?.ingame_name ?? null;
    if (!ingameName) {
      await interaction.editReply({ content: "You are not linked. Use `/link` first or provide an in-game name." });
      return;
    }
  }

  const player = await db.getPlayerByIngameName(server.id, ingameName).catch(() => null);
  const stats = await db.getPlayerStats(server.id, ingameName).catch(() => null);
  const currencyName = await db.getConfig(server.id, "currency_name") ?? "coins";
  const activeBounties = await db.getActiveBounties(server.id).catch(() => []);
  const hasBounty = activeBounties.some(b => b.target_name.toLowerCase() === ingameName!.toLowerCase());

  const embed = new EmbedBuilder()
    .setTitle(`\u{1F464} Profile: ${ingameName}`)
    .setColor(0xe67e22)
    .addFields(
      { name: "\u{1F517} Discord", value: player?.discord_user_id ? `<@${player.discord_user_id}>` : "Not linked", inline: true },
      { name: `\u{1F4B0} ${currencyName}`, value: String(stats?.balance ?? 0), inline: true },
      { name: "\u2694\uFE0F Kills", value: String(stats?.kill_count ?? 0), inline: true },
      { name: "\u{1F3AF} Bounty", value: hasBounty ? "Active bounty on this player" : "None", inline: true },
    )
    .setFooter({ text: `Server ${server.server_number}` });

  await interaction.editReply({ embeds: [embed] });
}

// ---- /topkillers ----

export async function handleTopkillers(interaction: ChatInputCommandInteraction): Promise<void> {
  const server = await getServerForInteraction(interaction);
  if (!server) return;

  await interaction.deferReply({ flags: MessageFlags.Ephemeral });

  const topKillers = await db.getTopKillers(server.id, 10).catch(() => []);

  if (topKillers.length === 0) {
    await interaction.editReply({ content: "No kill data recorded yet on this server." });
    return;
  }

  const medals = ["\u{1F947}", "\u{1F948}", "\u{1F949}"];
  const lines = topKillers.map((k, i) => {
    const prefix = medals[i] ?? `**${i + 1}.**`;
    return `${prefix} **${k.ingame_name}** — ${k.kill_count} kills`;
  });

  const embed = new EmbedBuilder()
    .setTitle("\u2694\uFE0F Top Killers")
    .setDescription(lines.join("\n"))
    .setColor(0xe74c3c)
    .setFooter({ text: `Server ${server.server_number}` });

  await interaction.editReply({ embeds: [embed] });
}

// ---- /scratch ----

const SYMBOLS = ["\u{1F9F1}", "\u{1FAB5}", "\u{1F527}", "\u2699\uFE0F", "\u{1F3AF}", "\u{1F48E}", "\u{1F525}"];

export async function handleScratch(interaction: ChatInputCommandInteraction): Promise<void> {
  const server = await getServerForInteraction(interaction);
  if (!server) return;

  await interaction.deferReply({ flags: MessageFlags.Ephemeral });

  const bet = interaction.options.getInteger("bet", true);

  const linked = await db.getPlayerByDiscord(server.id, interaction.user.id).catch(() => null);
  if (!linked) {
    await interaction.editReply({ content: "You need to link your account with `/link` to use this command." });
    return;
  }

  const balance = await db.getBalance(server.id, linked.ingame_name).catch(() => 0);
  if (balance < bet) {
    await interaction.editReply({ content: `You don't have enough ${await db.getConfig(server.id, "currency_name") ?? "coins"}. Balance: **${balance}**.` });
    return;
  }

  const currencyName = await db.getConfig(server.id, "currency_name") ?? "coins";

  const s1 = SYMBOLS[Math.floor(Math.random() * SYMBOLS.length)];
  const s2 = SYMBOLS[Math.floor(Math.random() * SYMBOLS.length)];
  const s3 = SYMBOLS[Math.floor(Math.random() * SYMBOLS.length)];

  const jackpot = s1 === s2 && s2 === s3;
  const twoMatch = s1 === s2 || s2 === s3 || s1 === s3;

  let winnings = 0;
  let resultText: string;

  if (jackpot) {
    winnings = bet * 5;
    resultText = `\u{1F389} **JACKPOT!** You win **${winnings} ${currencyName}**!`;
  } else if (twoMatch) {
    winnings = Math.floor(bet * 1.5);
    resultText = `\u{1F3C6} Two matching! You win **${winnings} ${currencyName}**!`;
  } else {
    resultText = `\u{1F613} No match. You lost **${bet} ${currencyName}**.`;
  }

  const net = winnings - bet;
  await db.updateBalance(server.id, linked.ingame_name, net);

  const embed = new EmbedBuilder()
    .setTitle("\u{1F3B0} Scratch Card")
    .setDescription(`${s1} | ${s2} | ${s3}\n\n${resultText}`)
    .setColor(jackpot ? 0xf1c40f : twoMatch ? 0x2ecc71 : 0xe74c3c)
    .setFooter({ text: `New balance: ${balance + net} ${currencyName}` });

  await interaction.editReply({ embeds: [embed] });
}
