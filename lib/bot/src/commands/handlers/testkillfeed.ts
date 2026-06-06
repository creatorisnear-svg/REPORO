import type { ChatInputCommandInteraction } from "discord.js";
import { EmbedBuilder, MessageFlags } from "discord.js";
import { getServerForInteraction, requireRole } from "./utils.js";
import { simulateKill } from "../../rcon/parser.js";

export async function handleTestKillfeed(interaction: ChatInputCommandInteraction): Promise<void> {
  if (!await requireRole(interaction, "avivadmin")) return;
  const server = await getServerForInteraction(interaction);
  if (!server) return;

  await interaction.deferReply({ flags: MessageFlags.Ephemeral });

  const type = interaction.options.getString("type") ?? "pvp";
  const killer = interaction.options.getString("killer") ?? "TestKiller";
  const victim = interaction.options.getString("victim") ?? "TestVictim";
  const weapon = interaction.options.getString("weapon") ?? "AK47";

  let k = killer;
  let v = victim;
  let w = weapon;

  switch (type) {
    case "fall":
      k = "fall";
      v = victim;
      w = "fall";
      break;
    case "suicide":
      k = victim;
      v = victim;
      w = "suicide";
      break;
    case "scientist":
      k = "scientist";
      v = victim;
      w = weapon;
      break;
    case "pvp":
    default:
      break;
  }

  try {
    await simulateKill(server.id, k, v, w);

    const embed = new EmbedBuilder()
      .setTitle("Test Kill Fired")
      .setColor(0x3DBA8C)
      .setDescription(
        `Simulated a **${type}** kill event on Server ${server.server_number}.\n\n` +
        `**Killer:** \`${k}\`\n` +
        `**Victim:** \`${v}\`\n` +
        `**Weapon:** \`${w}\`\n\n` +
        `Check your killfeed channel and in-game chat for the output.\n` +
        `If nothing appeared, check:\n` +
        `• KillFeedDiscord is \`on\` (use \`/set KillFeedDiscord on\`)\n` +
        `• KillFeedGame is \`on\` (use \`/set KillFeedGame on\`)\n` +
        `• The killfeed channel is set (use \`/admin-channels\`)\n` +
        `• RCON is connected (use \`/diag\`)`
      )
      .setFooter({ text: "This simulates the kill pipeline — no real player was harmed." });

    await interaction.editReply({ embeds: [embed] });
  } catch (err) {
    await interaction.editReply({ content: `Error running test: ${String(err)}` });
  }
}
