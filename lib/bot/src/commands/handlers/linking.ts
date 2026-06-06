import type { ChatInputCommandInteraction } from "discord.js";
import { EmbedBuilder } from "discord.js";
import * as db from "@workspace/db";
import { getServerForInteraction, requireRole } from "./utils.js";

export async function handleLink(interaction: ChatInputCommandInteraction): Promise<void> {
  if (!interaction.guild) return;
  const server = await getServerForInteraction(interaction);
  if (!server) return;

  await interaction.deferReply({ ephemeral: true });

  const ingameName = interaction.options.getString("ingame_name", true).trim();
  const existing = await db.getPlayerByDiscord(server.id, interaction.user.id);
  if (existing) {
    await interaction.editReply({ content: `You are already linked as **${existing.ingame_name}**. Use /unlink first.` });
    return;
  }

  const existingName = await db.getPlayerByIngameName(server.id, ingameName);
  if (existingName) {
    await interaction.editReply({ content: `**${ingameName}** is already linked to another Discord account.` });
    return;
  }

  await db.linkPlayer(server.id, interaction.user.id, ingameName);
  await db.ensureEconomy(server.id, ingameName);

  // Assign avivlinked role
  const linkedRole = interaction.guild.roles.cache.find(r => r.name === "avivlinked");
  if (linkedRole) {
    try {
      const member = await interaction.guild.members.fetch(interaction.user.id);
      await member.roles.add(linkedRole);
    } catch { /* ignore */ }
  }

  await interaction.editReply({ content: `Linked your Discord to **${ingameName}** on Server ${server.server_number}.` });
}

export async function handleUnlink(interaction: ChatInputCommandInteraction): Promise<void> {
  if (!interaction.guild) return;
  const server = await getServerForInteraction(interaction);
  if (!server) return;

  await interaction.deferReply({ ephemeral: true });

  const player = await db.getPlayerByDiscord(server.id, interaction.user.id);
  if (!player) {
    await interaction.editReply({ content: "You are not linked on this server." });
    return;
  }

  await db.unlinkPlayer(server.id, interaction.user.id);

  // Remove avivlinked role
  const linkedRole = interaction.guild.roles.cache.find(r => r.name === "avivlinked");
  if (linkedRole) {
    try {
      const member = await interaction.guild.members.fetch(interaction.user.id);
      await member.roles.remove(linkedRole);
    } catch { /* ignore */ }
  }

  await interaction.editReply({ content: `Unlinked **${player.ingame_name}** from your Discord.` });
}

export async function handleAdminLink(interaction: ChatInputCommandInteraction): Promise<void> {
  if (!await requireRole(interaction, "avivadmin")) return;
  if (!interaction.guild) return;
  const server = await getServerForInteraction(interaction);
  if (!server) return;

  await interaction.deferReply({ ephemeral: true });

  const ingameName = interaction.options.getString("ingame_name", true).trim();
  const targetUser = interaction.options.getUser("discord_user", true);

  await db.linkPlayer(server.id, targetUser.id, ingameName);
  await db.ensureEconomy(server.id, ingameName);

  const linkedRole = interaction.guild.roles.cache.find(r => r.name === "avivlinked");
  if (linkedRole) {
    try {
      const member = await interaction.guild.members.fetch(targetUser.id);
      await member.roles.add(linkedRole);
    } catch { /* ignore */ }
  }

  await interaction.editReply({ content: `Linked <@${targetUser.id}> to **${ingameName}** on Server ${server.server_number}.` });
}

export async function handleWhois(interaction: ChatInputCommandInteraction): Promise<void> {
  if (!interaction.guild) return;
  await interaction.deferReply({ ephemeral: true });

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
      if (player) lines.push(`Server ${server.server_number}: **${player.ingame_name}**`);
    } else if (ingameName) {
      const player = await db.getPlayerByIngameName(server.id, ingameName);
      if (player) lines.push(`Server ${server.server_number}: <@${player.discord_user_id}>`);
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
  await interaction.deferReply({ ephemeral: true });

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

  await interaction.deferReply({ ephemeral: true });

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

  await interaction.deferReply({ ephemeral: true });

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
