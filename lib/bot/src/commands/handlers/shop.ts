import type {
  ChatInputCommandInteraction,
  StringSelectMenuInteraction,
  ButtonInteraction,
  ModalSubmitInteraction,
  AutocompleteInteraction,
} from "discord.js";
import {
  EmbedBuilder,
  ActionRowBuilder,
  StringSelectMenuBuilder,
  StringSelectMenuOptionBuilder,
  ButtonBuilder,
  ButtonStyle,
  MessageFlags,
  ModalBuilder,
  TextInputBuilder,
  TextInputStyle,
} from "discord.js";
import * as db from "@workspace/db";
import { requireRole } from "./utils.js";
import { rconManager } from "../../rcon/manager.js";

// ---- Basket: keyed by userId:guildId (shop is global per guild) ----
const baskets = new Map<string, Map<number, number>>();
function basketKey(userId: string, guildId: string) { return `${userId}:${guildId}`; }
function getBasket(userId: string, guildId: string): Map<number, number> {
  const key = basketKey(userId, guildId);
  if (!baskets.has(key)) baskets.set(key, new Map());
  return baskets.get(key)!;
}
function clearBasket(userId: string, guildId: string) { baskets.delete(basketKey(userId, guildId)); }

// ---- Shop closed: keyed by guildId ----
const shopClosed = new Map<string, number>();

// ---- Helpers ----
function isKit(shortname: string) { return shortname.startsWith("kit:"); }
function kitName(shortname: string) { return shortname.slice(4); }

async function getGuildCurrency(guildId: string): Promise<string> {
  const servers = await db.getServersByGuild(guildId);
  if (!servers.length) return "coins";
  return (await db.getConfig(servers[0]!.id, "currency_name")) ?? "coins";
}

async function getPlayerForShop(
  guildId: string,
  userId: string
): Promise<{ server: db.ServerRow; ingameName: string } | null> {
  const servers = await db.getServersByGuild(guildId);
  for (const server of servers) {
    const p = await db.getPlayerByDiscord(server.id, userId);
    if (p) return { server, ingameName: p.ingame_name };
  }
  return null;
}

// ---- Build the shop UI ----

async function buildShopMessage(
  userId: string,
  guildId: string,
  selectedCatId?: number
) {
  const currency = await getGuildCurrency(guildId);
  const playerInfo = await getPlayerForShop(guildId, userId);
  const balance = playerInfo
    ? await db.getBalance(playerInfo.server.id, playerInfo.ingameName)
    : 0;

  const basket = getBasket(userId, guildId);
  const basketProducts: Array<{ product: db.ShopProductRow; qty: number }> = [];
  let basketCost = 0;
  for (const [pid, qty] of basket.entries()) {
    const product = await db.getShopProductById(pid);
    if (product) {
      basketProducts.push({ product, qty });
      basketCost += product.price * qty;
    }
  }

  let embedDesc = `**Your balance:** ${balance} ${currency}\n\n`;
  if (basketProducts.length > 0) {
    const lines = basketProducts.map(b => `• ${b.qty}x ${b.product.name}`);
    embedDesc += lines.join("\n");
    embedDesc += `\n\n——————————————\nSTART BALANCE: ${balance}\nBASKET COST: ${basketCost}\nAFTER BALANCE: ${balance - basketCost}`;
  } else {
    embedDesc += "Select a category to browse items and add them to your basket.";
  }

  const embed = new EmbedBuilder()
    .setTitle(basketProducts.length > 0 ? "Your Basket" : "Shop")
    .setDescription(embedDesc)
    .setColor(basketProducts.length > 0 ? 0xe07a32 : 0x2b2d31);

  const rows: ActionRowBuilder<StringSelectMenuBuilder | ButtonBuilder>[] = [];

  // Row 1: Category select (all categories across the guild)
  const categories = await db.getShopCategoriesByGuild(guildId);
  const topLevel = categories.filter(c => !c.parent_id).slice(0, 25);
  if (topLevel.length > 0) {
    const catSelect = new StringSelectMenuBuilder()
      .setCustomId(`shop:g${guildId}:cats`)
      .setPlaceholder(basketProducts.length > 0 ? "Add more items..." : "Select a category")
      .addOptions(
        topLevel.map(c =>
          new StringSelectMenuOptionBuilder()
            .setLabel(c.name)
            .setValue(`${c.id}`)
            .setDescription(c.category_type === "kit" ? "Kits" : "Items")
            .setDefault(c.id === selectedCatId)
        )
      );
    rows.push(new ActionRowBuilder<StringSelectMenuBuilder>().addComponents(catSelect));
  }

  if (basketProducts.length > 0) {
    // Remove item select
    const removeSelect = new StringSelectMenuBuilder()
      .setCustomId(`shop:g${guildId}:rm`)
      .setPlaceholder("Remove an item from basket")
      .addOptions(
        basketProducts.map(b =>
          new StringSelectMenuOptionBuilder()
            .setLabel(`${b.product.name} (x${b.qty})`)
            .setValue(`${b.product.id}`)
        )
      );
    rows.push(new ActionRowBuilder<StringSelectMenuBuilder>().addComponents(removeSelect));

    // Adjust qty select (shows a modal on select)
    const adjSelect = new StringSelectMenuBuilder()
      .setCustomId(`shop:g${guildId}:adj`)
      .setPlaceholder("Change quantity for an item")
      .addOptions(
        basketProducts.map(b =>
          new StringSelectMenuOptionBuilder()
            .setLabel(`${b.product.name} (currently x${b.qty})`)
            .setValue(`${b.product.id}`)
        )
      );
    rows.push(new ActionRowBuilder<StringSelectMenuBuilder>().addComponents(adjSelect));

    // Cancel + Complete
    rows.push(
      new ActionRowBuilder<ButtonBuilder>().addComponents(
        new ButtonBuilder()
          .setCustomId(`shop:g${guildId}:cancel`)
          .setLabel("Cancel Purchase")
          .setStyle(ButtonStyle.Danger),
        new ButtonBuilder()
          .setCustomId(`shop:g${guildId}:buy`)
          .setLabel(`Complete Purchase — ${basketCost} ${currency}`)
          .setStyle(ButtonStyle.Success)
      )
    );
  }

  return { embeds: [embed], components: rows };
}

// ---- Build item select for a category ----

async function buildItemSelect(guildId: string, catId: number, currency: string) {
  const products = await db.getShopProducts(catId);
  if (products.length === 0) return null;
  return new StringSelectMenuBuilder()
    .setCustomId(`shop:g${guildId}:itms`)
    .setPlaceholder("Select an item to add to basket")
    .addOptions(
      products.slice(0, 25).map(p => {
        const stock = p.stock === -1 ? "unlimited" : `${p.stock} left`;
        const kitLabel = isKit(p.shortname) ? " [KIT]" : "";
        return new StringSelectMenuOptionBuilder()
          .setLabel(`${p.name}${kitLabel}`)
          .setValue(`${p.id}`)
          .setDescription(
            `${p.price} ${currency}  |  ${stock}${p.timer_hours > 0 ? `  |  ${p.timer_hours}h cooldown` : ""}`
          );
      })
    );
}

// ---- /shop entry point ----

export async function handleShop(interaction: ChatInputCommandInteraction): Promise<void> {
  if (!interaction.guild) {
    await interaction.reply({ content: "Must be used in a server.", flags: MessageFlags.Ephemeral });
    return;
  }

  await interaction.deferReply({ flags: MessageFlags.Ephemeral });

  const guildId = interaction.guild.id;

  const closedUntil = shopClosed.get(guildId);
  if (closedUntil && Date.now() < closedUntil) {
    const mins = Math.ceil((closedUntil - Date.now()) / 60000);
    await interaction.editReply({ content: `The shop is closed for ~${mins} more minute(s).` });
    return;
  }

  const playerInfo = await getPlayerForShop(guildId, interaction.user.id);
  if (!playerInfo) {
    await interaction.editReply({ content: "You must link your in-game name first. Use /link." });
    return;
  }

  const msg = await buildShopMessage(interaction.user.id, guildId);
  await interaction.editReply(msg as Parameters<typeof interaction.editReply>[0]);
}

// ---- Interaction router ----

export async function handleShopInteraction(
  interaction: StringSelectMenuInteraction | ButtonInteraction
): Promise<void> {
  const id = interaction.customId;

  // Category select: shop:g<guildId>:cats — value = "<catId>"
  const catsMatch = id.match(/^shop:g(\d+):cats$/);
  if (catsMatch && interaction.isStringSelectMenu()) {
    const guildId = catsMatch[1]!;
    const catId = Number(interaction.values[0]);
    const currency = await getGuildCurrency(guildId);

    const categories = await db.getShopCategoriesByGuild(guildId);
    const cat = categories.find(c => c.id === catId);
    const itemSelect = await buildItemSelect(guildId, catId, currency);

    if (!itemSelect) {
      const subs = categories.filter(c => c.parent_id === catId).slice(0, 25);
      if (subs.length > 0) {
        const subSelect = new StringSelectMenuBuilder()
          .setCustomId(`shop:g${guildId}:cats`)
          .setPlaceholder("Select a subcategory")
          .addOptions(
            subs.map(c =>
              new StringSelectMenuOptionBuilder().setLabel(c.name).setValue(`${c.id}`)
            )
          );
        await interaction.update({
          embeds: [
            new EmbedBuilder()
              .setTitle(cat?.name ?? "Category")
              .setColor(0x2b2d31)
              .setDescription("Choose a subcategory:"),
          ],
          components: [new ActionRowBuilder<StringSelectMenuBuilder>().addComponents(subSelect)],
        });
      } else {
        await interaction.update({ content: "No items in this category.", embeds: [], components: [] });
      }
      return;
    }

    const shopMsg = await buildShopMessage(interaction.user.id, guildId, catId);
    const itemRow = new ActionRowBuilder<StringSelectMenuBuilder>().addComponents(itemSelect);
    const existingRows = shopMsg.components as ActionRowBuilder<StringSelectMenuBuilder | ButtonBuilder>[];
    const basketRows = existingRows.slice(1);
    const rows = [existingRows[0]!, itemRow, ...basketRows];
    await interaction.update({
      ...shopMsg,
      components: rows.slice(0, 5),
    } as Parameters<typeof interaction.update>[0]);
    return;
  }

  // Item select (add to basket via modal): shop:g<guildId>:itms — value = "<productId>"
  const itmsMatch = id.match(/^shop:g(\d+):itms$/);
  if (itmsMatch && interaction.isStringSelectMenu()) {
    const guildId = itmsMatch[1]!;
    const productId = Number(interaction.values[0]);
    const product = await db.getShopProductById(productId);

    await interaction.showModal(
      new ModalBuilder()
        .setCustomId(`shop:g${guildId}:qty:${productId}`)
        .setTitle(product ? `Add — ${product.name}` : "Add to basket")
        .addComponents(
          new ActionRowBuilder<TextInputBuilder>().addComponents(
            new TextInputBuilder()
              .setCustomId("qty")
              .setLabel("How many?")
              .setStyle(TextInputStyle.Short)
              .setRequired(true)
              .setPlaceholder("Enter a number, e.g. 5")
              .setMinLength(1)
              .setMaxLength(3)
          )
        )
    );
    return;
  }

  // Remove item: shop:g<guildId>:rm — value = "<productId>"
  const rmMatch = id.match(/^shop:g(\d+):rm$/);
  if (rmMatch && interaction.isStringSelectMenu()) {
    const guildId = rmMatch[1]!;
    const productId = Number(interaction.values[0]);
    const basket = getBasket(interaction.user.id, guildId);
    basket.delete(productId);
    const msg = await buildShopMessage(interaction.user.id, guildId);
    await interaction.update(msg as Parameters<typeof interaction.update>[0]);
    return;
  }

  // Adjust qty — show modal: shop:g<guildId>:adj — value = "<productId>"
  const adjMatch = id.match(/^shop:g(\d+):adj$/);
  if (adjMatch && interaction.isStringSelectMenu()) {
    const guildId = adjMatch[1]!;
    const productId = Number(interaction.values[0]);
    const basket = getBasket(interaction.user.id, guildId);
    const current = basket.get(productId) ?? 1;
    const product = await db.getShopProductById(productId);

    await interaction.showModal(
      new ModalBuilder()
        .setCustomId(`shop:g${guildId}:adjmod:${productId}`)
        .setTitle(product ? `Change qty — ${product.name}` : "Change quantity")
        .addComponents(
          new ActionRowBuilder<TextInputBuilder>().addComponents(
            new TextInputBuilder()
              .setCustomId("qty")
              .setLabel("New quantity")
              .setStyle(TextInputStyle.Short)
              .setRequired(true)
              .setPlaceholder(`Currently: ${current}`)
              .setValue(String(current))
              .setMinLength(1)
              .setMaxLength(3)
          )
        )
    );
    return;
  }

  // Cancel basket: shop:g<guildId>:cancel
  const cancelMatch = id.match(/^shop:g(\d+):cancel$/);
  if (cancelMatch && interaction.isButton()) {
    const guildId = cancelMatch[1]!;
    clearBasket(interaction.user.id, guildId);
    const msg = await buildShopMessage(interaction.user.id, guildId);
    await interaction.update(msg as Parameters<typeof interaction.update>[0]);
    return;
  }

  // Complete purchase: shop:g<guildId>:buy
  const buyMatch = id.match(/^shop:g(\d+):buy$/);
  if (buyMatch && interaction.isButton()) {
    await completePurchase(interaction, buyMatch[1]!);
    return;
  }
}

// ---- Modal submit handler ----

export async function handleShopModalSubmit(interaction: ModalSubmitInteraction): Promise<void> {
  const id = interaction.customId;

  // Add item to basket: shop:g<guildId>:qty:<productId>
  const qtyMatch = id.match(/^shop:g(\d+):qty:(\d+)$/);
  if (qtyMatch) {
    const guildId = qtyMatch[1]!;
    const productId = Number(qtyMatch[2]);
    const raw = interaction.fields.getTextInputValue("qty");
    const qty = Math.max(1, Math.min(99, parseInt(raw, 10) || 1));

    const basket = getBasket(interaction.user.id, guildId);
    const current = basket.get(productId) ?? 0;
    basket.set(productId, current + qty);

    await interaction.deferUpdate();
    const msg = await buildShopMessage(interaction.user.id, guildId);
    await interaction.editReply(msg as Parameters<typeof interaction.editReply>[0]);
    return;
  }

  // Adjust existing basket item: shop:g<guildId>:adjmod:<productId>
  const adjMatch = id.match(/^shop:g(\d+):adjmod:(\d+)$/);
  if (adjMatch) {
    const guildId = adjMatch[1]!;
    const productId = Number(adjMatch[2]);
    const raw = interaction.fields.getTextInputValue("qty");
    const qty = Math.max(1, Math.min(99, parseInt(raw, 10) || 1));

    const basket = getBasket(interaction.user.id, guildId);
    basket.set(productId, qty);

    await interaction.deferUpdate();
    const msg = await buildShopMessage(interaction.user.id, guildId);
    await interaction.editReply(msg as Parameters<typeof interaction.editReply>[0]);
    return;
  }
}

// ---- Complete purchase ----

async function completePurchase(interaction: ButtonInteraction, guildId: string): Promise<void> {
  const basket = getBasket(interaction.user.id, guildId);
  if (basket.size === 0) {
    await interaction.update({ content: "Your basket is empty.", embeds: [], components: [] });
    return;
  }

  const closedUntil = shopClosed.get(guildId);
  if (closedUntil && Date.now() < closedUntil) {
    const mins = Math.ceil((closedUntil - Date.now()) / 60000);
    await interaction.update({ content: `The shop is closed for ~${mins} more minute(s).`, embeds: [], components: [] });
    return;
  }

  // Find player's linked server for delivery
  const playerInfo = await getPlayerForShop(guildId, interaction.user.id);
  if (!playerInfo) {
    await interaction.update({ content: "You must link your account first. Use /link.", embeds: [], components: [] });
    return;
  }
  const { server, ingameName } = playerInfo;

  const currency = await getGuildCurrency(guildId);
  const balance = await db.getBalance(server.id, ingameName);

  // Resolve and validate all basket items
  const items: Array<{ product: db.ShopProductRow; qty: number }> = [];
  let totalCost = 0;

  for (const [pid, qty] of basket.entries()) {
    const product = await db.getShopProductById(pid);
    if (!product) continue;
    const effectiveQty = isKit(product.shortname) ? 1 : qty;

    if (product.timer_hours > 0) {
      const last = await db.getLastShopPurchase(server.id, ingameName, pid);
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

  if (balance < totalCost) {
    await interaction.update({
      content: `You need **${totalCost} ${currency}** but only have **${balance} ${currency}**.`,
      embeds: [],
      components: [],
    });
    return;
  }

  await db.updateBalance(server.id, ingameName, -totalCost);

  const delivered: string[] = [];
  const failed: string[] = [];

  for (const { product, qty } of items) {
    try {
      if (isKit(product.shortname)) {
        await rconManager.sendFireAndForget(
          server.id, server.rcon_host!, server.rcon_port!, server.rcon_password!,
          `giveto ${ingameName} ${kitName(product.shortname)}`
        );
      } else {
        for (let i = 0; i < qty; i++) {
          await rconManager.sendFireAndForget(
            server.id, server.rcon_host!, server.rcon_port!, server.rcon_password!,
            `inventory.give "${ingameName}" "${product.shortname}" 1`
          );
        }
      }
      delivered.push(`[${qty}x] ${product.name}`);
      if (product.stock !== -1) await db.decrementShopStock(product.id, qty);
      await db.recordShopPurchase(server.id, ingameName, product.id);
    } catch {
      failed.push(product.name);
      await db.updateBalance(server.id, ingameName, product.price * qty);
    }
  }

  clearBasket(interaction.user.id, guildId);
  const newBalance = await db.getBalance(server.id, ingameName);

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

  const failLines = failed.length > 0 ? `\n\n**Failed to deliver:** ${failed.join(", ")} (refunded)` : "";

  const embed = new EmbedBuilder()
    .setTitle("Purchase Summary")
    .setColor(0x3dba8c)
    .setDescription(
      `**Successful (Items Sent)**\n${delivered.map(d => `• ${d}`).join("\n")}${failLines}\n\n` +
      `Old Balance: ${balance}\nNew Balance: ${newBalance}\n` +
      `Use \`here, take this\` in-game to claim your purchases!`
    )
    .setFooter({ text: `Server ${server.server_number}: ${server.server_label}` });

  await interaction.update({ embeds: [embed], components: [] });
}

// ---- Admin autocomplete helpers ----

const COMMON_RUST_ITEMS = [
  "rifle.ak", "rifle.lr300", "rifle.bolt", "rifle.semiauto", "lmg.m249",
  "smg.mp5", "smg.thompson", "smg.2", "pistol.revolver", "pistol.semiauto",
  "pistol.m92", "pistol.python", "shotgun.pump", "shotgun.spas12", "shotgun.waterpipe",
  "crossbow", "bow.hunting", "grenade.f1", "explosive.timed", "supply.signal",
  "metal.facemask", "metal.plate.torso", "roadsign.jacket", "roadsign.kilt",
  "bucket.helmet", "wood.armor.helmet", "wood.armor.jacket", "wood.armor.pants",
  "shoes.boots", "hoodie", "pants", "tshirt", "jacket", "mask.balaclava",
  "bandage", "syringe.medical", "largemedkit",
  "can.tuna", "can.beans", "corn", "pumpkin", "mushroom", "blueberries",
  "wood", "stone", "metal.fragments", "metal.ore", "hq.metal.ore", "sulfur",
  "gunpowder", "techparts", "scrap", "rope", "tarp", "cloth", "leather",
  "hatchet", "pickaxe", "chainsaw", "jackhammer",
  "box.wooden.large", "cupboard.tool", "lock.code",
  "door.hinged.wood", "door.hinged.metal", "door.hinged.toptier",
  "barricade.sandbag", "barricade.metal",
  "gates.external.high.wood", "gates.external.high.stone",
  "explosive", "sulfur.ore", "fat.animal", "bone.fragments",
];

export async function autocompleteShopAdmin(interaction: AutocompleteInteraction): Promise<void> {
  if (!interaction.guild) { await interaction.respond([]); return; }
  const focused = interaction.options.getFocused(true);

  if (focused.name === "category" || focused.name === "parent") {
    const categories = await db.getShopCategoriesByGuild(interaction.guild.id).catch(() => []);
    const query = focused.value.toLowerCase();
    const matches = categories
      .filter(c => c.name.toLowerCase().includes(query))
      .slice(0, 25)
      .map(c => ({ name: c.name, value: c.name }));
    await interaction.respond(matches);
    return;
  }

  if (focused.name === "shortname") {
    const query = focused.value.toLowerCase();
    const matches = COMMON_RUST_ITEMS
      .filter(s => s.includes(query))
      .slice(0, 25)
      .map(s => ({ name: s, value: s }));
    await interaction.respond(matches);
    return;
  }

  await interaction.respond([]);
}

// ---- Admin commands ----

async function getGuildPrimaryServer(guildId: string) {
  const servers = await db.getServersByGuild(guildId);
  return servers[0] ?? null;
}

export async function handleAdminShopCreateShop(interaction: ChatInputCommandInteraction): Promise<void> {
  if (!await requireRole(interaction, "avivadmin")) return;
  await interaction.reply({ content: "Shop ready. Use /admin-shop-add-category to create categories.", flags: MessageFlags.Ephemeral });
}

export async function handleAdminShopDeleteShop(interaction: ChatInputCommandInteraction): Promise<void> {
  if (!await requireRole(interaction, "avivadmin")) return;
  if (!interaction.guild) return;
  const servers = await db.getServersByGuild(interaction.guild.id);
  for (const s of servers) {
    await db.db.execute({
      sql: "DELETE FROM shop_products WHERE category_id IN (SELECT id FROM shop_categories WHERE server_id = ?)",
      args: [s.id],
    });
    await db.db.execute({ sql: "DELETE FROM shop_categories WHERE server_id = ?", args: [s.id] });
  }
  await interaction.reply({ content: "Shop deleted.", flags: MessageFlags.Ephemeral });
}

export async function handleAdminShopAddCategory(interaction: ChatInputCommandInteraction): Promise<void> {
  if (!await requireRole(interaction, "avivadmin")) return;
  if (!interaction.guild) return;
  const primary = await getGuildPrimaryServer(interaction.guild.id);
  if (!primary) {
    await interaction.reply({ content: "No servers configured yet. Add one with /add-server first.", flags: MessageFlags.Ephemeral });
    return;
  }
  const name = interaction.options.getString("name", true);
  const type = interaction.options.getString("type") ?? "item";
  await db.addShopCategory(primary.id, name, null, type);
  await interaction.reply({ content: `Category **${name}** created. Players will see it in /shop.`, flags: MessageFlags.Ephemeral });
}

export async function handleAdminShopAddSubcategory(interaction: ChatInputCommandInteraction): Promise<void> {
  if (!await requireRole(interaction, "avivadmin")) return;
  if (!interaction.guild) return;
  const primary = await getGuildPrimaryServer(interaction.guild.id);
  if (!primary) {
    await interaction.reply({ content: "No servers configured yet.", flags: MessageFlags.Ephemeral });
    return;
  }
  const name = interaction.options.getString("name", true);
  const parentName = interaction.options.getString("parent", true);
  const categories = await db.getShopCategoriesByGuild(interaction.guild.id);
  const parent = categories.find(c => c.name.toLowerCase() === parentName.toLowerCase());
  if (!parent) {
    await interaction.reply({ content: `Category "${parentName}" not found.`, flags: MessageFlags.Ephemeral });
    return;
  }
  await db.addShopCategory(primary.id, name, parent.id, "item");
  await interaction.reply({ content: `Subcategory **${name}** under **${parent.name}** created.`, flags: MessageFlags.Ephemeral });
}

export async function handleAdminShopAddItem(interaction: ChatInputCommandInteraction): Promise<void> {
  if (!await requireRole(interaction, "avivadmin")) return;
  if (!interaction.guild) return;
  const name = interaction.options.getString("name", true);
  const shortname = interaction.options.getString("shortname", true);
  const price = interaction.options.getInteger("price", true);
  const categoryName = interaction.options.getString("category", true);
  const timerHours = interaction.options.getInteger("timer_hours") ?? 0;
  const stock = interaction.options.getInteger("stock") ?? -1;

  const categories = await db.getShopCategoriesByGuild(interaction.guild.id);
  const cat = categories.find(c => c.name.toLowerCase() === categoryName.toLowerCase());
  if (!cat) {
    await interaction.reply({
      content: `Category "${categoryName}" not found. Create it first with /admin-shop-add-category.`,
      flags: MessageFlags.Ephemeral,
    });
    return;
  }

  const id = await db.addShopProduct(cat.id, name, shortname, price, timerHours);
  if (stock !== -1) {
    await db.db.execute({ sql: "UPDATE shop_products SET stock = ? WHERE id = ?", args: [stock, id] });
  }
  const currency = await getGuildCurrency(interaction.guild.id);
  await interaction.reply({
    content: `Item **${name}** (\`${shortname}\`) added to **${cat.name}** for ${price} ${currency}.`,
    flags: MessageFlags.Ephemeral,
  });
}

export async function handleAdminShopAddKit(interaction: ChatInputCommandInteraction): Promise<void> {
  if (!await requireRole(interaction, "avivadmin")) return;
  if (!interaction.guild) return;
  const kName = interaction.options.getString("kit_name", true);
  const price = interaction.options.getInteger("price", true);
  const categoryName = interaction.options.getString("category", true);
  const timerHours = interaction.options.getInteger("timer_hours") ?? 0;

  const categories = await db.getShopCategoriesByGuild(interaction.guild.id);
  const cat = categories.find(c => c.name.toLowerCase() === categoryName.toLowerCase());
  if (!cat) {
    await interaction.reply({ content: `Category "${categoryName}" not found.`, flags: MessageFlags.Ephemeral });
    return;
  }

  const id = await db.addShopProduct(cat.id, kName, `kit:${kName}`, price, timerHours);
  const currency = await getGuildCurrency(interaction.guild.id);
  await interaction.reply({
    content: `Kit **${kName}** added to **${cat.name}** for ${price} ${currency}.`,
    flags: MessageFlags.Ephemeral,
  });
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
  if (!interaction.guild) return;
  const minutes = interaction.options.getInteger("minutes", true);
  shopClosed.set(interaction.guild.id, Date.now() + minutes * 60000);
  await interaction.reply({ content: `Shop closed for ${minutes} minute(s).`, flags: MessageFlags.Ephemeral });
}

export async function handleOpenshop(interaction: ChatInputCommandInteraction): Promise<void> {
  if (!await requireRole(interaction, "avivadmin")) return;
  if (!interaction.guild) return;
  shopClosed.delete(interaction.guild.id);
  await interaction.reply({ content: "Shop reopened.", flags: MessageFlags.Ephemeral });
}
