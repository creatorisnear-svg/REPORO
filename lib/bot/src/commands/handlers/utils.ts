import type { ChatInputCommandInteraction } from "discord.js";
import * as db from "@workspace/db";

export async function requireRole(
  interaction: ChatInputCommandInteraction,
  roleName: "avivadmin" | "avivmod"
): Promise<boolean> {
  const member = interaction.member;
  if (!member || !interaction.guild) {
    await interaction.reply({ content: "This command must be used in a server.", ephemeral: true });
    return false;
  }
  const roles = interaction.guild.roles.cache;
  const role = roles.find(r => r.name === roleName);
  if (!role) {
    await interaction.reply({ content: `Role "${roleName}" not found. Run /setup first.`, ephemeral: true });
    return false;
  }
  const memberRoles = (member as { roles: { cache: Map<string, unknown> } }).roles.cache;
  const adminRole = roles.find(r => r.name === "avivadmin");
  const hasAdmin = adminRole ? memberRoles.has(adminRole.id) : false;
  const hasMod = role ? memberRoles.has(role.id) : false;
  if (!hasAdmin && !hasMod) {
    await interaction.reply({ content: `You need the **${roleName}** role to use this command.`, ephemeral: true });
    return false;
  }
  return true;
}

export async function requireAdmin(interaction: ChatInputCommandInteraction): Promise<boolean> {
  return requireRole(interaction, "avivadmin");
}

export async function getServerForInteraction(interaction: ChatInputCommandInteraction): Promise<db.ServerRow | null> {
  if (!interaction.guild) {
    await interaction.reply({ content: "Must be used in a server.", ephemeral: true });
    return null;
  }
  const serverNum = interaction.options.getInteger("server") ?? 1;
  const server = await db.getServerByGuildAndNumber(interaction.guild.id, serverNum);
  if (!server) {
    await interaction.reply({ content: `Server ${serverNum} not configured. Use /add-server first.`, ephemeral: true });
    return null;
  }
  return server;
}

export async function getLinkedName(interaction: ChatInputCommandInteraction, serverId: number): Promise<string | null> {
  const player = await db.getPlayerByDiscord(serverId, interaction.user.id);
  return player?.ingame_name ?? null;
}

export function formatCurrency(amount: number, currencyName: string): string {
  return `${amount} ${currencyName}`;
}

export function randomInt(min: number, max: number): number {
  return Math.floor(Math.random() * (max - min + 1)) + min;
}
