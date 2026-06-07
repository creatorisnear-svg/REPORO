import type { ChatInputCommandInteraction } from "discord.js";
import { EmbedBuilder, MessageFlags } from "discord.js";
import * as db from "@workspace/db";
import { getServerForInteraction, getLinkedName, requireRole } from "./utils.js";

async function getCurrencyName(serverId: number): Promise<string> {
  return (await db.getConfig(serverId, "currency_name")) ?? "coins";
}

export async function handleBank(interaction: ChatInputCommandInteraction): Promise<void> {
  const server = await getServerForInteraction(interaction);
  if (!server) return;
  await interaction.deferReply({ flags: MessageFlags.Ephemeral });

  const ingameName = await getLinkedName(interaction, server.id);
  if (!ingameName) {
    await interaction.editReply({ content: "You need to link your account with `/link` first." });
    return;
  }

  const subcommand = interaction.options.getSubcommand(true);
  const currency = await getCurrencyName(server.id);

  if (subcommand === "balance") {
    await db.ensureEconomy(server.id, ingameName);
    const wallet = await db.getBalance(server.id, ingameName);
    const bank = await db.getBankBalance(server.id, ingameName);

    const embed = new EmbedBuilder()
      .setTitle(`🏦 Bank — ${ingameName}`)
      .setColor(0xf1c40f)
      .addFields(
        { name: `💰 Wallet`, value: `${wallet} ${currency}`, inline: true },
        { name: `🏦 Bank`, value: `${bank} ${currency}`, inline: true },
        { name: `📊 Total`, value: `${wallet + bank} ${currency}`, inline: true },
      )
      .setFooter({ text: `Server ${server.server_number} | Use /bank deposit or /bank withdraw to move funds` });

    await interaction.editReply({ embeds: [embed] });
    return;
  }

  if (subcommand === "deposit") {
    const amount = interaction.options.getInteger("amount", true);
    if (amount < 1) {
      await interaction.editReply({ content: "Amount must be at least 1." });
      return;
    }

    await db.ensureEconomy(server.id, ingameName);
    const wallet = await db.getBalance(server.id, ingameName);

    if (wallet < amount) {
      await interaction.editReply({ content: `You only have **${wallet} ${currency}** in your wallet. You cannot deposit more than that.` });
      return;
    }

    await db.updateBalance(server.id, ingameName, -amount);
    await db.updateBankBalance(server.id, ingameName, amount);

    const newWallet = wallet - amount;
    const newBank = await db.getBankBalance(server.id, ingameName);

    const embed = new EmbedBuilder()
      .setTitle("🏦 Deposit Successful")
      .setColor(0x2ecc71)
      .setDescription(`Deposited **${amount} ${currency}** into your bank.`)
      .addFields(
        { name: "💰 Wallet", value: `${newWallet} ${currency}`, inline: true },
        { name: "🏦 Bank", value: `${newBank} ${currency}`, inline: true },
      );

    await interaction.editReply({ embeds: [embed] });
    return;
  }

  if (subcommand === "withdraw") {
    const amount = interaction.options.getInteger("amount", true);
    if (amount < 1) {
      await interaction.editReply({ content: "Amount must be at least 1." });
      return;
    }

    await db.ensureEconomy(server.id, ingameName);
    const bank = await db.getBankBalance(server.id, ingameName);

    if (bank < amount) {
      await interaction.editReply({ content: `You only have **${bank} ${currency}** in your bank. You cannot withdraw more than that.` });
      return;
    }

    await db.updateBankBalance(server.id, ingameName, -amount);
    await db.updateBalance(server.id, ingameName, amount);

    const newWallet = await db.getBalance(server.id, ingameName);
    const newBank = bank - amount;

    const embed = new EmbedBuilder()
      .setTitle("🏦 Withdrawal Successful")
      .setColor(0x2ecc71)
      .setDescription(`Withdrew **${amount} ${currency}** from your bank to your wallet.`)
      .addFields(
        { name: "💰 Wallet", value: `${newWallet} ${currency}`, inline: true },
        { name: "🏦 Bank", value: `${newBank} ${currency}`, inline: true },
      );

    await interaction.editReply({ embeds: [embed] });
    return;
  }

  await interaction.editReply({ content: "Unknown subcommand." });
}

export async function handleWipeBank(interaction: ChatInputCommandInteraction): Promise<void> {
  if (!await requireRole(interaction, "avivadmin")) return;
  const server = await getServerForInteraction(interaction);
  if (!server) return;
  await interaction.deferReply({ flags: MessageFlags.Ephemeral });

  await db.wipeBankBalances(server.id);
  await interaction.editReply({ content: `All bank balances wiped on Server ${server.server_number}.` });
}
