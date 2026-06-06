import type { ChatInputCommandInteraction } from "discord.js";
import { EmbedBuilder, MessageFlags } from "discord.js";
import * as db from "@workspace/db";
import { getServerForInteraction, requireRole } from "./utils.js";

async function applyLinkedState(
  guild: import("discord.js").Guild,
  userId: string,
  ingameName: string
): Promise<void> {
  try {
    const member = await guild.members.fetch(userId);
    const linkedRole = guild.roles.cache.find(r => r.name === "avivlinked");
    if (linkedRole) await member.roles.add(linkedRole).catch(() => null);
    await member.setNickname(ingameName).catch(() => null);
  } catch { /* member may have left or bot lacks permissions */ }
}

async function removeLinkedState(
  guild: import("discord.js").Guild,
  userId: string
): Promise<void> {
  try {
    const member = await guild.members.fetch(userId);
    const linkedRole = guild.roles.cache.find(r => r.name === "avivlinked");
    if (linkedRole) await member.roles.remove(linkedRole).catch(() => null);
    await member.setNickname(null).catch(() => null);
  } catch { /* member may have left or bot lacks permissions */ }
}

export async function handleLink(interaction: ChatInputCommandInteraction): Promise<void> {
  if (!interaction.guild) return;
  await interaction.deferReply({ flags: MessageFlags.Ephemeral });

  const ingameName = interaction.options.getString("ingame_name", true).trim();
  const servers = await db.getServersByGuild(interaction.guild.id);

  if (servers.length === 0) {
    await interaction.editReply({ content: "No servers configured. Use /add-server first." });
    return;
  }

  // Check if already linked on any server
  for (const server of servers) {
    const existing = await db.getPlayerByDiscord(server.id, interaction.user.id);
    if (existing) {
      await interaction.editReply({
        content: `You are already linked as **${existing.ingame_name}** on Server ${server.server_number}. Use /unlink first.`,
      });
      return;
    }
  }

  // Check if ingame name is taken on any server
  for (const server of servers) {
    const existingName = await db.getPlayerByIngameName(server.id, ingameName);
    if (existingName) {
      await interaction.editReply({ content: `**${ingameName}** is already linked to another Discord account.` });
      return;
    }
  }

  // Link to all servers at once
  for (const server of servers) {
    await db.linkPlayer(server.id, interaction.user.id, ingameName);
    await db.ensureEconomy(server.id, ingameName);
  }

  await applyLinkedState(interaction.guild, interaction.user.id, ingameName);

  const serverList = servers.map(s => `Server ${s.server_number}: ${s.server_label}`).join("\n");
  await interaction.editReply({
    content: `Linked! Your Discord is now connected to **${ingameName}** across all servers:\n${serverList}\n\nYour nickname and "avivlinked" role have been updated.`,
  });
}

export async function handleUnlink(interaction: ChatInputCommandInteraction): Promise<void> {
  if (!interaction.guild) return;
  await interaction.deferReply({ flags: MessageFlags.Ephemeral });

  const servers = await db.getServersByGuild(interaction.guild.id);
  let unlinkedAny = false;
  let ingameName = "";

  for (const server of servers) {
    const player = await db.getPlayerByDiscord(server.id, interaction.user.id);
    if (player) {
      ingameName = player.ingame_name;
      await db.unlinkPlayer(server.id, interaction.user.id);
      unlinkedAny = true;
    }
  }

  if (!unlinkedAny) {
    await interaction.editReply({ content: "You are not linked on any server." });
    return;
  }

  await removeLinkedState(interaction.guild, interaction.user.id);
  await interaction.editReply({ content: `Unlinked **${ingameName}** from your Discord across all servers.` });
}

export async function handleAdminLink(interaction: ChatInputCommandInteraction): Promise<void> {
  if (!await requireRole(interaction, "avivadmin")) return;
  if (!interaction.guild) return;
  await interaction.deferReply({ flags: MessageFlags.Ephemeral });

  const ingameName = interaction.options.getString("ingame_name", true).trim();
  const targetUser = interaction.options.getUser("discord_user", true);

  const servers = await db.getServersByGuild(interaction.guild.id);
  if (servers.length === 0) {
    await interaction.editReply({ content: "No servers configured." });
    return;
  }

  for (const server of servers) {
    await db.linkPlayer(server.id, targetUser.id, ingameName);
    await db.ensureEconomy(server.id, ingameName);
  }

  await applyLinkedState(interaction.guild, targetUser.id, ingameName);

  const serverList = servers.map(s => `Server ${s.server_number}: ${s.server_label}`).join("\n");
  await interaction.editReply({
    content: `Linked <@${targetUser.id}> to **${ingameName}** across all servers:\n${serverList}\n\nNickname and role updated.`,
  });
}

export async function handleWhois(interaction: ChatInputCommandInteraction): Promise<void> {
  if (!interaction.guild) return;
  await interaction.deferReply({ flags: MessageFlags.Ephemeral });

  const targetUser = interaction.options.getUser("discord_user");
  const ingameName = interaction.options.getString("ingame_name");

  if (!targetUser && !ingameName) {
    await interaction.editReply({ content: "Provide either a Discord user or an in-game name." });
    return;
  }

  const servers = await db.getServersByGuild(interaction.guild.id);
  if (servers.length === 0) {
    await interaction.editReply({ content: "No servers configured." });
    return;
  }

  const lines: string[] = [];
  for (const server of servers) {
    if (targetUser) {
      const player = await db.getPlayerByDiscord(server.id, targetUser.id);
      if (player) lines.push(`Server ${server.server_number} (${server.server_label}): **${player.ingame_name}**`);
    } else if (ingameName) {
      const player = await db.getPlayerByIngameName(server.id, ingameName);
      if (player) lines.push(`Server ${server.server_number} (${server.server_label}): <@${player.discord_user_id}>`);
    }
  }

  if (lines.length === 0) {
    await interaction.editReply({ content: "No link found." });
    return;
  }

  const embed = new EmbedBuilder().setTitle("Player Lookup").setDescription(lines.join("\n")).setColor(0x5865f2);
  await interaction.editReply({ embeds: [embed] });
}

export async function handleSyncMe(interaction: ChatInputCommandInteraction): Promise<void> {
  if (!interaction.guild) return;
  const server = await getServerForInteraction(interaction);
  if (!server) return;
  await interaction.deferReply({ flags: MessageFlags.Ephemeral });

  const player = await db.getPlayerByDiscord(server.id, interaction.user.id);
  if (!player) {
    await interaction.editReply({ content: "You are not linked. Use /link first." });
    return;
  }

  await syncPlayerRoles(interaction.guild, server.id, interaction.user.id, player.ingame_name);
  await interaction.editReply({ content: "Your roles have been synced." });
}

export async function handleSyncTarget(interaction: ChatInputCommandInteraction): Promise<void> {
  if (!await requireRole(interaction, "avivadmin")) return;
  if (!interaction.guild) return;
  const server = await getServerForInteraction(interaction);
  if (!server) return;

  await interaction.deferReply({ flags: MessageFlags.Ephemeral });

  const targetUser = interaction.options.getUser("player", true);
  const player = await db.getPlayerByDiscord(server.id, targetUser.id);
  if (!player) {
    await interaction.editReply({ content: `<@${targetUser.id}> is not linked.` });
    return;
  }

  await syncPlayerRoles(interaction.guild, server.id, targetUser.id, player.ingame_name);
  await interaction.editReply({ content: `Synced roles for <@${targetUser.id}>.` });
}

export async function handleGetPlayerinfo(interaction: ChatInputCommandInteraction): Promise<void> {
  if (!await requireRole(interaction, "avivadmin")) return;
  const server = await getServerForInteraction(interaction);
  if (!server) return;

  await interaction.deferReply({ flags: MessageFlags.Ephemeral });

  const ingameName = interaction.options.getString("ingame_name", true);
  const player = await db.getPlayerByIngameName(server.id, ingameName);
  const economy = await db.getEconomy(server.id, ingameName);
  const warnings = await db.getWarnings(server.id, ingameName);

  const embed = new EmbedBuilder()
    .setTitle(`Player Info: ${ingameName}`)
    .setColor(0x5865f2)
    .addFields(
      { name: "Discord", value: player ? `<@${player.discord_user_id}>` : "Not linked" },
      { name: "Balance", value: String(economy?.balance ?? 0) },
      { name: "Warnings", value: String(warnings.length) },
      { name: "Linked At", value: player?.linked_at ?? "N/A" }
    );

  await interaction.editReply({ embeds: [embed] });
}

async function syncPlayerRoles(guild: import("discord.js").Guild, serverId: number, discordUserId: string, ingameName: string): Promise<void> {
  const listMappings: Record<string, string> = {
    "viplist": "vip-1",
    "recyclerlist": "recycler-1",
    "zorpallowlist": "zorp-1",
  };

  try {
    const member = await guild.members.fetch(discordUserId);
    for (const [listName, roleName] of Object.entries(listMappings)) {
      const onList = await db.isOnList(serverId, listName, ingameName);
      const role = guild.roles.cache.find(r => r.name === roleName);
      if (role) {
        if (onList && !member.roles.cache.has(role.id)) await member.roles.add(role);
        if (!onList && member.roles.cache.has(role.id)) await member.roles.remove(role);
      }
    }
  } catch { /* member may have left */ }
}
