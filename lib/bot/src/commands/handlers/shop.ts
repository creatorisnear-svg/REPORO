import type { ChatInputCommandInteraction } from "discord.js";
import { EmbedBuilder } from "discord.js";
import * as db from "@workspace/db";
import { getServerForInteraction, requireRole, getLinkedName } from "./utils.js";
import { rconManager } from "../../rcon/manager.js";

const shopClosed = new Map<number, number>(); // serverId -> close until timestamp

async function getCurrencyName(serverId: number): Promise<string> {
  return (await db.getConfig(serverId, "currency_name")) ?? "coins";
}

export async function handleShop(interaction: ChatInputCommandInteraction): Promise<void> {
  const server = await getServerForInteraction(interaction);
  if (!server) return;
  await interaction.deferReply({ ephemeral: true });

  const closedUntil = shopClosed.get(server.id);
  if (closedUntil && Date.now() < closedUntil) {
    const remaining = Math.ceil((closedUntil - Date.now()) / 60000);
    await interaction.editReply({ content: `The shop is temporarily closed. Reopens in ~${remaining} minute(s).` });
    return;
  }

  const ingameName = await getLinkedName(interaction, server.id);
  if (!ingameName) { await interaction.editReply({ content: "You must be linked to use the shop. Use /link." }); return; }

  const categories = await db.getShopCategories(server.id);
  const topLevel = categories.filter(c => !c.parent_id);
  if (topLevel.length === 0) { await interaction.editReply({ content: "The shop is empty." }); return; }

  const currency = await getCurrencyName(server.id);
  const eco = await db.getEconomy(server.id, ingameName);
  const balance = eco?.balance ?? 0;

  const lines: string[] = [`**Your balance:** ${balance} ${currency}\n`];
  for (const cat of topLevel) {
    lines.push(`**[${cat.name}]** (${cat.category_type})`);
    const products = await db.getShopProducts(cat.id);
    for (const p of products) {
      const stock = p.stock === -1 ? "unlimited" : String(p.stock);
      const timer = p.timer_hours > 0 ? ` [${p.timer_hours}h timer]` : "";
      lines.push(`  ${p.name} — ${p.price} ${currency} | stock: ${stock}${timer}`);
    }
    // Subcategories
    const subs = categories.filter(c => c.parent_id === cat.id);
    for (const sub of subs) {
      lines.push(`  **[${sub.name}]**`);
      const subProducts = await db.getShopProducts(sub.id);
      for (const p of subProducts) {
        lines.push(`    ${p.name} — ${p.price} ${currency}`);
      }
    }
  }

  const embed = new EmbedBuilder()
    .setTitle(`Shop — Server ${server.server_number}`)
    .setDescription(lines.join("\n").substring(0, 4096))
    .setColor(0x27ae60)
    .setFooter({ text: "Contact an admin to purchase items" });

  await interaction.editReply({ embeds: [embed] });
}

export async function handleAdminShopCreateShop(interaction: ChatInputCommandInteraction): Promise<void> {
  if (!await requireRole(interaction, "avivadmin")) return;
  await interaction.reply({ content: "Shop initialized. Use /admin-shop-add-category to add categories.", ephemeral: true });
}

export async function handleAdminShopDeleteShop(interaction: ChatInputCommandInteraction): Promise<void> {
  if (!await requireRole(interaction, "avivadmin")) return;
  const server = await getServerForInteraction(interaction);
  if (!server) return;
  await db.db.execute({ sql: "DELETE FROM shop_products WHERE category_id IN (SELECT id FROM shop_categories WHERE server_id = ?)", args: [server.id] });
  await db.db.execute({ sql: "DELETE FROM shop_categories WHERE server_id = ?", args: [server.id] });
  await interaction.reply({ content: "Shop deleted.", ephemeral: true });
}

export async function handleAdminShopAddCategory(interaction: ChatInputCommandInteraction): Promise<void> {
  if (!await requireRole(interaction, "avivadmin")) return;
  const server = await getServerForInteraction(interaction);
  if (!server) return;
  const name = interaction.options.getString("name", true);
  const type = interaction.options.getString("type") ?? "item";
  const id = await db.addShopCategory(server.id, name, null, type);
  await interaction.reply({ content: `Category **${name}** created (ID: ${id}).`, ephemeral: true });
}

export async function handleAdminShopAddSubcategory(interaction: ChatInputCommandInteraction): Promise<void> {
  if (!await requireRole(interaction, "avivadmin")) return;
  const server = await getServerForInteraction(interaction);
  if (!server) return;
  const name = interaction.options.getString("name", true);
  const parentName = interaction.options.getString("parent", true);
  const categories = await db.getShopCategories(server.id);
  const parent = categories.find(c => c.name.toLowerCase() === parentName.toLowerCase());
  if (!parent) { await interaction.reply({ content: `Category "${parentName}" not found.`, ephemeral: true }); return; }
  const id = await db.addShopCategory(server.id, name, parent.id, "item");
  await interaction.reply({ content: `Subcategory **${name}** under **${parent.name}** created (ID: ${id}).`, ephemeral: true });
}

export async function handleAdminShopAddItem(interaction: ChatInputCommandInteraction): Promise<void> {
  if (!await requireRole(interaction, "avivadmin")) return;
  const server = await getServerForInteraction(interaction);
  if (!server) return;
  const name = interaction.options.getString("name", true);
  const shortname = interaction.options.getString("shortname", true);
  const price = interaction.options.getInteger("price", true);
  const categoryName = interaction.options.getString("category", true);
  const timerHours = interaction.options.getInteger("timer_hours") ?? 0;

  const categories = await db.getShopCategories(server.id);
  const cat = categories.find(c => c.name.toLowerCase() === categoryName.toLowerCase());
  if (!cat) { await interaction.reply({ content: `Category "${categoryName}" not found.`, ephemeral: true }); return; }

  const id = await db.addShopProduct(cat.id, name, shortname, price, timerHours);
  await interaction.reply({ content: `Item **${name}** (${shortname}) added for ${price} coins (ID: ${id}).`, ephemeral: true });
}

export async function handleAdminShopAddKit(interaction: ChatInputCommandInteraction): Promise<void> {
  if (!await requireRole(interaction, "avivadmin")) return;
  const server = await getServerForInteraction(interaction);
  if (!server) return;
  const kitName = interaction.options.getString("kit_name", true);
  const price = interaction.options.getInteger("price", true);
  const categoryName = interaction.options.getString("category", true);
  const timerHours = interaction.options.getInteger("timer_hours") ?? 0;

  const categories = await db.getShopCategories(server.id);
  const cat = categories.find(c => c.name.toLowerCase() === categoryName.toLowerCase());
  if (!cat) { await interaction.reply({ content: `Category "${categoryName}" not found.`, ephemeral: true }); return; }

  const id = await db.addShopProduct(cat.id, kitName, `kit:${kitName}`, price, timerHours);
  await interaction.reply({ content: `Kit **${kitName}** added for ${price} coins (ID: ${id}).`, ephemeral: true });
}

export async function handleAdminShopEditProduct(interaction: ChatInputCommandInteraction): Promise<void> {
  if (!await requireRole(interaction, "avivadmin")) return;
  const server = await getServerForInteraction(interaction);
  if (!server) return;
  const productId = interaction.options.getInteger("product_id", true);
  const price = interaction.options.getInteger("price");
  const stock = interaction.options.getInteger("stock");

  if (price !== null) {
    await db.db.execute({ sql: "UPDATE shop_products SET price = ? WHERE id = ?", args: [price, productId] });
  }
  if (stock !== null) {
    await db.db.execute({ sql: "UPDATE shop_products SET stock = ? WHERE id = ?", args: [stock, productId] });
  }
  await interaction.reply({ content: `Product ${productId} updated.`, ephemeral: true });
}

export async function handleAdminShopRemoveProduct(interaction: ChatInputCommandInteraction): Promise<void> {
  if (!await requireRole(interaction, "avivadmin")) return;
  const productId = interaction.options.getInteger("product_id", true);
  await db.removeShopProduct(productId);
  await interaction.reply({ content: `Product ${productId} removed.`, ephemeral: true });
}

export async function handleDelayshop(interaction: ChatInputCommandInteraction): Promise<void> {
  if (!await requireRole(interaction, "avivadmin")) return;
  const server = await getServerForInteraction(interaction);
  if (!server) return;
  const minutes = interaction.options.getInteger("minutes", true);
  shopClosed.set(server.id, Date.now() + minutes * 60000);
  await interaction.reply({ content: `Shop closed for ${minutes} minute(s).`, ephemeral: true });
}

export async function handleOpenshop(interaction: ChatInputCommandInteraction): Promise<void> {
  if (!await requireRole(interaction, "avivadmin")) return;
  const server = await getServerForInteraction(interaction);
  if (!server) return;
  shopClosed.delete(server.id);
  await interaction.reply({ content: "Shop reopened.", ephemeral: true });
}
