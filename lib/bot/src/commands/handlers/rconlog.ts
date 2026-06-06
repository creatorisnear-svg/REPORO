import type { ChatInputCommandInteraction } from "discord.js";
import { EmbedBuilder, MessageFlags } from "discord.js";
import { getServerForInteraction, requireRole } from "./utils.js";
import { getRconLogBuffer } from "../../rcon/parser.js";

const TYPE_COLORS: Record<string, number> = {
  Kill:    0xFF3333,
  Chat:    0x3DBA8C,
  Generic: 0x5865F2,
  Error:   0xFF6600,
  Warning: 0xFFCC00,
};

function typeTag(type: string): string {
  const tags: Record<string, string> = {
    Kill:    "[KILL]",
    Chat:    "[CHAT]",
    Generic: "[GEN ]",
    Error:   "[ERR ]",
    Warning: "[WARN]",
  };
  return tags[type] ?? `[${type.slice(0, 4).toUpperCase()}]`;
}

export async function handleRconLog(interaction: ChatInputCommandInteraction): Promise<void> {
  if (!await requireRole(interaction, "avivadmin")) return;
  const server = await getServerForInteraction(interaction);
  if (!server) return;

  await interaction.deferReply({ flags: MessageFlags.Ephemeral });

  const count = Math.min(interaction.options.getInteger("count") ?? 30, 50);
  const filterType = interaction.options.getString("filter") ?? null;

  let logs = getRconLogBuffer(server.id);

  if (logs.length === 0) {
    await interaction.editReply({
      content: "No RCON logs captured yet for this server. Logs are stored in memory after the bot connects — make sure RCON is connected and some activity has happened.",
    });
    return;
  }

  if (filterType) {
    logs = logs.filter(l => l.type.toLowerCase() === filterType.toLowerCase());
  }

  // Take the last `count` entries
  const slice = logs.slice(-count);

  if (slice.length === 0) {
    await interaction.editReply({ content: `No logs of type **${filterType}** found in the recent buffer.` });
    return;
  }

  const lines = slice.map(l => {
    const time = new Date(l.ts).toISOString().slice(11, 19);
    const tag = typeTag(l.type);
    const msg = l.msg.slice(0, 120);
    return `${time} ${tag} ${msg}`;
  });

  // Chunk into <=4000 chars per embed description
  const chunks: string[] = [];
  let current = "";
  for (const line of lines) {
    const addition = line + "\n";
    if (current.length + addition.length > 3800) {
      chunks.push(current);
      current = "";
    }
    current += addition;
  }
  if (current) chunks.push(current);

  const dominantType = filterType ?? (slice.length > 0 ? slice[slice.length - 1]!.type : "Generic");
  const color = TYPE_COLORS[dominantType] ?? 0x5865F2;

  const embeds = chunks.map((chunk, i) =>
    new EmbedBuilder()
      .setTitle(i === 0 ? `RCON Log — Server ${server.server_number} (last ${slice.length})` : null)
      .setDescription("```\n" + chunk + "```")
      .setColor(color)
      .setFooter(i === chunks.length - 1 ? { text: `Buffer holds up to 75 entries. Filter: ${filterType ?? "none"}` } : null)
  );

  await interaction.editReply({ embeds: embeds.slice(0, 10) });
}
