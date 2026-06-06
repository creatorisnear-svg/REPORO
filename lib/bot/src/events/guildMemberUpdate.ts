import type { GuildMember, PartialGuildMember } from "discord.js";

export async function handleGuildMemberUpdate(
  _oldMember: GuildMember | PartialGuildMember,
  _newMember: GuildMember
): Promise<void> {
  // Reserved for role sync on premium role assignment, etc.
}
