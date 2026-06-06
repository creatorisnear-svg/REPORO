import type { GuildMember, PartialGuildMember } from "discord.js";
import * as db from "@workspace/db";

// Maps a Discord role name to { list, serverNumber } or null if not a managed role
interface RoleMapping {
  list: string;
  serverNumber: number | "all";
}

function parseRoleMapping(roleName: string): RoleMapping | null {
  // vip-1, vip-2, vip-all
  const vipMatch = roleName.match(/^vip-(\d+|all)$/);
  if (vipMatch) {
    const n = vipMatch[1];
    return { list: "viplist", serverNumber: n === "all" ? "all" : parseInt(n, 10) };
  }

  // elitekit<1-44>-<1-3>  e.g. elitekit1-1, elitekit22-2
  const eliteMatch = roleName.match(/^elitekit(\d+)-(\d+)$/);
  if (eliteMatch) {
    const kitNum = parseInt(eliteMatch[1], 10);
    const srvNum = parseInt(eliteMatch[2], 10);
    return { list: `elitelist${kitNum}`, serverNumber: srvNum };
  }

  // zorp-1, zorp-2, zorp-3
  const zorpMatch = roleName.match(/^zorp-(\d+)$/);
  if (zorpMatch) {
    return { list: "zorpallowlist", serverNumber: parseInt(zorpMatch[1], 10) };
  }

  // recycler-1, recycler-2, recycler-all
  const recyclerMatch = roleName.match(/^recycler-(\d+|all)$/);
  if (recyclerMatch) {
    const n = recyclerMatch[1];
    return { list: "recyclerlist", serverNumber: n === "all" ? "all" : parseInt(n, 10) };
  }

  // tpn-1, tpne-1, tpe-1, tpse-1, tps-1, tpsw-1, tpw-1, tpnw-1
  const tpMatch = roleName.match(/^(tpn|tpne|tpe|tpse|tps|tpsw|tpw|tpnw)-(\d+)$/);
  if (tpMatch) {
    const dir = tpMatch[1];
    const srvNum = parseInt(tpMatch[2], 10);
    return { list: `${dir}list`, serverNumber: srvNum };
  }

  return null;
}

export async function handleGuildMemberUpdate(
  oldMember: GuildMember | PartialGuildMember,
  newMember: GuildMember
): Promise<void> {
  if (!newMember.guild) return;

  const guildId = newMember.guild.id;
  const discordUserId = newMember.id;

  // Determine which roles were added or removed
  const oldRoles = oldMember.roles?.cache ?? new Map();
  const newRoles = newMember.roles.cache;

  const addedRoleNames: string[] = [];
  const removedRoleNames: string[] = [];

  for (const [id, role] of newRoles) {
    if (!oldRoles.has(id)) addedRoleNames.push(role.name);
  }
  for (const [id, role] of oldRoles) {
    if (!newRoles.has(id)) removedRoleNames.push(role.name);
  }

  if (addedRoleNames.length === 0 && removedRoleNames.length === 0) return;

  // Get all servers for this guild
  const servers = await db.getServersByGuild(guildId).catch(() => [] as db.ServerRow[]);
  if (servers.length === 0) return;

  const getIngameName = async (serverId: number): Promise<string | null> => {
    const player = await db.getPlayerByDiscord(serverId, discordUserId).catch(() => null);
    return player?.ingame_name ?? null;
  };

  const applyMapping = async (roleName: string, add: boolean): Promise<void> => {
    const mapping = parseRoleMapping(roleName);
    if (!mapping) return;

    if (mapping.serverNumber === "all") {
      for (const server of servers) {
        const ingameName = await getIngameName(server.id);
        if (!ingameName) continue;
        if (add) {
          await db.addToList(server.id, mapping.list, ingameName).catch(() => null);
        } else {
          await db.removeFromList(server.id, mapping.list, ingameName).catch(() => null);
        }
      }
    } else {
      const server = servers.find(s => s.server_number === mapping.serverNumber);
      if (!server) return;
      const ingameName = await getIngameName(server.id);
      if (!ingameName) return;
      if (add) {
        await db.addToList(server.id, mapping.list, ingameName).catch(() => null);
      } else {
        await db.removeFromList(server.id, mapping.list, ingameName).catch(() => null);
      }
    }
  };

  for (const roleName of addedRoleNames) {
    await applyMapping(roleName, true);
  }
  for (const roleName of removedRoleNames) {
    await applyMapping(roleName, false);
  }
}
