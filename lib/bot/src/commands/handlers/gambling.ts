import type { ChatInputCommandInteraction } from "discord.js";
import { EmbedBuilder, MessageFlags } from "discord.js";
import * as db from "@workspace/db";
import { getServerForInteraction, requireRole, getLinkedName, formatCurrency, randomInt } from "./utils.js";

async function getCurrencyName(serverId: number): Promise<string> {
  return (await db.getConfig(serverId, "currency_name")) ?? "coins";
}

async function getMaxBet(serverId: number): Promise<number> {
  const v = await db.getConfig(serverId, "maxbet");
  return v ? parseInt(v, 10) : 99999;
}

export async function handleSpin(interaction: ChatInputCommandInteraction): Promise<void> {
  const server = await getServerForInteraction(interaction);
  if (!server) return;
  await interaction.deferReply();

  const ingameName = await getLinkedName(interaction, server.id);
  if (!ingameName) { await interaction.editReply({ content: "You must be linked. Use /link." }); return; }

  const bet = interaction.options.getInteger("bet", true);
  const maxBet = await getMaxBet(server.id);
  if (bet > maxBet) { await interaction.editReply({ content: `Max bet is ${maxBet}.` }); return; }

  const eco = await db.getEconomy(server.id, ingameName);
  if ((eco?.balance ?? 0) < bet) { await interaction.editReply({ content: "Insufficient balance." }); return; }

  // Bandit wheel outcomes: 2x (15%), 3x (5%), lose (70%), refund (10%)
  const roll = randomInt(1, 100);
  let multiplier: number;
  let outcome: string;

  if (roll <= 10) { multiplier = 1; outcome = "Refund" }
  else if (roll <= 25) { multiplier = 2; outcome = "2x Win!" }
  else if (roll <= 30) { multiplier = 3; outcome = "3x Win!" }
  else { multiplier = 0; outcome = "Loss" }

  const delta = multiplier === 0 ? -bet : (multiplier * bet) - bet;
  await db.updateBalance(server.id, ingameName, delta);

  const currency = await getCurrencyName(server.id);
  const newBal = (eco?.balance ?? 0) + delta;
  const emoji = multiplier > 1 ? "🎰" : multiplier === 1 ? "↩️" : "💸";
  const embed = new EmbedBuilder()
    .setTitle(`${emoji} Bandit Wheel`)
    .setDescription(`**${outcome}**\nBet: ${formatCurrency(bet, currency)} | Result: ${delta >= 0 ? "+" : ""}${formatCurrency(delta, currency)}\nBalance: ${formatCurrency(newBal, currency)}`)
    .setColor(delta >= 0 ? 0x2ecc71 : 0xe74c3c);

  await interaction.editReply({ embeds: [embed] });
}

export async function handleCoinflip(interaction: ChatInputCommandInteraction): Promise<void> {
  const server = await getServerForInteraction(interaction);
  if (!server) return;
  await interaction.deferReply();

  const ingameName = await getLinkedName(interaction, server.id);
  if (!ingameName) { await interaction.editReply({ content: "You must be linked. Use /link." }); return; }

  const bet = interaction.options.getInteger("bet", true);
  const choice = interaction.options.getString("choice", true);
  const maxBet = await getMaxBet(server.id);
  if (bet > maxBet) { await interaction.editReply({ content: `Max bet is ${maxBet}.` }); return; }

  const eco = await db.getEconomy(server.id, ingameName);
  if ((eco?.balance ?? 0) < bet) { await interaction.editReply({ content: "Insufficient balance." }); return; }

  const result = Math.random() < 0.5 ? "heads" : "tails";
  const won = result === choice;
  const delta = won ? bet : -bet;
  await db.updateBalance(server.id, ingameName, delta);

  const currency = await getCurrencyName(server.id);
  const newBal = (eco?.balance ?? 0) + delta;
  const embed = new EmbedBuilder()
    .setTitle(`${won ? "🪙" : "💸"} Coinflip`)
    .setDescription(`The coin landed on **${result}**!\n${won ? "You won!" : "You lost."}\n${delta >= 0 ? "+" : ""}${formatCurrency(delta, currency)} | Balance: ${formatCurrency(newBal, currency)}`)
    .setColor(won ? 0x2ecc71 : 0xe74c3c);
  await interaction.editReply({ embeds: [embed] });
}

export async function handleBlackjack(interaction: ChatInputCommandInteraction): Promise<void> {
  const server = await getServerForInteraction(interaction);
  if (!server) return;
  await interaction.deferReply();

  const ingameName = await getLinkedName(interaction, server.id);
  if (!ingameName) { await interaction.editReply({ content: "You must be linked. Use /link." }); return; }

  const bet = interaction.options.getInteger("bet", true);
  const maxBet = await getMaxBet(server.id);
  if (bet > maxBet) { await interaction.editReply({ content: `Max bet is ${maxBet}.` }); return; }

  const eco = await db.getEconomy(server.id, ingameName);
  if ((eco?.balance ?? 0) < bet) { await interaction.editReply({ content: "Insufficient balance." }); return; }

  const cardValue = () => {
    const v = randomInt(1, 13);
    return v >= 10 ? 10 : v === 1 ? 11 : v;
  };

  const playerHand = [cardValue(), cardValue()];
  const dealerHand = [cardValue(), cardValue()];
  const playerTotal = playerHand.reduce((a, b) => a + b, 0);
  const dealerTotal = dealerHand.reduce((a, b) => a + b, 0);

  // Simplified: just compare totals (no hit/stand)
  let result: "win" | "lose" | "push";
  if (playerTotal > 21) result = "lose";
  else if (dealerTotal > 21) result = "win";
  else if (playerTotal > dealerTotal) result = "win";
  else if (playerTotal < dealerTotal) result = "lose";
  else result = "push";

  const delta = result === "win" ? bet : result === "push" ? 0 : -bet;
  await db.updateBalance(server.id, ingameName, delta);

  const currency = await getCurrencyName(server.id);
  const newBal = (eco?.balance ?? 0) + delta;
  const embed = new EmbedBuilder()
    .setTitle("🃏 Blackjack")
    .setDescription(
      `Your hand: **${playerHand.join(" + ")} = ${playerTotal}**\nDealer: **${dealerHand.join(" + ")} = ${dealerTotal}**\n\n**${result === "win" ? "You win!" : result === "push" ? "Push!" : "Dealer wins."}**\n${delta >= 0 ? "+" : ""}${formatCurrency(delta, currency)} | Balance: ${formatCurrency(newBal, currency)}`
    )
    .setColor(result === "win" ? 0x2ecc71 : result === "push" ? 0x95a5a6 : 0xe74c3c);
  await interaction.editReply({ embeds: [embed] });
}

export async function handleMaxbet(interaction: ChatInputCommandInteraction): Promise<void> {
  if (!await requireRole(interaction, "avivadmin")) return;
  const server = await getServerForInteraction(interaction);
  if (!server) return;
  const amount = interaction.options.getInteger("amount", true);
  await db.setConfig(server.id, "maxbet", String(amount));
  await interaction.reply({ content: `Max bet set to ${amount} on Server ${server.server_number}.`, flags: MessageFlags.Ephemeral });
}
