import type { ChatInputCommandInteraction } from "discord.js";
import { EmbedBuilder, MessageFlags } from "discord.js";
import * as db from "@workspace/db";
import { getServerForInteraction, requireRole } from "./utils.js";
import { rconManager } from "../../rcon/manager.js";

async function logCmd(interaction: ChatInputCommandInteraction, server: db.ServerRow, msg: string): Promise<void> {
  if (!interaction.guild) return;
  const channelId = await db.getChannel(server.id, "cmd-logs");
  if (!channelId) return;
  const ch = interaction.guild.channels.cache.get(channelId);
  if (ch && ch.isTextBased()) {
    await ch.send(`[MOD] ${interaction.user.tag}: ${msg}`).catch(() => null);
  }
}

async function sendRcon(server: db.ServerRow, cmd: string): Promise<{ ok: boolean; error?: string }> {
  if (!server.rcon_host) {
    return { ok: false, error: "RCON host not set. Use /add-server to configure RCON." };
  }
  try {
    await rconManager.sendFireAndForget(server.id, server.rcon_host, server.rcon_port!, server.rcon_password!, cmd);
    return { ok: true };
  } catch (err) {
    return { ok: false, error: String(err) };
  }
}

function rconNote(result: { ok: boolean; error?: string }): string {
  if (result.ok) return "";
  return `\n\n**RCON Warning:** Command may not have reached the server — ${result.error}\nCheck RCON status with \`/diag\`.`;
}

export async function handleKick(interaction: ChatInputCommandInteraction): Promise<void> {
  if (!await requireRole(interaction, "avivmod")) return;
  const server = await getServerForInteraction(interaction);
  if (!server) return;

  await interaction.deferReply({ flags: MessageFlags.Ephemeral });

  const ingameName = interaction.options.getString("ingame_name", true);
  const reason = interaction.options.getString("reason") ?? "No reason given";

  const result = await sendRcon(server, `global.kick "${ingameName}" "${reason}"`);
  await logCmd(interaction, server, `kicked **${ingameName}** — ${reason}`);
  await interaction.editReply({
    content: `Kicked **${ingameName}** (${reason}).${rconNote(result)}`,
  });
}

export async function handleBan(interaction: ChatInputCommandInteraction): Promise<void> {
  if (!await requireRole(interaction, "avivmod")) return;
  const server = await getServerForInteraction(interaction);
  if (!server) return;

  await interaction.deferReply({ flags: MessageFlags.Ephemeral });

  const ingameName = interaction.options.getString("ingame_name", true);
  const reason = interaction.options.getString("reason") ?? "No reason given";

  const result = await sendRcon(server, `global.ban "${ingameName}" 0 "${reason}"`);
  await logCmd(interaction, server, `banned **${ingameName}** — ${reason}`);
  await interaction.editReply({
    content: `Banned **${ingameName}** (${reason}).${rconNote(result)}`,
  });
}

export async function handleUnban(interaction: ChatInputCommandInteraction): Promise<void> {
  if (!await requireRole(interaction, "avivmod")) return;
  const server = await getServerForInteraction(interaction);
  if (!server) return;

  await interaction.deferReply({ flags: MessageFlags.Ephemeral });

  const ingameName = interaction.options.getString("ingame_name", true);
  const result = await sendRcon(server, `global.unban "${ingameName}"`);
  await logCmd(interaction, server, `unbanned **${ingameName}**`);
  await interaction.editReply({
    content: `Unbanned **${ingameName}**.${rconNote(result)}`,
  });
}

export async function handleMute(interaction: ChatInputCommandInteraction): Promise<void> {
  if (!await requireRole(interaction, "avivmod")) return;
  const server = await getServerForInteraction(interaction);
  if (!server) return;

  await interaction.deferReply({ flags: MessageFlags.Ephemeral });

  const ingameName = interaction.options.getString("ingame_name", true);
  const result = await sendRcon(server, `global.mutechat "${ingameName}"`);
  await logCmd(interaction, server, `muted **${ingameName}**`);
  await interaction.editReply({
    content: `Muted **${ingameName}**.${rconNote(result)}`,
  });
}

export async function handleUnmute(interaction: ChatInputCommandInteraction): Promise<void> {
  if (!await requireRole(interaction, "avivmod")) return;
  const server = await getServerForInteraction(interaction);
  if (!server) return;

  await interaction.deferReply({ flags: MessageFlags.Ephemeral });

  const ingameName = interaction.options.getString("ingame_name", true);
  const result = await sendRcon(server, `global.unmutechat "${ingameName}"`);
  await logCmd(interaction, server, `unmuted **${ingameName}**`);
  await interaction.editReply({
    content: `Unmuted **${ingameName}**.${rconNote(result)}`,
  });
}

export async function handleWarn(interaction: ChatInputCommandInteraction): Promise<void> {
  if (!await requireRole(interaction, "avivmod")) return;
  const server = await getServerForInteraction(interaction);
  if (!server) return;

  await interaction.deferReply({ flags: MessageFlags.Ephemeral });

  const ingameName = interaction.options.getString("ingame_name", true);
  const reason = interaction.options.getString("reason", true);

  await db.addWarning(server.id, ingameName, reason);
  const allWarnings = await db.getWarnings(server.id, ingameName);

  const result = await sendRcon(server, `global.say "${ingameName} has received a warning: ${reason}"`);
  await logCmd(interaction, server, `warned **${ingameName}** (${allWarnings.length} total) — ${reason}`);
  await interaction.editReply({
    content: `Warning issued to **${ingameName}** (${allWarnings.length} total). Reason: ${reason}${rconNote(result)}`,
  });
}

export async function handleWarnings(interaction: ChatInputCommandInteraction): Promise<void> {
  if (!await requireRole(interaction, "avivmod")) return;
  const server = await getServerForInteraction(interaction);
  if (!server) return;

  const ingameName = interaction.options.getString("ingame_name", true);
  const warnings = await db.getWarnings(server.id, ingameName);

  if (warnings.length === 0) {
    await interaction.reply({ content: `**${ingameName}** has no warnings.`, flags: MessageFlags.Ephemeral });
    return;
  }

  const desc = warnings.map((w, i) => `**${i + 1}.** ${w.reason} (${new Date(w.issued_at).toLocaleDateString()})`).join("\n");
  const embed = new EmbedBuilder()
    .setTitle(`Warnings: ${ingameName}`)
    .setDescription(desc)
    .setColor(0xe74c3c);
  await interaction.reply({ embeds: [embed], flags: MessageFlags.Ephemeral });
}

export async function handleClearwarnings(interaction: ChatInputCommandInteraction): Promise<void> {
  if (!await requireRole(interaction, "avivadmin")) return;
  const server = await getServerForInteraction(interaction);
  if (!server) return;

  await interaction.deferReply({ flags: MessageFlags.Ephemeral });

  const ingameName = interaction.options.getString("ingame_name", true);
  await db.clearWarnings(server.id, ingameName);
  await logCmd(interaction, server, `cleared warnings for **${ingameName}**`);
  await interaction.editReply({ content: `Cleared all warnings for **${ingameName}**.` });
}

export async function handleTempBan(interaction: ChatInputCommandInteraction): Promise<void> {
  if (!await requireRole(interaction, "avivmod")) return;
  const server = await getServerForInteraction(interaction);
  if (!server) return;

  await interaction.deferReply({ flags: MessageFlags.Ephemeral });

  const ingameName = interaction.options.getString("ingame_name", true);
  const hours = interaction.options.getInteger("hours", true);
  const reason = interaction.options.getString("reason") ?? "Temporary ban";

  const result = await sendRcon(server, `global.ban "${ingameName}" ${hours} "${reason}"`);
  await logCmd(interaction, server, `temp-banned **${ingameName}** for ${hours}h — ${reason}`);
  await interaction.editReply({
    content: `Temp-banned **${ingameName}** for **${hours} hour(s)**. Reason: ${reason}${rconNote(result)}`,
  });
}

export async function handleGive(interaction: ChatInputCommandInteraction): Promise<void> {
  if (!await requireRole(interaction, "avivmod")) return;
  const server = await getServerForInteraction(interaction);
  if (!server) return;

  await interaction.deferReply({ flags: MessageFlags.Ephemeral });

  const ingameName = interaction.options.getString("ingame_name", true);
  const item = interaction.options.getString("item", true);
  const amount = interaction.options.getInteger("amount") ?? 1;

  const result = await sendRcon(server, `inventory.giveplayer "${ingameName}" "${item}" ${amount}`);
  await logCmd(interaction, server, `gave **${ingameName}** ${amount}x ${item}`);
  await interaction.editReply({
    content: `Gave **${ingameName}** ${amount}x \`${item}\`.${rconNote(result)}`,
  });
}

export async function handleGetBan(interaction: ChatInputCommandInteraction): Promise<void> {
  if (!await requireRole(interaction, "avivmod")) return;
  const server = await getServerForInteraction(interaction);
  if (!server) return;
  await interaction.deferReply({ flags: MessageFlags.Ephemeral });

  const ingameName = interaction.options.getString("ingame_name", true);

  if (!server.rcon_host) {
    await interaction.editReply({ content: "RCON not configured for this server." });
    return;
  }

  try {
    const response = await rconManager.sendCommand(
      server.id, server.rcon_host, server.rcon_port!, server.rcon_password!,
      "banlist"
    );

    const lines = response.split("\n").filter(l => l.trim());
    const matchLine = lines.find(l => l.toLowerCase().includes(ingameName.toLowerCase()));

    if (matchLine) {
      const embed = new EmbedBuilder()
        .setTitle("🔨 Player is Banned")
        .setColor(0xe74c3c)
        .setDescription(`**${ingameName}** is on the ban list.\n\nEntry:\n\`\`\`\n${matchLine.trim().slice(0, 500)}\n\`\`\``)
        .setFooter({ text: `Server ${server.server_number}` });
      await interaction.editReply({ embeds: [embed] });
    } else {
      const embed = new EmbedBuilder()
        .setTitle("✅ Player Not Banned")
        .setColor(0x2ecc71)
        .setDescription(`**${ingameName}** was not found in the ban list on Server ${server.server_number}.`)
        .setFooter({ text: "Note: name matching is case-insensitive" });
      await interaction.editReply({ embeds: [embed] });
    }
  } catch (err) {
    await interaction.editReply({ content: `Failed to query ban list: ${String(err)}` });
  }
}

export async function handlePlaying(interaction: ChatInputCommandInteraction): Promise<void> {
  if (!await requireRole(interaction, "avivmod")) return;
  const server = await getServerForInteraction(interaction);
  if (!server) return;

  await interaction.deferReply({ flags: MessageFlags.Ephemeral });

  const ingameName = interaction.options.getString("ingame_name", true);

  if (!server.rcon_host) {
    await interaction.editReply({ content: "RCON not configured for this server." });
    return;
  }

  try {
    const response = await rconManager.sendCommand(
      server.id, server.rcon_host, server.rcon_port!, server.rcon_password!, "playerlist"
    );
    // Check each line for an exact (case-insensitive) word-boundary match to avoid
    // partial-name false positives (e.g. "john" matching "johnson").
    const lines = response.split("\n").map(l => l.trim()).filter(Boolean);
    const online = lines.some(l => l.toLowerCase().includes(ingameName.toLowerCase()));
    await interaction.editReply({
      content: online
        ? `\u{1F7E2} **${ingameName}** is currently **online** on Server ${server.server_number}.`
        : `\u{1F534} **${ingameName}** is currently **offline** on Server ${server.server_number}.`,
    });
  } catch {
    await interaction.editReply({ content: "Could not reach RCON to check player status." });
  }
}
