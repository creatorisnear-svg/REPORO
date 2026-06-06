import type { ChatInputCommandInteraction, AutocompleteInteraction } from "discord.js";
import { MessageFlags } from "discord.js";
import * as db from "@workspace/db";

export async function requireRole(
  interaction: ChatInputCommandInteraction,
  roleName: "avivadmin" | "avivmod"
): Promise<boolean> {
  const member = interaction.member;
  if (!member || !interaction.guild) {
    await interaction.reply({ content: "This command must be used in a server.", flags: MessageFlags.Ephemeral });
    return false;
  }
  const roles = interaction.guild.roles.cache;
  const role = roles.find(r => r.name === roleName);
  if (!role) {
    await interaction.reply({ content: `Role "${roleName}" not found. Run /setup first.`, flags: MessageFlags.Ephemeral });
    return false;
  }
  const memberRoles = (member as { roles: { cache: Map<string, unknown> } }).roles.cache;
  const adminRole = roles.find(r => r.name === "avivadmin");
  const hasAdmin = adminRole ? memberRoles.has(adminRole.id) : false;
  const hasMod = role ? memberRoles.has(role.id) : false;
  if (!hasAdmin && !hasMod) {
    await interaction.reply({ content: `You need the **${roleName}** role to use this command.`, flags: MessageFlags.Ephemeral });
    return false;
  }
  return true;
}

export async function requireAdmin(interaction: ChatInputCommandInteraction): Promise<boolean> {
  return requireRole(interaction, "avivadmin");
}

export async function getServerForInteraction(interaction: ChatInputCommandInteraction): Promise<db.ServerRow | null> {
  if (!interaction.guild) {
    await interaction.reply({ content: "Must be used in a server.", flags: MessageFlags.Ephemeral });
    return null;
  }
  const serverNum = interaction.options.getInteger("server");

  if (!serverNum) {
    // No server specified - check how many are configured
    const all = await db.getServersByGuild(interaction.guild.id);
    if (all.length === 0) {
      await interaction.reply({ content: "No servers configured. Use /add-server first.", flags: MessageFlags.Ephemeral });
      return null;
    }
    if (all.length === 1) {
      return all[0]!;
    }
    // Multiple servers - show a list so the user can choose
    const list = all.map(s => `**${s.server_number}** — ${s.server_label}`).join("\n");
    await interaction.reply({
      content: `Multiple servers are configured. Please specify which one with the \`server\` option:\n\n${list}\n\nExample: \`/balance server:1\``,
      flags: MessageFlags.Ephemeral,
    });
    return null;
  }

  const server = await db.getServerByGuildAndNumber(interaction.guild.id, serverNum);
  if (!server) {
    const all = await db.getServersByGuild(interaction.guild.id);
    const hint = all.length > 0
      ? "\n\nAvailable servers:\n" + all.map(s => `**${s.server_number}** — ${s.server_label}`).join("\n")
      : "";
    await interaction.reply({ content: `Server ${serverNum} not configured.${hint}`, flags: MessageFlags.Ephemeral });
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

// Synchronous role check that doesn't call interaction.reply().
// Use this when you've already called deferReply and need to check permissions afterward.
export function hasRole(
  interaction: ChatInputCommandInteraction,
  roleName: "avivadmin" | "avivmod"
): boolean {
  if (!interaction.guild || !interaction.member) return false;
  const roles = interaction.guild.roles.cache;
  const adminRole = roles.find(r => r.name === "avivadmin");
  const targetRole = roles.find(r => r.name === roleName);
  const memberRoles = (interaction.member as { roles: { cache: Map<string, unknown> } }).roles.cache;
  const hasAdmin = adminRole ? memberRoles.has(adminRole.id) : false;
  const hasTarget = targetRole ? memberRoles.has(targetRole.id) : false;
  return hasAdmin || hasTarget;
}

// Kit names autocomplete — searches all servers in the guild's kitlist
export async function autocompleteKitNameForGuild(interaction: AutocompleteInteraction, guildId: string): Promise<void> {
  const servers = await db.getServersByGuild(guildId).catch(() => []);
  const query = interaction.options.getFocused().toString().toLowerCase();
  const kits = new Set<string>();
  for (const s of servers) {
    const list = await db.getList(s.id, "kitlist").catch(() => []);
    for (const row of list) kits.add(row.ingame_name);
  }
  const matches = [...kits].filter(k => k.toLowerCase().includes(query)).slice(0, 25);
  await interaction.respond(matches.map(k => ({ name: k, value: k })));
}

// In-game name autocomplete — searches all linked players in the guild
export async function autocompleteIngameNameForGuild(interaction: AutocompleteInteraction, guildId: string): Promise<void> {
  const servers = await db.getServersByGuild(guildId).catch(() => []);
  const query = interaction.options.getFocused().toString().toLowerCase();
  const names = new Set<string>();
  for (const s of servers) {
    const players = await db.getPlayersByServer(s.id).catch(() => []);
    for (const p of players) {
      if (p.ingame_name.toLowerCase().includes(query)) names.add(p.ingame_name);
    }
  }
  await interaction.respond([...names].slice(0, 25).map(n => ({ name: n, value: n })));
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
