import type { ChatInputCommandInteraction } from "discord.js";
import { EmbedBuilder, MessageFlags } from "discord.js";
import * as db from "@workspace/db";
import { getServerForInteraction, getLinkedName } from "./utils.js";

export async function handleClan(interaction: ChatInputCommandInteraction): Promise<void> {
  const server = await getServerForInteraction(interaction);
  if (!server) return;
  await interaction.deferReply({ flags: MessageFlags.Ephemeral });

  const subcommand = interaction.options.getSubcommand(true);

  if (subcommand === "create") {
    const name = interaction.options.getString("name", true).trim();
    const tag = interaction.options.getString("tag")?.trim() ?? null;

    if (name.length < 2 || name.length > 32) {
      await interaction.editReply({ content: "Clan name must be 2–32 characters." });
      return;
    }
    if (tag && (tag.length < 1 || tag.length > 6)) {
      await interaction.editReply({ content: "Clan tag must be 1–6 characters." });
      return;
    }

    const ingameName = await getLinkedName(interaction, server.id);
    if (!ingameName) {
      await interaction.editReply({ content: "You must be linked with `/link` to create a clan." });
      return;
    }

    const existing = await db.getPlayerClan(server.id, interaction.user.id).catch(() => null);
    if (existing) {
      await interaction.editReply({ content: `You are already in clan **${existing.name}**. Leave it first.` });
      return;
    }

    const nameTaken = await db.getClanByName(server.id, name).catch(() => null);
    if (nameTaken) {
      await interaction.editReply({ content: `A clan named **${name}** already exists on this server.` });
      return;
    }

    const clanId = await db.createClan(server.id, name, tag, interaction.user.id, ingameName);
    const embed = new EmbedBuilder()
      .setTitle("🏴 Clan Created!")
      .setColor(0x2ecc71)
      .setDescription(`**${name}**${tag ? ` [${tag}]` : ""} has been created!\nYou are the leader.`)
      .setFooter({ text: `Clan ID: ${clanId} | Server ${server.server_number}` });
    await interaction.editReply({ embeds: [embed] });
    return;
  }

  if (subcommand === "join") {
    const name = interaction.options.getString("name", true).trim();

    const ingameName = await getLinkedName(interaction, server.id);
    if (!ingameName) {
      await interaction.editReply({ content: "You must be linked with `/link` to join a clan." });
      return;
    }

    const existing = await db.getPlayerClan(server.id, interaction.user.id).catch(() => null);
    if (existing) {
      await interaction.editReply({ content: `You are already in clan **${existing.name}**. Leave it first.` });
      return;
    }

    const clan = await db.getClanByName(server.id, name).catch(() => null);
    if (!clan) {
      await interaction.editReply({ content: `No clan named **${name}** found on this server.` });
      return;
    }

    await db.addClanMember(clan.id, ingameName, interaction.user.id);
    await interaction.editReply({ content: `You have joined clan **${clan.name}**${clan.tag ? ` [${clan.tag}]` : ""}!` });
    return;
  }

  if (subcommand === "leave") {
    const clan = await db.getPlayerClan(server.id, interaction.user.id).catch(() => null);
    if (!clan) {
      await interaction.editReply({ content: "You are not in a clan." });
      return;
    }

    if (clan.leader_discord_id === interaction.user.id) {
      await interaction.editReply({ content: "You are the clan leader. Use `/clan disband` to disband the clan, or transfer leadership first." });
      return;
    }

    await db.removeClanMember(clan.id, interaction.user.id);
    await interaction.editReply({ content: `You have left clan **${clan.name}**.` });
    return;
  }

  if (subcommand === "disband") {
    const clan = await db.getPlayerClan(server.id, interaction.user.id).catch(() => null);
    if (!clan) {
      await interaction.editReply({ content: "You are not in a clan." });
      return;
    }

    if (clan.leader_discord_id !== interaction.user.id) {
      await interaction.editReply({ content: "Only the clan leader can disband the clan." });
      return;
    }

    await db.disbandClan(clan.id);
    await interaction.editReply({ content: `Clan **${clan.name}** has been disbanded.` });
    return;
  }

  if (subcommand === "info") {
    const nameOpt = interaction.options.getString("name");
    let clan: db.ClanRow | null = null;

    if (nameOpt) {
      clan = await db.getClanByName(server.id, nameOpt.trim()).catch(() => null);
    } else {
      const playerClan = await db.getPlayerClan(server.id, interaction.user.id).catch(() => null);
      if (playerClan) clan = playerClan;
    }

    if (!clan) {
      await interaction.editReply({ content: nameOpt ? `No clan named **${nameOpt}** found.` : "You are not in a clan. Use `/clan info name:<clanname>` to look one up." });
      return;
    }

    const members = await db.getClanMembers(clan.id).catch(() => [] as db.ClanMemberRow[]);
    const leader = members.find(m => m.role === "leader");
    const memberList = members
      .map(m => `${m.role === "leader" ? "👑" : "👤"} ${m.ingame_name}${m.discord_user_id ? ` (<@${m.discord_user_id}>)` : ""}`)
      .join("\n");

    const embed = new EmbedBuilder()
      .setTitle(`🏴 ${clan.name}${clan.tag ? ` [${clan.tag}]` : ""}`)
      .setColor(0x5865f2)
      .addFields(
        { name: "👑 Leader", value: leader ? `${leader.ingame_name}` : "Unknown", inline: true },
        { name: "👥 Members", value: String(members.length), inline: true },
        { name: "📅 Created", value: new Date(clan.created_at).toLocaleDateString(), inline: true },
        { name: "👥 Member List", value: memberList.substring(0, 1024) || "No members", inline: false },
      )
      .setFooter({ text: `Server ${server.server_number}` });

    await interaction.editReply({ embeds: [embed] });
    return;
  }

  if (subcommand === "list") {
    const clans = await db.listClans(server.id).catch(() => [] as db.ClanRow[]);
    if (clans.length === 0) {
      await interaction.editReply({ content: "No clans found on this server." });
      return;
    }

    const desc = clans
      .slice(0, 25)
      .map(c => `**${c.name}**${c.tag ? ` [${c.tag}]` : ""} — <@${c.leader_discord_id}>`)
      .join("\n");

    const embed = new EmbedBuilder()
      .setTitle(`🏴 Clans on Server ${server.server_number} (${clans.length})`)
      .setDescription(desc)
      .setColor(0x5865f2);

    await interaction.editReply({ embeds: [embed] });
    return;
  }

  await interaction.editReply({ content: "Unknown subcommand." });
}
