import type { ChatInputCommandInteraction } from "discord.js";
import { EmbedBuilder, MessageFlags } from "discord.js";
import * as db from "@workspace/db";
import { getServerForInteraction, getLinkedName } from "./utils.js";

function cooldownText(lastClaimed: string | null, cooldownHours: number): string {
  if (!lastClaimed) return "✅ Available";
  const last = new Date(lastClaimed).getTime();
  const cooldownMs = cooldownHours * 3600 * 1000;
  const remaining = cooldownMs - (Date.now() - last);
  if (remaining <= 0) return "✅ Available";
  const h = Math.floor(remaining / 3600_000);
  const m = Math.ceil((remaining % 3600_000) / 60_000);
  return h > 0 ? `⏳ ${h}h ${m}m` : `⏳ ${m}m`;
}

export async function handleActions(interaction: ChatInputCommandInteraction): Promise<void> {
  const server = await getServerForInteraction(interaction);
  if (!server) return;
  await interaction.deferReply({ flags: MessageFlags.Ephemeral });

  const ingameName = await getLinkedName(interaction, server.id);

  // Fetch early — needed for conflict detection in elite kits section below
  const tphomeEnabled = await db.getConfig(server.id, "TPHOME_use") ?? "off";

  const lines: string[] = [];

  // ---- Free Kit ----
  const freekitEnabled = await db.getConfig(server.id, "freekit_use") ?? "off";
  if (freekitEnabled === "on") {
    const freekitTime = parseFloat(await db.getConfig(server.id, "freekit_time") ?? "24");
    const freekitName = await db.getConfig(server.id, "freekit_name") ?? "freekit";
    let status = "✅ Available";
    if (ingameName) {
      const claim = await db.getLastKitClaim(server.id, ingameName, "freekit").catch(() => null);
      status = cooldownText(claim?.last_claimed ?? null, freekitTime);
    }
    lines.push(`**🎁 Free Kit** (\`${freekitName}\`) — Type \`I need wood\` in in-game chat\n  ${status}`);
  }

  // ---- VIP Kit ----
  const vipkitEnabled = await db.getConfig(server.id, "vipkit_use") ?? "off";
  if (vipkitEnabled === "on") {
    const vipkitTime = parseFloat(await db.getConfig(server.id, "vipkit_time") ?? "24");
    const vipkitName = await db.getConfig(server.id, "vipkit_name") ?? "vipkit";
    let status = "🔒 VIP only";
    if (ingameName) {
      const onVipList = await db.isOnList(server.id, "viplist", ingameName).catch(() => false);
      if (onVipList) {
        const claim = await db.getLastKitClaim(server.id, ingameName, "vipkit").catch(() => null);
        status = cooldownText(claim?.last_claimed ?? null, vipkitTime);
      }
    }
    lines.push(`**⭐ VIP Kit** (\`${vipkitName}\`) — Type \`I need stone\` in in-game chat\n  ${status}`);
  }

  // ---- Elite Kits (1-22 single-step) ----
  // Note: "Retreat!" (elitekit17) is overridden by TP Home when TPHOME_use is "on".
  // "Yes" (elitekit15) is overridden by the ZORP confirmation flow when a ZORP prompt is active.
  const eliteKitEmotes: Array<{ kit: string; phrase: string; label: string }> = [
    { kit: "elitekit",   phrase: "I Need Metal Fragments", label: "Elite Kit 1" },
    { kit: "elitekit2",  phrase: "I Need Scrap",            label: "Elite Kit 2" },
    { kit: "elitekit3",  phrase: "I Need Low Grade Fuel",   label: "Elite Kit 3" },
    { kit: "elitekit4",  phrase: "I Need Food",             label: "Elite Kit 4" },
    { kit: "elitekit5",  phrase: "Follow Me",               label: "Elite Kit 5" },
    { kit: "elitekit6",  phrase: "Help!",                   label: "Elite Kit 6" },
    { kit: "elitekit7",  phrase: "Nice",                    label: "Elite Kit 7" },
    { kit: "elitekit8",  phrase: "Sorry",                   label: "Elite Kit 8" },
    { kit: "elitekit9",  phrase: "Thank You",               label: "Elite Kit 9" },
    { kit: "elitekit10", phrase: "You're Welcome",          label: "Elite Kit 10" },
    { kit: "elitekit11", phrase: "Good Game",               label: "Elite Kit 11" },
    { kit: "elitekit12", phrase: "Watch Out",               label: "Elite Kit 12" },
    { kit: "elitekit13", phrase: "Good Luck",               label: "Elite Kit 13" },
    { kit: "elitekit14", phrase: "Well Played",             label: "Elite Kit 14" },
    { kit: "elitekit15", phrase: "Yes",                     label: "Elite Kit 15" },
    { kit: "elitekit16", phrase: "No",                      label: "Elite Kit 16" },
    { kit: "elitekit17", phrase: "Retreat!",                label: "Elite Kit 17" },
    { kit: "elitekit18", phrase: "Attack",                  label: "Elite Kit 18" },
    { kit: "elitekit19", phrase: "Wait",                    label: "Elite Kit 19" },
    { kit: "elitekit20", phrase: "Go Go Go",                label: "Elite Kit 20" },
    { kit: "elitekit21", phrase: "Need Backup",             label: "Elite Kit 21" },
    { kit: "elitekit22", phrase: "On My Way",               label: "Elite Kit 22" },
  ];

  const enabledEliteLines: string[] = [];
  for (const { kit, phrase, label } of eliteKitEmotes) {
    const enabled = await db.getConfig(server.id, `${kit}_use`) ?? "off";
    if (enabled !== "on") continue;

    const kitTime = parseFloat(await db.getConfig(server.id, `${kit}_time`) ?? "24");
    const kitName = await db.getConfig(server.id, `${kit}_name`) ?? kit;

    let status = "✅";

    // Conflict: "Retreat!" is consumed by TP Home when it is enabled
    if (kit === "elitekit17" && tphomeEnabled === "on") {
      enabledEliteLines.push(`**${label}** (\`${kitName}\`) — \`${phrase}\` — ⚠️ Unavailable (TP Home has priority over Retreat!)`);
      continue;
    }

    if (ingameName) {
      const uselistEnabled = await db.getConfig(server.id, `${kit}_uselist`) ?? "off";
      if (uselistEnabled === "on") {
        const num = kit === "elitekit" ? "1" : kit.replace("elitekit", "");
        const listName = `elitelist${num}`;
        const onList = await db.isOnList(server.id, listName, ingameName).catch(() => false);
        if (!onList) { status = "🔒"; continue; }
      }
      const claim = await db.getLastKitClaim(server.id, ingameName, kit).catch(() => null);
      status = cooldownText(claim?.last_claimed ?? null, kitTime) === "✅ Available" ? "✅" : cooldownText(claim?.last_claimed ?? null, kitTime);
    }

    enabledEliteLines.push(`**${label}** (\`${kitName}\`) — \`${phrase}\` emote — ${status}`);
  }
  if (enabledEliteLines.length > 0) {
    lines.push(`\n**🔱 Elite Kits** — Trigger via emote wheel:\n${enabledEliteLines.join("\n")}`);
  }

  // ---- Two-step Elite Kits (23-44) ----
  const twoStepPhrases: Array<{ kit: string; phrase: string }> = [
    { kit: "elitekit23", phrase: "I Need Wood" },
    { kit: "elitekit24", phrase: "I Need Stone" },
    { kit: "elitekit25", phrase: "I Need Scrap" },
    { kit: "elitekit26", phrase: "I Need Metal Fragments" },
    { kit: "elitekit27", phrase: "I Need Low Grade Fuel" },
    { kit: "elitekit28", phrase: "I Need Food" },
  ];
  const enabledTwoStepLines: string[] = [];
  for (const { kit, phrase } of twoStepPhrases) {
    const enabled = await db.getConfig(server.id, `${kit}_use`) ?? "off";
    if (enabled !== "on") continue;
    const kitName = await db.getConfig(server.id, `${kit}_name`) ?? kit;
    let status = "✅";
    if (ingameName) {
      const claim = await db.getLastKitClaim(server.id, ingameName, kit).catch(() => null);
      const kitTime = parseFloat(await db.getConfig(server.id, `${kit}_time`) ?? "24");
      status = cooldownText(claim?.last_claimed ?? null, kitTime) === "✅ Available" ? "✅" : cooldownText(claim?.last_claimed ?? null, kitTime);
    }
    const num = parseInt(kit.replace("elitekit", ""));
    enabledTwoStepLines.push(`**Elite Kit ${num}** (\`${kitName}\`) — \`I'm out of ammo\` → \`${phrase}\` — ${status}`);
  }
  if (enabledTwoStepLines.length > 0) {
    lines.push(`\n**🔱 Two-Step Elite Kits** — Type \`I'm out of ammo\` in chat first, then use the emote:\n${enabledTwoStepLines.join("\n")}`);
  }

  // ---- Recycler ----
  const recyclerEnabled = await db.getConfig(server.id, "recyclers_use") ?? "off";
  if (recyclerEnabled === "on") {
    const recyclerTime = parseFloat(await db.getConfig(server.id, "recyclers_time") ?? "24");
    let status = "✅ Available";
    if (ingameName) {
      const uselistEnabled = await db.getConfig(server.id, "recyclers_uselist") ?? "off";
      if (uselistEnabled === "on") {
        const onList = await db.isOnList(server.id, "recyclerlist", ingameName).catch(() => false);
        if (!onList) status = "🔒 List only";
        else {
          const claim = await db.getLastKitClaim(server.id, ingameName, "recycler").catch(() => null);
          status = cooldownText(claim?.last_claimed ?? null, recyclerTime);
        }
      } else {
        const claim = await db.getLastKitClaim(server.id, ingameName, "recycler").catch(() => null);
        status = cooldownText(claim?.last_claimed ?? null, recyclerTime);
      }
    }
    lines.push(`\n**♻️ Recycler** — Use the \`Repair This\` emote\n  ${status}`);
  }

  // ---- TP Home ----
  if (tphomeEnabled === "on") {
    let status = "Say `Can I have a key?` to set home, `Retreat!` to teleport";
    if (ingameName) {
      const home = await db.getTpHome(server.id, ingameName).catch(() => null);
      if (home?.home_set) status = "✅ Home set — Say `Retreat!` to teleport home";
      else status = "⚠️ No home set — Say `Can I have a key?` near your bed to set it";
    }
    lines.push(`\n**🏠 TP Home** — ${status}`);
  }

  // ---- Directional Teleports ----
  // Abbreviations match exactly what the parser listens for ("N", "NE", "E", etc.)
  const tpDirs = [
    { key: "TPN", abbr: "N", label: "North" }, { key: "TPNE", abbr: "NE", label: "North-East" },
    { key: "TPE", abbr: "E", label: "East" }, { key: "TPSE", abbr: "SE", label: "South-East" },
    { key: "TPS", abbr: "S", label: "South" }, { key: "TPSW", abbr: "SW", label: "South-West" },
    { key: "TPW", abbr: "W", label: "West" }, { key: "TPNW", abbr: "NW", label: "North-West" },
  ];
  const enabledTps: string[] = [];
  for (const { key, abbr, label } of tpDirs) {
    const enabled = await db.getConfig(server.id, `${key}_use`) ?? "off";
    if (enabled === "on") enabledTps.push(`\`${abbr}\` (${label})`);
  }
  if (enabledTps.length > 0) {
    lines.push(`\n**🗺️ Directional Teleports** — Type the abbreviation in in-game chat: ${enabledTps.join(", ")}`);
  }

  // ---- ZORP ----
  const zorpEnabled = await db.getConfig(server.id, "zorp") ?? "off";
  if (zorpEnabled === "on") {
    let status = "";
    if (ingameName) {
      const zone = await db.getZorpZone(server.id, ingameName).catch(() => null);
      if (zone) status = ` — Your zone is **${zone.status}**`;
      else status = " — No zone created yet";
    }
    lines.push(`\n**🔰 ZORP** — Use the \`Can I build around here?\` emote to create/manage your zone${status}`);
  }

  if (lines.length === 0) {
    await interaction.editReply({ content: `No in-game commands are currently enabled on Server ${server.server_number}.` });
    return;
  }

  const notLinked = !ingameName ? "\n\n> ⚠️ **You are not linked** — cooldowns and list access cannot be checked. Use `/link` to link your account." : "";

  const embed = new EmbedBuilder()
    .setTitle(`🎮 Available In-Game Commands — Server ${server.server_number}`)
    .setDescription(lines.join("\n").substring(0, 4000) + notLinked)
    .setColor(0x5865f2)
    .setFooter({ text: "Emote = use the emote wheel in-game • Type = enter the exact phrase in in-game text chat" });

  await interaction.editReply({ embeds: [embed] });
}
