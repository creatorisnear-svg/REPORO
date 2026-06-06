import type { ChatInputCommandInteraction, StringSelectMenuInteraction, ButtonInteraction } from "discord.js";
import {
  EmbedBuilder,
  ActionRowBuilder,
  StringSelectMenuBuilder,
  StringSelectMenuOptionBuilder,
  ButtonBuilder,
  ButtonStyle,
} from "discord.js";
import * as db from "@workspace/db";
import { getServerForInteraction, requireRole, getLinkedName } from "./utils.js";
import { rconManager } from "../../rcon/manager.js";

const shopClosed = new Map<number, number>(); // serverId -> close until timestamp

async function getCurrencyName(serverId: number): Promise<string> {
  return (await db.getConfig(serverId, "currency_name")) ?? "coins";
}

function isKit(shortname: string): boolean {
  return shortname.startsWith("kit:");
}

function kitName(shortname: string): string {
  return shortname.slice(4);
}

// ---- Main /shop command ----

export async function handleShop(interaction: ChatInputCommandInteraction): Promise<void> {
  if (!interaction.guild) {
    await interaction.reply({ content: "Must be used in a server.", ephemeral: true });
    return;
  }

  await interaction.deferReply({ ephemeral: true });

  // If multiple servers exist and no server specified, show server picker
  const serverNum = interaction.options.getInteger("server");
  if (!serverNum) {
    const allServers = await db.getServersByGuild(interaction.guild.id);
    if (allServers.length === 0) {
      await interaction.editReply({ content: "No servers configured. Use /add-server first." });
      return;
    }
    if (allServers.length > 1) {
      const select = new StringSelectMenuBuilder()
        .setCustomId("shop:srv")
        .setPlaceholder("Which server do you want to shop on?")
        .addOptions(
          allServers.map(s =>
            new StringSelectMenuOptionBuilder()
              .setLabel(`Server ${s.server_number}: ${s.server_label}`)
              .setValue(String(s.id))
          )
        );
      const row = new ActionRowBuilder<StringSelectMenuBuilder>().addComponents(select);
      await interaction.editReply({ content: "Select which server to shop on:", components: [row] });
      return;
    }
    // Only one server — go straight to categories
    await showCategories(interaction, allServers[0]!.id, allServers[0]!);
    return;
  }

  const server = await getServerForInteraction(interaction);
  if (!server) return;
  await showCategories(interaction, server.id, server);
}

// ---- Show categories ----

async function showCategories(
  interaction: ChatInputCommandInteraction | StringSelectMenuInteraction,
  serverId: number,
  server: db.ServerRow
): Promise<void> {
  const closedUntil = shopClosed.get(serverId);
  if (closedUntil && Date.now() < closedUntil) {
    const remaining = Math.ceil((closedUntil - Date.now()) / 60000);
    const msg = { content: `The shop is closed for ~${remaining} more minute(s).`, components: [] };
    if (interaction.isStringSelectMenu()) await interaction.update(msg);
    else await interaction.editReply(msg);
    return;
  }

  const ingameName = interaction.isStringSelectMenu()
    ? await (async () => {
        const p = await db.getPlayerByDiscord(serverId, interaction.user.id);
        return p?.ingame_name ?? null;
      })()
    : await getLinkedName(interaction as ChatInputCommandInteraction, serverId);

  if (!ingameName) {
    const msg = { content: "You must link your account before using the shop. Use /link.", components: [] };
    if (interaction.isStringSelectMenu()) await interaction.update(msg);
    else await interaction.editReply(msg);
    return;
  }

  const categories = await db.getShopCategories(serverId);
  const topLevel = categories.filter(c => !c.parent_id);

  if (topLevel.length === 0) {
    const msg = { content: "The shop has no categories yet.", components: [] };
    if (interaction.isStringSelectMenu()) await interaction.update(msg);
    else await interaction.editReply(msg);
    return;
  }

  const currency = await getCurrencyName(serverId);
  const eco = await db.getEconomy(serverId, ingameName);
  const balance = eco?.balance ?? 0;

  const select = new StringSelectMenuBuilder()
    .setCustomId(`shop:s${serverId}:cats`)
    .setPlaceholder("Browse a category...")
    .addOptions(
      topLevel.slice(0, 25).map(c =>
        new StringSelectMenuOptionBuilder()
          .setLabel(c.name)
          .setValue(`${serverId}:${c.id}`)
          .setDescription(c.category_type === "kit" ? "Kits" : "Items")
      )
    );

  const row = new ActionRowBuilder<StringSelectMenuBuilder>().addComponents(select);

  const embed = new EmbedBuilder()
    .setTitle(`Shop — Server ${server.server_number}: ${server.server_label}`)
    .setDescription(`**Your balance:** ${balance} ${currency}\n\nSelect a category below to browse items.`)
    .setColor(0xe07a32)
    .setFooter({ text: "Select a category to see items and prices" });

  const payload = { embeds: [embed], components: [row] };
  if (interaction.isStringSelectMenu()) await interaction.update(payload);
  else await interaction.editReply(payload);
}

// ---- Show items in a category ----

async function showCategory(
  interaction: StringSelectMenuInteraction,
  serverId: number,
  catId: number
): Promise<void> {
  const products = await db.getShopProducts(catId);
  const categories = await db.getShopCategories(serverId);
  const cat = categories.find(c => c.id === catId);
  const currency = await getCurrencyName(serverId);

  if (products.length === 0) {
    // Show subcategories if any
    const subs = categories.filter(c => c.parent_id === catId);
    if (subs.length > 0) {
      const select = new StringSelectMenuBuilder()
        .setCustomId(`shop:s${serverId}:cats`)
        .setPlaceholder("Select a subcategory...")
        .addOptions(
          subs.slice(0, 25).map(c =>
            new StringSelectMenuOptionBuilder()
              .setLabel(c.name)
              .setValue(`${serverId}:${c.id}`)
          )
        );
      await interaction.update({
        embeds: [new EmbedBuilder().setTitle(cat?.name ?? "Category").setColor(0xe07a32).setDescription("Choose a subcategory:")],
        components: [new ActionRowBuilder<StringSelectMenuBuilder>().addComponents(select)],
      });
      return;
    }
    await interaction.update({ content: "This category has no items yet.", embeds: [], components: [] });
    return;
  }

  const select = new StringSelectMenuBuilder()
    .setCustomId(`shop:s${serverId}:items`)
    .setPlaceholder("Select an item to view and buy...")
    .addOptions(
      products.slice(0, 25).map(p => {
        const stockLabel = p.stock === -1 ? "unlimited" : `${p.stock} left`;
        const timerLabel = p.timer_hours > 0 ? ` | ${p.timer_hours}h cooldown` : "";
        return new StringSelectMenuOptionBuilder()
          .setLabel(p.name)
          .setValue(`${serverId}:${p.id}`)
          .setDescription(`${p.price} ${currency} | ${stockLabel}${timerLabel}`);
      })
    );

  const lines = products.map(p => {
    const stock = p.stock === -1 ? "unlimited" : `${p.stock} left`;
    const timer = p.timer_hours > 0 ? ` | ${p.timer_hours}h cooldown` : "";
    const type = isKit(p.shortname) ? " [KIT]" : "";
    return `**${p.name}**${type} — ${p.price} ${currency} | ${stock}${timer}`;
  });

  const embed = new EmbedBuilder()
    .setTitle(cat?.name ?? "Items")
    .setDescription(lines.join("\n").substring(0, 4096))
    .setColor(0xe07a32);

  await interaction.update({
    embeds: [embed],
    components: [new ActionRowBuilder<StringSelectMenuBuilder>().addComponents(select)],
  });
}

// ---- Show item detail with quantity + buy ----

async function showItemDetail(
  interaction: StringSelectMenuInteraction | ButtonInteraction,
  serverId: number,
  productId: number,
  qty: number
): Promise<void> {
  const product = await db.getShopProductById(productId);
  if (!product) {
    await interaction.update({ content: "Item not found.", embeds: [], components: [] });
    return;
  }

  const currency = await getCurrencyName(serverId);
  const isKitItem = isKit(product.shortname);
  const effectiveQty = isKitItem ? 1 : qty;
  const totalCost = product.price * effectiveQty;
  const stock = product.stock === -1 ? "Unlimited" : `${product.stock} remaining`;
  const timer = product.timer_hours > 0 ? `${product.timer_hours}h cooldown between purchases` : "No cooldown";

  const embed = new EmbedBuilder()
    .setTitle(`${product.name}${isKitItem ? " [KIT]" : ""}`)
    .setColor(0xe07a32)
    .addFields(
      { name: "Price", value: `${product.price} ${currency} per unit`, inline: true },
      { name: "Stock", value: stock, inline: true },
      { name: "Cooldown", value: timer, inline: true },
      { name: "Total Cost", value: `**${totalCost} ${currency}**${effectiveQty > 1 ? ` (${effectiveQty}x)` : ""}`, inline: false }
    );

  const rows: ActionRowBuilder<ButtonBuilder>[] = [];

  // Quantity row (only for non-kit items)
  if (!isKitItem) {
    const qtyRow = new ActionRowBuilder<ButtonBuilder>().addComponents(
      [1, 2, 3, 5, 10].map(q =>
        new ButtonBuilder()
          .setCustomId(`shop:s${serverId}:i${productId}:q${q}`)
          .setLabel(`x${q}`)
          .setStyle(q === effectiveQty ? ButtonStyle.Primary : ButtonStyle.Secondary)
      )
    );
    rows.push(qtyRow);
  }

  // Buy + back buttons
  const actionRow = new ActionRowBuilder<ButtonBuilder>().addComponents(
    new ButtonBuilder()
      .setCustomId(`shop:s${serverId}:buy:p${productId}:q${effectiveQty}`)
      .setLabel(`Buy${effectiveQty > 1 ? ` x${effectiveQty}` : ""} for ${totalCost} ${currency}`)
      .setStyle(ButtonStyle.Success),
    new ButtonBuilder()
      .setCustomId(`shop:s${serverId}:back`)
      .setLabel("Back to Shop")
      .setStyle(ButtonStyle.Secondary)
  );
  rows.push(actionRow);

  await interaction.update({ embeds: [embed], components: rows });
}

// ---- Execute purchase ----

async function executePurchase(
  interaction: ButtonInteraction,
  serverId: number,
  productId: number,
  qty: number
): Promise<void> {
  const product = await db.getShopProductById(productId);
  if (!product) {
    await interaction.update({ content: "Item not found.", embeds: [], components: [] });
    return;
  }

  const ingameName = await (async () => {
    const p = await db.getPlayerByDiscord(serverId, interaction.user.id);
    return p?.ingame_name ?? null;
  })();

  if (!ingameName) {
    await interaction.update({ content: "You must be linked to buy items. Use /link.", embeds: [], components: [] });
    return;
  }

  const server = await db.getServerById(serverId);
  if (!server?.rcon_host) {
    await interaction.update({ content: "Server RCON not configured.", embeds: [], components: [] });
    return;
  }

  const isKitItem = isKit(product.shortname);
  const effectiveQty = isKitItem ? 1 : qty;
  const totalCost = product.price * effectiveQty;
  const currency = await getCurrencyName(serverId);

  // Check timer/cooldown
  if (product.timer_hours > 0) {
    const last = await db.getLastShopPurchase(serverId, ingameName, productId);
    if (last) {
      const lastMs = new Date(last.purchased_at).getTime();
      const cooldownMs = product.timer_hours * 3600_000;
      const remaining = lastMs + cooldownMs - Date.now();
      if (remaining > 0) {
        const hours = Math.floor(remaining / 3600_000);
        const mins = Math.ceil((remaining % 3600_000) / 60_000);
        await interaction.update({
          content: `You need to wait **${hours}h ${mins}m** before buying **${product.name}** again.`,
          embeds: [],
          components: [],
        });
        return;
      }
    }
  }

  // Check stock
  if (product.stock !== -1 && product.stock < effectiveQty) {
    await interaction.update({
      content: product.stock === 0
        ? `**${product.name}** is out of stock.`
        : `Only **${product.stock}** of **${product.name}** left — reduce your quantity.`,
      embeds: [],
      components: [],
    });
    return;
  }

  // Check balance
  const balance = await db.getBalance(serverId, ingameName);
  if (balance < totalCost) {
    await interaction.update({
      content: `You need **${totalCost} ${currency}** but only have **${balance} ${currency}**.`,
      embeds: [],
      components: [],
    });
    return;
  }

  // Deduct coins
  await db.updateBalance(serverId, ingameName, -totalCost);

  // Deliver via RCON
  let rconOk = true;
  let rconError = "";
  try {
    if (isKitItem) {
      await rconManager.sendCommand(
        server.id, server.rcon_host, server.rcon_port!, server.rcon_password!,
        `giveto ${ingameName} ${kitName(product.shortname)}`
      );
    } else {
      for (let i = 0; i < effectiveQty; i++) {
        await rconManager.sendCommand(
          server.id, server.rcon_host, server.rcon_port!, server.rcon_password!,
          `inventory.give "${ingameName}" "${product.shortname}" 1`
        );
      }
    }
  } catch (err) {
    rconOk = false;
    rconError = String(err);
    // Refund coins if RCON failed
    await db.updateBalance(serverId, ingameName, totalCost);
  }

  if (!rconOk) {
    await interaction.update({
      content: `Purchase failed — could not deliver item via RCON. Your coins were not charged.\nError: ${rconError}`,
      embeds: [],
      components: [],
    });
    return;
  }

  // Decrement stock if limited
  if (product.stock !== -1) {
    await db.decrementShopStock(productId, effectiveQty);
  }

  // Record purchase
  await db.recordShopPurchase(serverId, ingameName, productId);

  const newBalance = balance - totalCost;

  // Log to cmd-logs channel
  if (interaction.guild) {
    const logsChannelId = await db.getChannel(server.id, "cmd-logs");
    if (logsChannelId) {
      const ch = interaction.guild.channels.cache.get(logsChannelId);
      if (ch && ch.isTextBased()) {
        await ch.send(`[SHOP] ${interaction.user.tag} purchased **${product.name}**${effectiveQty > 1 ? ` x${effectiveQty}` : ""} for ${totalCost} ${currency} | In-game: ${ingameName} | Server ${server.server_number}`).catch(() => null);
      }
    }
  }

  const successEmbed = new EmbedBuilder()
    .setTitle("Purchase Successful")
    .setColor(0x3dba8c)
    .setDescription(`**${product.name}**${effectiveQty > 1 ? ` x${effectiveQty}` : ""} has been delivered to **${ingameName}** in-game.`)
    .addFields(
      { name: "Charged", value: `${totalCost} ${currency}`, inline: true },
      { name: "Remaining Balance", value: `${newBalance} ${currency}`, inline: true }
    )
    .setFooter({ text: `Server ${server.server_number}: ${server.server_label}` });

  const backBtn = new ActionRowBuilder<ButtonBuilder>().addComponents(
    new ButtonBuilder()
      .setCustomId(`shop:s${serverId}:back`)
      .setLabel("Keep Shopping")
      .setStyle(ButtonStyle.Secondary)
  );

  await interaction.update({ embeds: [successEmbed], components: [backBtn] });
}

// ---- Main interaction router for all shop interactions ----

export async function handleShopInteraction(
  interaction: StringSelectMenuInteraction | ButtonInteraction
): Promise<void> {
  const id = interaction.customId;

  // Server picker: shop:srv
  if (id === "shop:srv" && interaction.isStringSelectMenu()) {
    const [serverId] = interaction.values[0]!.split(":");
    const server = await db.getServerById(Number(serverId));
    if (!server) { await interaction.update({ content: "Server not found.", components: [] }); return; }
    await showCategories(interaction, server.id, server);
    return;
  }

  // Category list select: shop:s<id>:cats -> value is "<serverId>:<catId>"
  if (id.startsWith("shop:s") && id.endsWith(":cats") && interaction.isStringSelectMenu()) {
    const [serverId, catId] = interaction.values[0]!.split(":");
    await showCategory(interaction, Number(serverId), Number(catId));
    return;
  }

  // Item list select: shop:s<id>:items -> value is "<serverId>:<productId>"
  if (id.startsWith("shop:s") && id.endsWith(":items") && interaction.isStringSelectMenu()) {
    const [serverId, productId] = interaction.values[0]!.split(":");
    await showItemDetail(interaction, Number(serverId), Number(productId), 1);
    return;
  }

  // Quantity button: shop:s<srvId>:i<productId>:q<qty>
  const qtyMatch = id.match(/^shop:s(\d+):i(\d+):q(\d+)$/);
  if (qtyMatch && interaction.isButton()) {
    await showItemDetail(interaction, Number(qtyMatch[1]), Number(qtyMatch[2]), Number(qtyMatch[3]));
    return;
  }

  // Buy button: shop:s<srvId>:buy:p<productId>:q<qty>
  const buyMatch = id.match(/^shop:s(\d+):buy:p(\d+):q(\d+)$/);
  if (buyMatch && interaction.isButton()) {
    await executePurchase(interaction, Number(buyMatch[1]), Number(buyMatch[2]), Number(buyMatch[3]));
    return;
  }

  // Back button: shop:s<srvId>:back
  const backMatch = id.match(/^shop:s(\d+):back$/);
  if (backMatch && interaction.isButton()) {
    const server = await db.getServerById(Number(backMatch[1]));
    if (server) await showCategories(interaction, server.id, server);
    return;
  }
}

// ---- Admin commands (unchanged logic) ----

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
  await interaction.reply({ content: `Item **${name}** (\`${shortname}\`) added for ${price} coins (ID: ${id}).`, ephemeral: true });
}

export async function handleAdminShopAddKit(interaction: ChatInputCommandInteraction): Promise<void> {
  if (!await requireRole(interaction, "avivadmin")) return;
  const server = await getServerForInteraction(interaction);
  if (!server) return;
  const kName = interaction.options.getString("kit_name", true);
  const price = interaction.options.getInteger("price", true);
  const categoryName = interaction.options.getString("category", true);
  const timerHours = interaction.options.getInteger("timer_hours") ?? 0;

  const categories = await db.getShopCategories(server.id);
  const cat = categories.find(c => c.name.toLowerCase() === categoryName.toLowerCase());
  if (!cat) { await interaction.reply({ content: `Category "${categoryName}" not found.`, ephemeral: true }); return; }

  const id = await db.addShopProduct(cat.id, kName, `kit:${kName}`, price, timerHours);
  await interaction.reply({ content: `Kit **${kName}** added for ${price} coins (ID: ${id}).`, ephemeral: true });
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
