import type { ChatInputCommandInteraction, AutocompleteInteraction } from "discord.js";
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
  const serverNum = interaction.options.getInteger("server");

  if (!serverNum) {
    // No server specified - check how many are configured
    const all = await db.getServersByGuild(interaction.guild.id);
    if (all.length === 0) {
      await interaction.reply({ content: "No servers configured. Use /add-server first.", ephemeral: true });
      return null;
    }
    if (all.length === 1) {
      return all[0]!;
    }
    // Multiple servers - show a list so the user can choose
    const list = all.map(s => `**${s.server_number}** — ${s.server_label}`).join("\n");
    await interaction.reply({
      content: `Multiple servers are configured. Please specify which one with the \`server\` option:\n\n${list}\n\nExample: \`/balance server:1\``,
      ephemeral: true,
    });
    return null;
  }

  const server = await db.getServerByGuildAndNumber(interaction.guild.id, serverNum);
  if (!server) {
    const all = await db.getServersByGuild(interaction.guild.id);
    const hint = all.length > 0
      ? "\n\nAvailable servers:\n" + all.map(s => `**${s.server_number}** — ${s.server_label}`).join("\n")
      : "";
    await interaction.reply({ content: `Server ${serverNum} not configured.${hint}`, ephemeral: true });
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

// Shared autocomplete handler for the "server" option across all commands
export async function autocompleteServer(interaction: AutocompleteInteraction): Promise<void> {
  if (!interaction.guild) { await interaction.respond([]); return; }
  const servers = await db.getServersByGuild(interaction.guild.id).catch(() => []);
  const focused = interaction.options.getFocused().toString().toLowerCase();
  const filtered = servers.filter(s =>
    String(s.server_number).includes(focused) ||
    s.server_label.toLowerCase().includes(focused)
  );
  await interaction.respond(
    filtered.slice(0, 25).map(s => ({
      name: `${s.server_number} | ${s.server_label}`,
      value: s.server_number,
    }))
  );
}
