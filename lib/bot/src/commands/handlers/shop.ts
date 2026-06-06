import type {
  ChatInputCommandInteraction,
  StringSelectMenuInteraction,
  ButtonInteraction,
  Guild,
} from "discord.js";
import {
  EmbedBuilder,
  ActionRowBuilder,
  StringSelectMenuBuilder,
  StringSelectMenuOptionBuilder,
  ButtonBuilder,
  ButtonStyle,
  MessageFlags,
} from "discord.js";
import * as db from "@workspace/db";
import { getServerForInteraction, requireRole } from "./utils.js";
import { rconManager } from "../../rcon/manager.js";

// ---- In-memory baskets: key = `${userId}:${serverId}` ----
interface BasketItem { productId: number; qty: number; }
const baskets = new Map<string, Map<number, number>>();

function basketKey(userId: string, serverId: number) { return `${userId}:${serverId}`; }
function getBasket(userId: string, serverId: number): Map<number, number> {
  const key = basketKey(userId, serverId);
  if (!baskets.has(key)) baskets.set(key, new Map());
  return baskets.get(key)!;
}
function clearBasket(userId: string, serverId: number) { baskets.delete(basketKey(userId, serverId)); }

// ---- Shop closed map ----
const shopClosed = new Map<number, number>();

// ---- Helpers ----
function isKit(shortname: string) { return shortname.startsWith("kit:"); }
function kitName(shortname: string) { return shortname.slice(4); }

async function getCurrency(serverId: number) {
  return (await db.getConfig(serverId, "currency_name")) ?? "coins";
}

async function getIngameName(serverId: number, userId: string): Promise<string | null> {
  const p = await db.getPlayerByDiscord(serverId, userId);
  return p?.ingame_name ?? null;
}

// ---- Build the shop UI (category select + optional basket rows) ----

async function buildShopMessage(
  userId: string,
  serverId: number,
  server: db.ServerRow,
  selectedCatId?: number
) {
  const currency = await getCurrency(serverId);
  const ingameName = await getIngameName(serverId, userId);
  const balance = ingameName ? await db.getBalance(serverId, ingameName) : 0;

  const basket = getBasket(userId, serverId);
  const basketEntries = [...basket.entries()]; // [productId, qty]

  // Resolve product names for basket display
  const basketProducts: Array<{ product: db.ShopProductRow; qty: number }> = [];
  let basketCost = 0;
  for (const [pid, qty] of basketEntries) {
    const product = await db.getShopProductById(pid);
    if (product) {
      basketProducts.push({ product, qty });
      basketCost += product.price * qty;
    }
  }

  // Build embed
  let embedDesc = `**Your balance:** ${balance} ${currency}\n\n`;
  if (basketProducts.length > 0) {
    const lines = basketProducts.map(b => `• ${b.qty}x ${b.product.name}`);
    embedDesc += lines.join("\n");
    embedDesc += `\n\n——————————————\nSTART BALANCE: ${balance}\nBASKET COST: ${basketCost}\nAFTER BALANCE: ${balance - basketCost}`;
  } else {
    embedDesc += "Select a category to browse items and add them to your basket.";
  }

  const embed = new EmbedBuilder()
    .setTitle(basketProducts.length > 0 ? `Your Basket` : `Shop — Server ${server.server_number}: ${server.server_label}`)
    .setDescription(embedDesc)
    .setColor(basketProducts.length > 0 ? 0xe07a32 : 0x2b2d31)
    .setFooter({ text: `Server ${server.server_number}: ${server.server_label}` });

  const rows: ActionRowBuilder<StringSelectMenuBuilder | ButtonBuilder>[] = [];

  // Row 1: Category select
  const categories = await db.getShopCategories(serverId);
  const topLevel = categories.filter(c => !c.parent_id).slice(0, 25);
  if (topLevel.length > 0) {
    const catSelect = new StringSelectMenuBuilder()
      .setCustomId(`shop:s${serverId}:cats`)
      .setPlaceholder(basketProducts.length > 0 ? "Add more items..." : "Select a category")
      .addOptions(
        topLevel.map(c =>
          new StringSelectMenuOptionBuilder()
            .setLabel(c.name)
            .setValue(`${serverId}:${c.id}`)
            .setDescription(c.category_type === "kit" ? "Kits" : "Items")
            .setDefault(c.id === selectedCatId)
        )
      );
    rows.push(new ActionRowBuilder<StringSelectMenuBuilder>().addComponents(catSelect));
  }

  // Rows 2-4: only when basket has items
  if (basketProducts.length > 0) {
    // Row 2: Remove item select
    const removeSelect = new StringSelectMenuBuilder()
      .setCustomId(`shop:s${serverId}:rm`)
      .setPlaceholder("Select an item to remove")
      .addOptions(
        basketProducts.map(b =>
          new StringSelectMenuOptionBuilder()
            .setLabel(`${b.product.name} (x${b.qty})`)
            .setValue(`${serverId}:${b.product.id}`)
        )
      );
    rows.push(new ActionRowBuilder<StringSelectMenuBuilder>().addComponents(removeSelect));

    // Row 3: Adjust qty select
    const adjSelect = new StringSelectMenuBuilder()
      .setCustomId(`shop:s${serverId}:adj`)
      .setPlaceholder("Select an item to adjust quantity")
      .addOptions(
        basketProducts.map(b =>
          new StringSelectMenuOptionBuilder()
            .setLabel(`${b.product.name} (x${b.qty})`)
            .setValue(`${serverId}:${b.product.id}`)
        )
      );
    rows.push(new ActionRowBuilder<StringSelectMenuBuilder>().addComponents(adjSelect));

    // Row 4: Cancel + Complete Purchase
    const actionRow = new ActionRowBuilder<ButtonBuilder>().addComponents(
      new ButtonBuilder()
        .setCustomId(`shop:s${serverId}:cancel`)
        .setLabel("Cancel Purchase")
        .setStyle(ButtonStyle.Danger),
      new ButtonBuilder()
        .setCustomId(`shop:s${serverId}:buy`)
        .setLabel(`Complete Purchase — ${basketCost} ${currency}`)
        .setStyle(ButtonStyle.Success)
    );
    rows.push(actionRow);
  }

  return { embeds: [embed], components: rows };
}

// ---- Build item select for a category ----

async function buildItemSelect(serverId: number, catId: number, currency: string) {
  const products = await db.getShopProducts(catId);
  if (products.length === 0) return null;
  return new StringSelectMenuBuilder()
    .setCustomId(`shop:s${serverId}:itms`)
    .setPlaceholder("Select an item to add to basket")
    .addOptions(
      products.slice(0, 25).map(p => {
        const stock = p.stock === -1 ? "unlimited" : `${p.stock} left`;
        const kitLabel = isKit(p.shortname) ? " [KIT]" : "";
        return new StringSelectMenuOptionBuilder()
          .setLabel(`${p.name}${kitLabel}`)
          .setValue(`${serverId}:${p.id}`)
          .setDescription(`${p.price} ${currency}  |  ${stock}${p.timer_hours > 0 ? `  |  ${p.timer_hours}h cooldown` : ""}`);
      })
    );
}

// ---- /shop entry point ----

export async function handleShop(interaction: ChatInputCommandInteraction): Promise<void> {
  if (!interaction.guild) { await interaction.reply({ content: "Must be used in a server.", flags: MessageFlags.Ephemeral }); return; }

  await interaction.deferReply({ flags: MessageFlags.Ephemeral });

  // Check if shop is closed
  const serverNum = interaction.options.getInteger("server");
  let server: db.ServerRow | null = null;

  if (!serverNum) {
    const all = await db.getServersByGuild(interaction.guild.id);
    if (all.length === 0) { await interaction.editReply({ content: "No servers configured. Use /add-server first." }); return; }
    if (all.length > 1) {
      // Show server picker
      const select = new StringSelectMenuBuilder()
        .setCustomId("shop:srv")
        .setPlaceholder("Which server do you want to shop on?")
        .addOptions(all.map(s =>
          new StringSelectMenuOptionBuilder()
            .setLabel(`${s.server_number} | ${s.server_label}`)
            .setValue(String(s.id))
        ));
      await interaction.editReply({
        embeds: [new EmbedBuilder().setTitle("Shop").setDescription("Select a server to shop on:").setColor(0x2b2d31)],
        components: [new ActionRowBuilder<StringSelectMenuBuilder>().addComponents(select)],
      });
      return;
    }
    server = all[0]!;
  } else {
    server = await getServerForInteraction(interaction);
    if (!server) return;
  }

  // Check shop closed
  const closedUntil = shopClosed.get(server.id);
  if (closedUntil && Date.now() < closedUntil) {
    const mins = Math.ceil((closedUntil - Date.now()) / 60000);
    await interaction.editReply({ content: `The shop is closed for ~${mins} more minute(s).` });
    return;
  }

  // Check linked
  const ingameName = await getIngameName(server.id, interaction.user.id);
  if (!ingameName) { await interaction.editReply({ content: "You must link your in-game name first. Use /link." }); return; }

  const msg = await buildShopMessage(interaction.user.id, server.id, server);
  await interaction.editReply(msg as Parameters<typeof interaction.editReply>[0]);
}

// ---- Interaction router ----

export async function handleShopInteraction(
  interaction: StringSelectMenuInteraction | ButtonInteraction
): Promise<void> {
  const id = interaction.customId;

  // Server picker
  if (id === "shop:srv" && interaction.isStringSelectMenu()) {
    const serverId = Number(interaction.values[0]);
    const server = await db.getServerById(serverId);
    if (!server) { await interaction.update({ content: "Server not found.", components: [], embeds: [] }); return; }
    const ingameName = await getIngameName(server.id, interaction.user.id);
    if (!ingameName) { await interaction.update({ content: "Link your account first with /link.", components: [], embeds: [] }); return; }
    const msg = await buildShopMessage(interaction.user.id, server.id, server);
    await interaction.update(msg as Parameters<typeof interaction.update>[0]);
    return;
  }

  // Category select: shop:s<id>:cats — value = "<srvId>:<catId>"
  const catsMatch = id.match(/^shop:s(\d+):cats$/);
  if (catsMatch && interaction.isStringSelectMenu()) {
    const [srvIdStr, catIdStr] = interaction.values[0]!.split(":");
    const serverId = Number(srvIdStr);
    const catId = Number(catIdStr);
    const currency = await getCurrency(serverId);
    const server = await db.getServerById(serverId);
    if (!server) { await interaction.update({ content: "Server not found.", embeds: [], components: [] }); return; }

    const categories = await db.getShopCategories(serverId);
    const cat = categories.find(c => c.id === catId);
    const itemSelect = await buildItemSelect(serverId, catId, currency);

    if (!itemSelect) {
      // Maybe subcategories
      const subs = categories.filter(c => c.parent_id === catId).slice(0, 25);
      if (subs.length > 0) {
        const subSelect = new StringSelectMenuBuilder()
          .setCustomId(`shop:s${serverId}:cats`)
          .setPlaceholder("Select a subcategory")
          .addOptions(subs.map(c =>
            new StringSelectMenuOptionBuilder().setLabel(c.name).setValue(`${serverId}:${c.id}`)
          ));
        await interaction.update({
          embeds: [new EmbedBuilder().setTitle(cat?.name ?? "Category").setColor(0x2b2d31).setDescription("Choose a subcategory:")],
          components: [new ActionRowBuilder<StringSelectMenuBuilder>().addComponents(subSelect)],
        });
      } else {
        await interaction.update({ content: "No items in this category.", embeds: [], components: [] });
      }
      return;
    }

    const shopMsg = await buildShopMessage(interaction.user.id, serverId, server, catId);
    // Replace category row with the item select, append others
    const itemRow = new ActionRowBuilder<StringSelectMenuBuilder>().addComponents(itemSelect);
    // Keep cat select as first row, item select as second, then basket rows
    const existingRows = shopMsg.components as ActionRowBuilder<StringSelectMenuBuilder | ButtonBuilder>[];
    const basketRows = existingRows.slice(1); // skip the cat row we rebuild
    const rows: ActionRowBuilder<StringSelectMenuBuilder | ButtonBuilder>[] = [existingRows[0]!, itemRow, ...basketRows];
    // Max 5 rows
    await interaction.update({ ...shopMsg, components: rows.slice(0, 5) } as Parameters<typeof interaction.update>[0]);
    return;
  }

  // Item select (add to basket): shop:s<id>:itms — value = "<srvId>:<productId>"
  const itmsMatch = id.match(/^shop:s(\d+):itms$/);
  if (itmsMatch && interaction.isStringSelectMenu()) {
    const [srvIdStr, productIdStr] = interaction.values[0]!.split(":");
    const serverId = Number(srvIdStr);
    const productId = Number(productIdStr);
    const basket = getBasket(interaction.user.id, serverId);
    const product = await db.getShopProductById(productId);
    if (!product) { await interaction.update({ content: "Item not found.", embeds: [], components: [] }); return; }

    const current = basket.get(productId) ?? 0;
    basket.set(productId, current + 1);

    const server = await db.getServerById(serverId);
    if (!server) { await interaction.update({ content: "Server not found.", embeds: [], components: [] }); return; }
    const msg = await buildShopMessage(interaction.user.id, serverId, server);
    await interaction.update(msg as Parameters<typeof interaction.update>[0]);
    return;
  }

  // Remove item: shop:s<id>:rm — value = "<srvId>:<productId>"
  const rmMatch = id.match(/^shop:s(\d+):rm$/);
  if (rmMatch && interaction.isStringSelectMenu()) {
    const [srvIdStr, productIdStr] = interaction.values[0]!.split(":");
    const serverId = Number(srvIdStr);
    const productId = Number(productIdStr);
    const basket = getBasket(interaction.user.id, serverId);
    basket.delete(productId);
    const server = await db.getServerById(serverId);
    if (!server) { await interaction.update({ content: "Server not found.", embeds: [], components: [] }); return; }
    const msg = await buildShopMessage(interaction.user.id, serverId, server);
    await interaction.update(msg as Parameters<typeof interaction.update>[0]);
    return;
  }

  // Adjust qty — show qty buttons: shop:s<id>:adj — value = "<srvId>:<productId>"
  const adjMatch = id.match(/^shop:s(\d+):adj$/);
  if (adjMatch && interaction.isStringSelectMenu()) {
    const [srvIdStr, productIdStr] = interaction.values[0]!.split(":");
    const serverId = Number(srvIdStr);
    const productId = Number(productIdStr);
    const basket = getBasket(interaction.user.id, serverId);
    const current = basket.get(productId) ?? 1;
    const product = await db.getShopProductById(productId);
    const currency = await getCurrency(serverId);

    const qtyRow = new ActionRowBuilder<ButtonBuilder>().addComponents(
      [1, 2, 3, 5, 10].map(q =>
        new ButtonBuilder()
          .setCustomId(`shop:s${serverId}:aq:${productId}:${q}`)
          .setLabel(`x${q}`)
          .setStyle(q === current ? ButtonStyle.Primary : ButtonStyle.Secondary)
      )
    );
    const backRow = new ActionRowBuilder<ButtonBuilder>().addComponents(
      new ButtonBuilder()
        .setCustomId(`shop:s${serverId}:back`)
        .setLabel("Back to Basket")
        .setStyle(ButtonStyle.Secondary)
    );

    const embed = new EmbedBuilder()
      .setTitle(`Adjust quantity — ${product?.name ?? "Item"}`)
      .setDescription(`Current: **x${current}**  |  Price per unit: **${product?.price ?? "?"} ${currency}**`)
      .setColor(0xe07a32);

    await interaction.update({ embeds: [embed], components: [qtyRow, backRow] });
    return;
  }

  // Qty set button: shop:s<id>:aq:<productId>:<qty>
  const aqMatch = id.match(/^shop:s(\d+):aq:(\d+):(\d+)$/);
  if (aqMatch && interaction.isButton()) {
    const serverId = Number(aqMatch[1]);
    const productId = Number(aqMatch[2]);
    const qty = Number(aqMatch[3]);
    const basket = getBasket(interaction.user.id, serverId);
    basket.set(productId, qty);
    const server = await db.getServerById(serverId);
    if (!server) { await interaction.update({ content: "Server not found.", embeds: [], components: [] }); return; }
    const msg = await buildShopMessage(interaction.user.id, serverId, server);
    await interaction.update(msg as Parameters<typeof interaction.update>[0]);
    return;
  }

  // Back to basket: shop:s<id>:back
  const backMatch = id.match(/^shop:s(\d+):back$/);
  if (backMatch && interaction.isButton()) {
    const serverId = Number(backMatch[1]);
    const server = await db.getServerById(serverId);
    if (!server) { await interaction.update({ content: "Server not found.", embeds: [], components: [] }); return; }
    const msg = await buildShopMessage(interaction.user.id, serverId, server);
    await interaction.update(msg as Parameters<typeof interaction.update>[0]);
    return;
  }

  // Cancel basket: shop:s<id>:cancel
  const cancelMatch = id.match(/^shop:s(\d+):cancel$/);
  if (cancelMatch && interaction.isButton()) {
    const serverId = Number(cancelMatch[1]);
    clearBasket(interaction.user.id, serverId);
    const server = await db.getServerById(serverId);
    if (!server) { await interaction.update({ content: "Basket cleared.", embeds: [], components: [] }); return; }
    const msg = await buildShopMessage(interaction.user.id, serverId, server);
    await interaction.update(msg as Parameters<typeof interaction.update>[0]);
    return;
  }

  // Complete purchase: shop:s<id>:buy
  const buyMatch = id.match(/^shop:s(\d+):buy$/);
  if (buyMatch && interaction.isButton()) {
    await completePurchase(interaction, Number(buyMatch[1]));
    return;
  }
}

// ---- Complete purchase ----

async function completePurchase(interaction: ButtonInteraction, serverId: number): Promise<void> {
  const basket = getBasket(interaction.user.id, serverId);
  if (basket.size === 0) {
    await interaction.update({ content: "Your basket is empty.", embeds: [], components: [] });
    return;
  }

  const ingameName = await getIngameName(serverId, interaction.user.id);
  if (!ingameName) {
    await interaction.update({ content: "You must link your account first. Use /link.", embeds: [], components: [] });
    return;
  }

  const server = await db.getServerById(serverId);
  if (!server?.rcon_host) {
    await interaction.update({ content: "Server RCON is not configured.", embeds: [], components: [] });
    return;
  }

  const closedUntil = shopClosed.get(serverId);
  if (closedUntil && Date.now() < closedUntil) {
    const mins = Math.ceil((closedUntil - Date.now()) / 60000);
    await interaction.update({ content: `The shop is closed for ~${mins} more minute(s).`, embeds: [], components: [] });
    return;
  }

  const currency = await getCurrency(serverId);
  const balance = await db.getBalance(serverId, ingameName);

  // Resolve all basket items and validate
  const items: Array<{ product: db.ShopProductRow; qty: number }> = [];
  let totalCost = 0;

  for (const [pid, qty] of basket.entries()) {
    const product = await db.getShopProductById(pid);
    if (!product) continue;
    const effectiveQty = isKit(product.shortname) ? 1 : qty;

    // Cooldown check
    if (product.timer_hours > 0) {
      const last = await db.getLastShopPurchase(serverId, ingameName, pid);
      if (last) {
        const remaining = new Date(last.purchased_at).getTime() + product.timer_hours * 3600_000 - Date.now();
        if (remaining > 0) {
          const h = Math.floor(remaining / 3600_000);
          const m = Math.ceil((remaining % 3600_000) / 60_000);
          await interaction.update({
            content: `**${product.name}** is on cooldown for ${h}h ${m}m. Remove it from your basket to continue.`,
            embeds: [],
            components: [],
          });
          return;
        }
      }
    }

    // Stock check
    if (product.stock !== -1 && product.stock < effectiveQty) {
      await interaction.update({
        content: `**${product.name}** only has ${product.stock} left${product.stock === 0 ? " (out of stock)" : " — reduce your quantity"}.`,
        embeds: [],
        components: [],
      });
      return;
    }

    items.push({ product, qty: effectiveQty });
    totalCost += product.price * effectiveQty;
  }

  // Balance check
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

  // Deliver all via RCON
  const delivered: string[] = [];
  const failed: string[] = [];

  for (const { product, qty } of items) {
    try {
      if (isKit(product.shortname)) {
        await rconManager.sendCommand(
          server.id, server.rcon_host, server.rcon_port!, server.rcon_password!,
          `giveto ${ingameName} ${kitName(product.shortname)}`
        );
      } else {
        for (let i = 0; i < qty; i++) {
          await rconManager.sendCommand(
            server.id, server.rcon_host, server.rcon_port!, server.rcon_password!,
            `inventory.give "${ingameName}" "${product.shortname}" 1`
          );
        }
      }
      delivered.push(`[${qty}x] ${product.name}`);
      if (product.stock !== -1) await db.decrementShopStock(product.id, qty);
      await db.recordShopPurchase(serverId, ingameName, product.id);
    } catch {
      failed.push(product.name);
      await db.updateBalance(serverId, ingameName, product.price * qty); // refund this item
    }
  }

  // Clear basket
  clearBasket(interaction.user.id, serverId);
  const newBalance = await db.getBalance(serverId, ingameName);

  // Log to cmd-logs
  if (interaction.guild) {
    const logsChannelId = await db.getChannel(server.id, "cmd-logs");
    if (logsChannelId) {
      const ch = interaction.guild.channels.cache.get(logsChannelId);
      if (ch && ch.isTextBased()) {
        const summary = items.map(i => `${i.qty}x ${i.product.name}`).join(", ");
        await ch.send(
          `[SHOP] ${interaction.user.tag} purchased ${summary} for ${totalCost} ${currency} | In-game: ${ingameName} | Server ${server.server_number}`
        ).catch(() => null);
      }
    }
  }

  // Build success embed
  const successLines = delivered.map(d => `• ${d}`);
  const failLines = failed.length > 0 ? `\n\n**Failed to deliver:** ${failed.join(", ")} (refunded)` : "";

  const embed = new EmbedBuilder()
    .setTitle("Purchase Summary")
    .setColor(0x3dba8c)
    .setDescription(
      `**Successful (Items Sent)**\n${successLines.join("\n")}${failLines}\n\n` +
      `Old Balance: ${balance}\nNew Balance: ${newBalance}\n` +
      `Use \`here, take this\` in-game to claim your purchases!`
    )
    .setFooter({ text: `Server ${server.server_number}: ${server.server_label}` });

  await interaction.update({ embeds: [embed], components: [] });
}

// ---- Admin commands ----

export async function handleAdminShopCreateShop(interaction: ChatInputCommandInteraction): Promise<void> {
  if (!await requireRole(interaction, "avivadmin")) return;
  await interaction.reply({ content: "Shop ready. Use /admin-shop-add-category to create categories.", flags: MessageFlags.Ephemeral });
}

export async function handleAdminShopDeleteShop(interaction: ChatInputCommandInteraction): Promise<void> {
  if (!await requireRole(interaction, "avivadmin")) return;
  const server = await getServerForInteraction(interaction);
  if (!server) return;
  await db.db.execute({ sql: "DELETE FROM shop_products WHERE category_id IN (SELECT id FROM shop_categories WHERE server_id = ?)", args: [server.id] });
  await db.db.execute({ sql: "DELETE FROM shop_categories WHERE server_id = ?", args: [server.id] });
  await interaction.reply({ content: "Shop deleted.", flags: MessageFlags.Ephemeral });
}

export async function handleAdminShopAddCategory(interaction: ChatInputCommandInteraction): Promise<void> {
  if (!await requireRole(interaction, "avivadmin")) return;
  const server = await getServerForInteraction(interaction);
  if (!server) return;
  const name = interaction.options.getString("name", true);
  const type = interaction.options.getString("type") ?? "item";
  const id = await db.addShopCategory(server.id, name, null, type);
  await interaction.reply({ content: `Category **${name}** created (ID: ${id}). Players will see it in /shop.`, flags: MessageFlags.Ephemeral });
}

export async function handleAdminShopAddSubcategory(interaction: ChatInputCommandInteraction): Promise<void> {
  if (!await requireRole(interaction, "avivadmin")) return;
  const server = await getServerForInteraction(interaction);
  if (!server) return;
  const name = interaction.options.getString("name", true);
  const parentName = interaction.options.getString("parent", true);
  const categories = await db.getShopCategories(server.id);
  const parent = categories.find(c => c.name.toLowerCase() === parentName.toLowerCase());
  if (!parent) { await interaction.reply({ content: `Category "${parentName}" not found.`, flags: MessageFlags.Ephemeral }); return; }
  const id = await db.addShopCategory(server.id, name, parent.id, "item");
  await interaction.reply({ content: `Subcategory **${name}** under **${parent.name}** created (ID: ${id}).`, flags: MessageFlags.Ephemeral });
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
  const stock = interaction.options.getInteger("stock") ?? -1;

  const categories = await db.getShopCategories(server.id);
  const cat = categories.find(c => c.name.toLowerCase() === categoryName.toLowerCase());
  if (!cat) { await interaction.reply({ content: `Category "${categoryName}" not found. Create it first with /admin-shop-add-category.`, flags: MessageFlags.Ephemeral }); return; }

  const id = await db.addShopProduct(cat.id, name, shortname, price, timerHours);
  if (stock !== -1) {
    await db.db.execute({ sql: "UPDATE shop_products SET stock = ? WHERE id = ?", args: [stock, id] });
  }
  await interaction.reply({ content: `Item **${name}** (\`${shortname}\`) added to **${cat.name}** for ${price} ${(await getCurrency(server.id))} (ID: ${id}).`, flags: MessageFlags.Ephemeral });
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
  if (!cat) { await interaction.reply({ content: `Category "${categoryName}" not found.`, flags: MessageFlags.Ephemeral }); return; }

  const id = await db.addShopProduct(cat.id, kName, `kit:${kName}`, price, timerHours);
  await interaction.reply({ content: `Kit **${kName}** added to **${cat.name}** for ${price} ${(await getCurrency(server.id))} (ID: ${id}).`, flags: MessageFlags.Ephemeral });
}

export async function handleAdminShopEditProduct(interaction: ChatInputCommandInteraction): Promise<void> {
  if (!await requireRole(interaction, "avivadmin")) return;
  const productId = interaction.options.getInteger("product_id", true);
  const price = interaction.options.getInteger("price");
  const stock = interaction.options.getInteger("stock");
  if (price !== null) await db.db.execute({ sql: "UPDATE shop_products SET price = ? WHERE id = ?", args: [price, productId] });
  if (stock !== null) await db.db.execute({ sql: "UPDATE shop_products SET stock = ? WHERE id = ?", args: [stock, productId] });
  await interaction.reply({ content: `Product ${productId} updated.`, flags: MessageFlags.Ephemeral });
}

export async function handleAdminShopRemoveProduct(interaction: ChatInputCommandInteraction): Promise<void> {
  if (!await requireRole(interaction, "avivadmin")) return;
  const productId = interaction.options.getInteger("product_id", true);
  await db.removeShopProduct(productId);
  await interaction.reply({ content: `Product ${productId} removed.`, flags: MessageFlags.Ephemeral });
}

export async function handleDelayshop(interaction: ChatInputCommandInteraction): Promise<void> {
  if (!await requireRole(interaction, "avivadmin")) return;
  const server = await getServerForInteraction(interaction);
  if (!server) return;
  const minutes = interaction.options.getInteger("minutes", true);
  shopClosed.set(server.id, Date.now() + minutes * 60000);
  await interaction.reply({ content: `Shop closed for ${minutes} minute(s).`, flags: MessageFlags.Ephemeral });
}

export async function handleOpenshop(interaction: ChatInputCommandInteraction): Promise<void> {
  if (!await requireRole(interaction, "avivadmin")) return;
  const server = await getServerForInteraction(interaction);
  if (!server) return;
  shopClosed.delete(server.id);
  await interaction.reply({ content: "Shop reopened.", flags: MessageFlags.Ephemeral });
}
