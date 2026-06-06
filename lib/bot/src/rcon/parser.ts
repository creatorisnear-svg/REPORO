import { rconManager } from "./manager.js";
import type { Client as DiscordClient, Guild, TextChannel } from "discord.js";
import * as db from "@workspace/db";
import { getChannel, getConfig, getServersByGuild } from "@workspace/db";

interface ParseContext {
  discordClient: DiscordClient;
  guilds: Guild[];
}

let ctx: ParseContext | null = null;

// Circular buffer of the last 75 raw RCON messages per server for /rcon-log
const RCON_LOG_MAX = 75;
const rconLogBuffer = new Map<number, Array<{ ts: number; type: string; msg: string }>>();

export function getRconLogBuffer(serverId: number): Array<{ ts: number; type: string; msg: string }> {
  return rconLogBuffer.get(serverId) ?? [];
}

function pushRconLog(serverId: number, type: string, msg: string): void {
  if (!rconLogBuffer.has(serverId)) rconLogBuffer.set(serverId, []);
  const buf = rconLogBuffer.get(serverId)!;
  buf.push({ ts: Date.now(), type, msg });
  if (buf.length > RCON_LOG_MAX) buf.shift();
}

// In-memory state for two-step flows
const zorpPending = new Map<string, { step: number; timestamp: number }>();
const tpHomePending = new Map<string, number>(); // ingameName -> timestamp
const eliteKitPending = new Map<string, number>(); // ingameName -> timestamp
const combatLocked = new Map<string, number>(); // ingameName -> unlock timestamp

// Single-step elite kit phrase map (kits 1-22)
const singleStepKits: Record<string, string> = {
  "I Need Metal Fragments": "elitekit",
  "I Need Scrap": "elitekit2",
  "I Need Low Grade Fuel": "elitekit3",
  "I Need Food": "elitekit4",
  "Follow Me": "elitekit5",
  "Help!": "elitekit6",
  "Nice": "elitekit7",
  "Sorry": "elitekit8",
  "Thank You": "elitekit9",
  "You're Welcome": "elitekit10",
  "Good Game": "elitekit11",
  "Watch Out": "elitekit12",
  "Good Luck": "elitekit13",
  "Well Played": "elitekit14",
  "Yes": "elitekit15",
  "No": "elitekit16",
  "Retreat!": "elitekit17",
  "Attack": "elitekit18",
  "Wait": "elitekit19",
  "Go Go Go": "elitekit20",
  "Need Backup": "elitekit21",
  "On My Way": "elitekit22",
};

// Two-step elite kit phrase map (kits 23-44, triggered after "I'm out of ammo")
const twoStepKits: Record<string, string> = {
  "I Need Wood": "elitekit23",
  "I Need Stone": "elitekit24",
  "I Need Scrap": "elitekit25",
  "I Need Metal Fragments": "elitekit26",
  "I Need Low Grade Fuel": "elitekit27",
  "I Need Food": "elitekit28",
  "Follow Me": "elitekit29",
  "Help!": "elitekit30",
  "Nice": "elitekit31",
  "Sorry": "elitekit32",
  "Thank You": "elitekit33",
  "You're Welcome": "elitekit34",
  "Good Game": "elitekit35",
  "Watch Out": "elitekit36",
  "Good Luck": "elitekit37",
  "Well Played": "elitekit38",
  "Yes": "elitekit39",
  "No": "elitekit40",
  "Attack": "elitekit41",
  "Wait": "elitekit42",
  "Go Go Go": "elitekit43",
  "Need Backup": "elitekit44",
};

export function initParser(discordClient: DiscordClient): void {
  ctx = { discordClient, guilds: [] };

  rconManager.onLog(async (rawLog: string, serverId: number, type?: string) => {
    if (!ctx) return;
    pushRconLog(serverId, type ?? "Generic", rawLog);
    await handleLog(rawLog, serverId, type);
  });
}

async function getServerInfo(serverId: number): Promise<db.ServerRow | null> {
  return db.getServerById(serverId);
}

async function postToChannel(serverId: number, channelType: string, content: string): Promise<void> {
  if (!ctx) return;
  const channelId = await getChannel(serverId, channelType);
  if (!channelId) return;
  const server = await getServerInfo(serverId);
  if (!server) return;
  const guild = ctx.discordClient.guilds.cache.get(server.discord_guild_id ?? "");
  if (!guild) return;
  try {
    const channel = await guild.channels.fetch(channelId) as TextChannel | null;
    if (channel && channel.isTextBased()) {
      await channel.send(content);
    }
  } catch { /* channel not accessible */ }
}

// Strip Steam ID suffixes like [76561198xxx/123456] that RCE appends to player names in logs
function stripSteamId(name: string): string {
  return name.replace(/\s*\[[\d]+\/[\d]+\]\s*$/, "").trim();
}

// Attempt to parse a kill event from a raw RCE log line.
// RCE WebRCON sends kills as Generic text — no [KILL] prefix.
// Known RCE formats:
//   PlayerName[sid/uid] was killed by PlayerName[sid/uid] with weapon
//   PlayerName[sid/uid] killed PlayerName[sid/uid] with weapon
//   PlayerName[sid/uid] was killed by Fall Damage   (environmental)
//   PlayerName[sid/uid] committed suicide            (intentional)
function parseKillLine(raw: string): { killer: string; victim: string; weapon: string } | null {
  // RCE Format A: victim was killed by killer with weapon  (most common)
  const fmtA = raw.match(/^(.+?)\s+was killed by\s+(.+?)\s+with\s+(.+)$/i);
  if (fmtA) {
    return {
      victim: stripSteamId(fmtA[1]!),
      killer: stripSteamId(fmtA[2]!),
      weapon: fmtA[3]!.trim(),
    };
  }

  // RCE Format B: victim was killed by killer  (no weapon specified)
  const fmtB = raw.match(/^(.+?)\s+was killed by\s+(.+)$/i);
  if (fmtB) {
    const killer = stripSteamId(fmtB[2]!.trim());
    return {
      victim: stripSteamId(fmtB[1]!),
      killer,
      weapon: killer,
    };
  }

  // RCE Format C: killer killed victim with weapon  (active voice)
  const fmtC = raw.match(/^(.+?)\s+killed\s+(.+?)\s+with\s+(.+)$/i);
  if (fmtC) {
    return {
      killer: stripSteamId(fmtC[1]!),
      victim: stripSteamId(fmtC[2]!),
      weapon: fmtC[3]!.trim(),
    };
  }

  // RCE Format D: victim committed suicide / victim died
  const fmtD = raw.match(/^(.+?)\s+(?:committed suicide|died)\b/i);
  if (fmtD) {
    const name = stripSteamId(fmtD[1]!);
    return { killer: name, victim: name, weapon: "suicide" };
  }

  return null;
}

async function handleLog(raw: string, serverId: number, type?: string): Promise<void> {
  // RCE sends chat as JSON when Type="Chat"
  // Shape: { Channel, Message, UserId, Username, Color, Time }
  if (type === "Chat") {
    try {
      const data = JSON.parse(raw) as Record<string, unknown>;
      const username = String(data["Username"] ?? "").trim();
      // Skip server/admin broadcast messages (UserId=0 or Username="SERVER")
      const userId = Number(data["UserId"] ?? 0);
      if (username && username !== "SERVER" && userId !== 0) {
        // Message field may be JSON-string encoded ("\"hello\"") — unwrap it
        const rawMsg = String(data["Message"] ?? "");
        const message = rawMsg.replace(/^"(.*)"$/s, "$1").replace(/\\"/g, '"').trim();
        await handleChatMessage(serverId, username, message);
      }
    } catch { /* malformed JSON, skip */ }
    return;
  }

  // RCE sends kills as Generic text (Type="Generic" or Type="Kill")
  // Try kill patterns on any message that looks like it could be a kill event
  if (type === "Kill" || raw.match(/\b(?:killed|died|suicide|was killed)\b/i)) {
    const killData = parseKillLine(raw);
    if (killData) {
      await handleKill(serverId, killData.killer, killData.victim, killData.weapon);
      return;
    }
  }

  // Join events — RCE sends "PlayerName[sid/uid] joined [ip:port]" or "PlayerName[sid/uid] entered the game"
  const joinMatch = raw.match(/^(.+?)\s+(?:joined\b|has entered the game)/i);
  if (joinMatch) {
    await handleJoin(serverId, stripSteamId(joinMatch[1]!));
    return;
  }

  // Leave events — RCE sends "PlayerName[sid/uid] disconnecting" or "has left the game"
  const leaveMatch = raw.match(/^(.+?)\s+(?:disconnecting\b|has left the game)/i);
  if (leaveMatch) {
    await handleLeave(serverId, stripSteamId(leaveMatch[1]!));
    return;
  }

  // Raid alerts
  if (raw.includes("FREQUENCY_FIRED:")) {
    const freqMatch = raw.match(/FREQUENCY_FIRED:(\S+)/);
    if (freqMatch) await handleRaidAlert(serverId, freqMatch[1]!);
    return;
  }

  // Note messaging — check both legacy [NOTE] prefix and RCE Generic note format
  const noteMatch = raw.match(/^\[NOTE\]\s+(.+?)\s*:\s*(.+)$/)
    ?? raw.match(/^NOTE:\s+(.+?)\s*:\s*(.+)$/i);
  if (noteMatch) {
    await handleNoteLog(serverId, noteMatch[1]!.trim(), noteMatch[2]!.trim());
    return;
  }
}

async function handleNoteLog(serverId: number, playerName: string, noteText: string): Promise<void> {
  const noteEnabled = await getConfig(serverId, "notemessaging") ?? "off";
  if (noteEnabled !== "on") return;

  const blockList = await getConfig(serverId, "noteblocklist") ?? "";
  if (blockList) {
    const blocked = blockList.split(",").map(s => s.trim().toLowerCase());
    if (blocked.some(b => noteText.toLowerCase().includes(b))) return;
  }

  await postToChannel(serverId, "note-feed", `\u{1F4DD} **${playerName}** wrote a note: *${noteText}*`);
}

const playerKillStreaks = new Map<string, { count: number; lastReset: number }>();
const killAntiAbuseMap = new Map<string, number>();

// NPC entity detection
const SCIENTIST_RE = /scientist/i;
const NPC_RE = /scientist|dweller|bear|wolf|boar|stag|chicken|horse|zombie|bradley|helicopter|patrol|npc/i;

// Environmental / world-kill detection
const WORLD_KILLER_RE = /^(world|fall|environment|hunger|thirst|radiation|cold|hot|bleeding|suicide|drowned?|trap)$/i;
const ENV_WEAPON_RE = /fall|drown|bleed|radiation|cold|heat|hunger|thirst|trap|suicide/i;

function isNpc(name: string): boolean { return NPC_RE.test(name); }
function isScientistName(name: string): boolean { return SCIENTIST_RE.test(name); }

// Random kill phrases for in-game feed
const KILL_PHRASES = [
  "obliterated", "annihilated", "demolished", "decimated", "vaporized",
  "eviscerated", "annihilated", "liquidated", "pulverized", "exterminated",
  "smoked", "clapped", "wrecked", "bodied", "slaughtered",
  "ended", "deleted", "erased", "dropped", "wasted",
  "wiped out", "finished off", "sent to respawn", "put in the dirt", "put down",
  "cooked", "farmed", "styled on", "humiliated", "dunked on",
  "absolutely cooked", "made a fool of", "turned into a corpse",
];

function pickPhrase(custom: string | null | undefined, randomize: boolean): string {
  if (randomize) return KILL_PHRASES[Math.floor(Math.random() * KILL_PHRASES.length)]!;
  return custom ?? "killed";
}

async function sendGameSay(server: db.ServerRow, msg: string): Promise<void> {
  if (!server.rcon_host) return;
  await rconManager.sendFireAndForget(
    server.id, server.rcon_host, server.rcon_port!, server.rcon_password!,
    `global.say "${msg}"`
  ).catch(() => null);
}

const STREAK_LABELS: Record<number, string> = {
  5:  "\u2605 KILLING SPREE \u2605",
  10: "\u2605\u2605 RAMPAGE \u2605\u2605",
  15: "\u2605\u2605\u2605 UNSTOPPABLE \u2605\u2605\u2605",
  20: "\u2620 GODLIKE \u2620",
};

async function handleKill(serverId: number, killer: string, victim: string, weapon: string): Promise<void> {
  // Treat environmental deaths as suicides: fall damage, world kills, etc.
  const isEnvDeath = killer === victim || WORLD_KILLER_RE.test(killer) || (killer === "" && ENV_WEAPON_RE.test(weapon));
  const isSuicide = isEnvDeath;
  const killerIsNpc = !isEnvDeath && isNpc(killer);
  const victimIsNpc = isNpc(victim);
  const killerIsScientist = isScientistName(killer);
  const victimIsScientist = isScientistName(victim);

  const isPlayerVsPlayer   = !killerIsNpc && !victimIsNpc;
  const isPlayerKillsSci   = !killerIsNpc && victimIsScientist;
  const isSciKillsPlayer   = killerIsScientist && !victimIsNpc;
  const isPlayerKillsMisc  = !killerIsNpc && victimIsNpc && !victimIsScientist;
  const isMiscKillsPlayer  = killerIsNpc && !killerIsScientist && !victimIsNpc;

  // Load all configs in one parallel batch
  const [
    discordEnabled, gameEnabled,
    miscKills, sciKillerEnabled, sciVictimEnabled,
    killerColor, phraseColor, victimColor,
    customPhrase, phraseRandomizer,
    combatLockEnabled, combatLockTime,
  ] = await Promise.all([
    getConfig(serverId, "KillFeedDiscord").then(v => v ?? "on"),
    getConfig(serverId, "KillFeedGame").then(v => v ?? "on"),
    getConfig(serverId, "MiscKills").then(v => v ?? "off"),
    getConfig(serverId, "ScientistKiller").then(v => v ?? "off"),
    getConfig(serverId, "ScientistVictim").then(v => v ?? "off"),
    getConfig(serverId, "killercolor").then(v => v ?? "#FF3333"),
    getConfig(serverId, "phrasecolor").then(v => v ?? "#4488FF"),
    getConfig(serverId, "victimcolor").then(v => v ?? "#FF3333"),
    getConfig(serverId, "killphrase"),
    getConfig(serverId, "killphraserandomizer").then(v => v ?? "off"),
    getConfig(serverId, "combatlock_use").then(v => v ?? "off"),
    getConfig(serverId, "combatlock_time").then(v => v ?? "60"),
  ]);

  const randomize = phraseRandomizer === "on";

  // Discord kill feed
  if (discordEnabled === "on") {
    let msg: string | null = null;

    if (isSuicide) {
      msg = `\u{1F480} **${victim}** died to themselves with *${weapon}*`;
    } else if (isPlayerVsPlayer) {
      msg = `\u2694\uFE0F **${killer}** took down **${victim}** with *${weapon}*`;
    } else if (isPlayerKillsSci && sciKillerEnabled === "on") {
      msg = `\u{1F916} **${killer}** eliminated a Scientist with *${weapon}*`;
    } else if (isSciKillsPlayer && sciVictimEnabled === "on") {
      msg = `\u{1F916} **${victim}** was eliminated by a Scientist with *${weapon}*`;
    } else if (isPlayerKillsMisc && miscKills === "on") {
      msg = `\u{1F43A} **${killer}** killed **${victim}** with *${weapon}*`;
    } else if (isMiscKillsPlayer && miscKills === "on") {
      msg = `\u{1F43A} **${victim}** was killed by **${killer}** with *${weapon}*`;
    }

    if (msg) await postToChannel(serverId, "killfeed", msg);
  }

  // In-game kill feed
  if (gameEnabled === "on") {
    const server = await getServerInfo(serverId);
    if (server?.rcon_host) {
      const phrase = pickPhrase(customPhrase, randomize);
      let gameMsg: string | null = null;

      const L = `<color=#CC44FF>\u300A</color>`;
      const R = `<color=#CC44FF>\u300B</color>`;

      if (isSuicide) {
        gameMsg = `${L} <color=${killerColor}>${victim}</color> <color=${phraseColor}>met their own end</color> ${R}`;
      } else if (isPlayerVsPlayer) {
        gameMsg = `${L} <color=${killerColor}>${killer}</color> <color=${phraseColor}>${phrase}</color> <color=${victimColor}>${victim}</color> <color=#CC44FF>[</color><color=#9944CC>${weapon}</color><color=#CC44FF>]</color> ${R}`;
      } else if (isPlayerKillsSci && sciKillerEnabled === "on") {
        gameMsg = `${L} <color=${killerColor}>${killer}</color> <color=${phraseColor}>${phrase}</color> <color=${victimColor}>a Scientist</color> ${R}`;
      } else if (isSciKillsPlayer && sciVictimEnabled === "on") {
        gameMsg = `${L} <color=${victimColor}>${victim}</color> <color=${phraseColor}>was eliminated by</color> <color=${killerColor}>a Scientist</color> ${R}`;
      } else if (isPlayerKillsMisc && miscKills === "on") {
        gameMsg = `${L} <color=${killerColor}>${killer}</color> <color=${phraseColor}>${phrase}</color> <color=${victimColor}>${victim}</color> ${R}`;
      } else if (isMiscKillsPlayer && miscKills === "on") {
        gameMsg = `${L} <color=${victimColor}>${victim}</color> <color=${phraseColor}>was killed by</color> <color=${killerColor}>${killer}</color> ${R}`;
      }

      if (gameMsg) await sendGameSay(server, gameMsg);
    }
  }

  // Scientist economy points (when player kills a scientist)
  if (isPlayerKillsSci && sciKillerEnabled === "on") {
    const sciPtsStr = await getConfig(serverId, "scientist_kill_points") ?? "0";
    const sciPts = parseInt(sciPtsStr, 10) || 0;
    if (sciPts > 0) {
      try {
        await db.ensureEconomy(serverId, killer);
        await db.updateBalance(serverId, killer, sciPts);
      } catch { /* player not linked */ }
    }
  }

  // Only streaks + bounty + economy for true player vs player
  if (isSuicide || !isPlayerVsPlayer) return;

  const abuseKey = `${killer}:${victim}`;
  const lastKill = killAntiAbuseMap.get(abuseKey);
  if (!lastKill || Date.now() - lastKill > 30 * 60 * 1000) {
    killAntiAbuseMap.set(abuseKey, Date.now());
    const killPtsStr = await getConfig(serverId, "player_kill_points") ?? "30";
    const killPts = parseInt(killPtsStr, 10) || 30;
    try {
      await db.ensureEconomy(serverId, killer);
      await db.updateBalance(serverId, killer, killPts);
    } catch { /* player not linked */ }
  }

  // Combat lock — prevent killer from teleporting after a kill
  if (combatLockEnabled === "on") {
    const secs = parseInt(combatLockTime, 10) || 60;
    setCombatLock(serverId, killer, secs);
  }

  const streak = playerKillStreaks.get(`${serverId}:${killer}`) ?? { count: 0, lastReset: Date.now() };
  streak.count++;
  playerKillStreaks.set(`${serverId}:${killer}`, streak);

  if ([5, 10, 15, 20].includes(streak.count)) {
    await postToChannel(serverId, "killfeed", `\u{1F525} **${killer}** is on a **${streak.count} kill streak!**`);

    if (gameEnabled === "on") {
      const server = await getServerInfo(serverId);
      if (server?.rcon_host) {
        const label = STREAK_LABELS[streak.count] ?? `${streak.count} KILL STREAK`;
        const streakMsg = `<color=#CC44FF>\u300A</color> <color=#FF3333>${killer}</color> <color=#4488FF>${label}</color> <color=#CC44FF>\u300B</color>`;
        await sendGameSay(server, streakMsg);
      }
    }
  }

  const bountyEnabled = await getConfig(serverId, "BountySystem") ?? "off";
  if (bountyEnabled === "on") {
    await handleBountyKill(serverId, killer, victim, gameEnabled);
  }
}

async function handleBountyKill(serverId: number, killer: string, victim: string, gameEnabled = "off"): Promise<void> {
  const bounty = await db.getBounty(serverId, victim);
  if (bounty) {
    const rewardStr = await getConfig(serverId, "BountyReward") ?? "100";
    const baseReward = parseInt(rewardStr, 10) || 100;
    const scaleStr = await getConfig(serverId, "BountyScale") ?? "0.1";
    const scale = parseFloat(scaleStr) || 0.1;
    const reward = Math.floor(baseReward * (1 + bounty.kill_count * scale));
    await db.ensureEconomy(serverId, killer);
    await db.updateBalance(serverId, killer, reward);
    await db.deactivateBounty(serverId, victim);
    await postToChannel(serverId, "killfeed", `\u{1F3AF} **${killer}** collected the bounty on **${victim}** and earned ${reward} coins!`);

    if (gameEnabled === "on") {
      const server = await getServerInfo(serverId);
      if (server?.rcon_host) {
        const bountyMsg = `<color=#CC44FF>\u25C6 BOUNTY CLAIMED \u25C6</color> <color=#FF3333>${killer}</color> <color=#4488FF>hunted down</color> <color=#FF3333>${victim}</color> <color=#CC44FF>+${reward} coins</color>`;
        await sendGameSay(server, bountyMsg);
      }
    }
  }

  const minKillsStr = await getConfig(serverId, "BountyMinKills") ?? "5";
  const minKills = parseInt(minKillsStr, 10) || 5;
  const killerBounty = await db.getBounty(serverId, killer);
  const newCount = (killerBounty?.kill_count ?? 0) + 1;
  if (newCount >= minKills) {
    const rewardStr = await getConfig(serverId, "BountyReward") ?? "100";
    const baseReward = parseInt(rewardStr, 10) || 100;
    await db.upsertBounty(serverId, killer, newCount, baseReward);
    await db.setConfig(serverId, `bounty_placed_at_${killer}`, new Date().toISOString()).catch(() => null);
  }
}

async function handleJoin(serverId: number, playerName: string): Promise<void> {
  await postToChannel(serverId, "player-feed", `\u{1F7E2} **${playerName}** joined the server`);

  const isPris = await db.isPrisoner(serverId, playerName);
  if (isPris) {
    const server = await getServerInfo(serverId);
    if (server?.rcon_host) {
      const prisonPos = await db.getTpPositions(serverId, "prison");
      if (prisonPos.length > 0) {
        const pos = prisonPos[0];
        try {
          await rconManager.sendFireAndForget(serverId, server.rcon_host, server.rcon_port!, server.rcon_password!, `global.teleportpos ${pos.x},${pos.y},${pos.z} "${playerName}"`);
        } catch { /* rcon may not be connected */ }
      }
    }
  }
}

async function handleLeave(serverId: number, playerName: string): Promise<void> {
  await postToChannel(serverId, "player-feed", `\u{1F534} **${playerName}** left the server`);
}

async function handleRaidAlert(serverId: number, frequency: string): Promise<void> {
  const link = await db.getRaidLinkByFrequency(serverId, frequency);
  if (!link) return;
  const channelId = await getChannel(serverId, "raid-alerts");
  if (!channelId) return;
  const server = await getServerInfo(serverId);
  if (!server) return;
  const guild = ctx?.discordClient.guilds.cache.get(server.discord_guild_id ?? "");
  if (!guild) return;
  try {
    const channel = await guild.channels.fetch(channelId) as TextChannel | null;
    if (channel && channel.isTextBased()) {
      await channel.send(`\u{1F6A8} <@${link.discord_user_id}> your base (frequency **${frequency}**) is under attack!`);
    }
  } catch { /* channel not found */ }
}

async function handleChatMessage(serverId: number, playerName: string, message: string): Promise<void> {
  const msg = message.trim();

  const bridgeEnabled = await getConfig(serverId, "chatbridge") ?? "off";
  if (bridgeEnabled === "on") {
    await postToChannel(serverId, "chat", `\u{1F3AE} **${playerName}**: ${msg}`);
  }

  // ZORP flow - must check before single-step kits that share phrases
  if (msg === "Can I build around here?") {
    const existing = await db.getZorpZone(serverId, playerName);
    const key = `${serverId}:${playerName}`;
    zorpPending.set(key, { step: existing ? 2 : 1, timestamp: Date.now() });
    return;
  }

  const zorpKey = `${serverId}:${playerName}`;
  const zorpState = zorpPending.get(zorpKey);
  if (zorpState && Date.now() - zorpState.timestamp < 30_000) {
    if (msg === "Yes") {
      const zorpEnabled = await getConfig(serverId, "zorp") ?? "off";
      if (zorpEnabled === "on") {
        await handleZorpCreate(serverId, playerName);
        zorpPending.delete(zorpKey);
        return;
      }
    }
    if (msg === "Goodbye") {
      await handleZorpDelete(serverId, playerName);
      zorpPending.delete(zorpKey);
      return;
    }
  }

  // TP HOME set trigger
  if (msg === "Can I have a key?") {
    const tpHomeEnabled = await getConfig(serverId, "TPHOME_use") ?? "off";
    if (tpHomeEnabled === "on") {
      const server = await getServerInfo(serverId);
      if (server?.rcon_host) {
        await rconManager.sendFireAndForget(serverId, server.rcon_host, server.rcon_port!, server.rcon_password!, `global.killplayer "${playerName}"`).catch(() => null);
        await db.setTpHomePending(serverId, playerName);
        tpHomePending.set(`${serverId}:${playerName}`, Date.now());
      }
      return;
    }
  }

  // TP HOME confirm (after respawn)
  const tpHomeKey = `${serverId}:${playerName}`;
  if (tpHomePending.has(tpHomeKey) && Date.now() - tpHomePending.get(tpHomeKey)! < 120_000) {
    await db.confirmTpHome(serverId, playerName);
    tpHomePending.delete(tpHomeKey);
  }

  // TP HOME: Retreat! - check before kit (only if NOT in ZORP pending)
  if (msg === "Retreat!" && !zorpState) {
    await handleTpHome(serverId, playerName);
    return;
  }

  // Free kit
  if (msg === "I need wood") {
    await handleKit(serverId, playerName, "freekit");
    return;
  }

  // VIP kit
  if (msg === "I need stone") {
    await handleKit(serverId, playerName, "vipkit");
    return;
  }

  // Two-step elite kit prefix
  if (msg === "I'm out of ammo") {
    eliteKitPending.set(`${serverId}:${playerName}`, Date.now());
    return;
  }

  // Two-step elite kit second message (kits 23-44)
  const eliteKey = `${serverId}:${playerName}`;
  if (eliteKitPending.has(eliteKey) && Date.now() - eliteKitPending.get(eliteKey)! < 30_000) {
    const twoStepKit = twoStepKits[msg];
    if (twoStepKit) {
      eliteKitPending.delete(eliteKey);
      await handleKit(serverId, playerName, twoStepKit);
      return;
    }
    // Message did not match any two-step kit phrase — clear pending state
    eliteKitPending.delete(eliteKey);
  }

  // Single-step elite kits (1-22)
  const singleKit = singleStepKits[msg];
  if (singleKit) {
    const inZorpFlow = zorpState && Date.now() - zorpState.timestamp < 30_000;
    const inTpHomeFlow = tpHomePending.has(`${serverId}:${playerName}`) &&
      Date.now() - tpHomePending.get(`${serverId}:${playerName}`)! < 120_000;
    const inEliteKitFlow = eliteKitPending.has(`${serverId}:${playerName}`) &&
      Date.now() - eliteKitPending.get(`${serverId}:${playerName}`)! < 30_000;

    // "Yes" conflicts with ZORP flow
    if (msg === "Yes" && inZorpFlow) return;

    // "Retreat!" conflicts with TPHOME flow
    if (msg === "Retreat!" && inTpHomeFlow) return;

    // If player is in two-step elite kit pending, skip single-step handling
    if (inEliteKitFlow) return;

    await handleKit(serverId, playerName, singleKit);
    return;
  }

  // Recycler
  if (msg === "Repair This") {
    await handleRecycler(serverId, playerName);
    return;
  }

  // Directional teleports
  const tpMap: Record<string, string> = {
    "N": "TPN", "NE": "TPNE", "E": "TPE", "SE": "TPSE",
    "S": "TPS", "SW": "TPSW", "W": "TPW", "NW": "TPNW"
  };
  if (tpMap[msg]) {
    await handleDirectionalTp(serverId, playerName, tpMap[msg]);
    return;
  }
}

async function handleZorpCreate(serverId: number, playerName: string): Promise<void> {
  const zorpEnabled = await getConfig(serverId, "zorp") ?? "off";
  if (zorpEnabled !== "on") return;

  const server = await getServerInfo(serverId);
  if (!server?.rcon_host) return;

  const zoneId = `zone_${playerName}_${Date.now()}`;
  const teamId = `team_${playerName}`;

  try {
    await rconManager.sendFireAndForget(serverId, server.rcon_host, server.rcon_port!, server.rcon_password!,
      `o.zorp create "${playerName}"`);
  } catch { /* ignore */ }

  const existing = await db.getZorpZone(serverId, playerName);
  await db.upsertZorpZone(serverId, playerName, teamId, zoneId);
  if (existing) {
    await postToChannel(serverId, "player-feed", `\u{1F504} **${playerName}**'s ZORP zone has been refreshed`);
  } else {
    await postToChannel(serverId, "player-feed", `\u{1F7E2} **${playerName}** created a ZORP zone`);
  }
}

async function handleZorpDelete(serverId: number, playerName: string): Promise<void> {
  const server = await getServerInfo(serverId);
  if (!server?.rcon_host) return;

  try {
    await rconManager.sendFireAndForget(serverId, server.rcon_host, server.rcon_port!, server.rcon_password!,
      `o.zorp delete "${playerName}"`);
  } catch { /* ignore */ }

  await db.deleteZorpZone(serverId, playerName);
  await postToChannel(serverId, "player-feed", `\u{1F534} **${playerName}** deleted their ZORP zone`);
}

async function handleTpHome(serverId: number, playerName: string): Promise<void> {
  const home = await db.getTpHome(serverId, playerName);
  if (!home || !home.home_set) return;

  const server = await getServerInfo(serverId);
  if (!server?.rcon_host) return;

  try {
    await rconManager.sendFireAndForget(serverId, server.rcon_host, server.rcon_port!, server.rcon_password!,
      `global.teleport2bed "${playerName}"`);
  } catch { /* ignore */ }
}

async function handleKit(serverId: number, playerName: string, kitType: string): Promise<void> {
  // Map elitekit (first elite) config keys correctly
  // elitekit -> uses keys elitekit_use, elitekit_time, elitekit_name, list elitelist1
  // elitekit2 -> uses keys elitekit2_use, elitekit2_time, etc., list elitelist2
  const enabledKey = `${kitType}_use`;
  const enabled = await getConfig(serverId, enabledKey) ?? "off";
  if (enabled !== "on") return;

  const timeKey = `${kitType}_time`;
  const kitNameKey = `${kitType}_name`;
  const kitName = await getConfig(serverId, kitNameKey) ?? kitType;
  const cooldownHours = parseFloat(await getConfig(serverId, timeKey) ?? "24");

  // Determine list name for uselist check
  const useListKey = `${kitType}_uselist`;
  const uselist = await getConfig(serverId, useListKey) ?? "off";
  if (uselist === "on") {
    // elitekit -> elitelist1, elitekit2 -> elitelist2, vipkit -> viplist, etc.
    let listName: string;
    if (kitType === "elitekit") {
      listName = "elitelist1";
    } else if (kitType.startsWith("elitekit")) {
      const num = kitType.replace("elitekit", "");
      listName = `elitelist${num}`;
    } else if (kitType === "vipkit") {
      listName = "viplist";
    } else {
      listName = `${kitType}list`;
    }
    const onList = await db.isOnList(serverId, listName, playerName);
    if (!onList) return;
  }

  const lastClaim = await db.getLastKitClaim(serverId, playerName, kitType);
  if (lastClaim) {
    const cooldownMs = cooldownHours * 3600 * 1000;
    const last = new Date(lastClaim.last_claimed).getTime();
    if (Date.now() - last < cooldownMs) return;
  }

  const server = await getServerInfo(serverId);
  if (!server?.rcon_host) return;

  try {
    await rconManager.sendFireAndForget(serverId, server.rcon_host, server.rcon_port!, server.rcon_password!,
      `kit givetoplayer "${kitName}" "${playerName}"`);
    await db.recordKitClaim(serverId, playerName, kitType);
  } catch (err) {
    await postToChannel(serverId, "errors", `Kit error for **${playerName}** (${kitType}): ${String(err)}`);
  }
}

async function handleRecycler(serverId: number, playerName: string): Promise<void> {
  const enabled = await getConfig(serverId, "recyclers_use") ?? "off";
  if (enabled !== "on") return;

  const uselist = await getConfig(serverId, "recyclers_uselist") ?? "off";
  if (uselist === "on") {
    const onList = await db.isOnList(serverId, "recyclerlist", playerName);
    if (!onList) return;
  }

  const cooldownStr = await getConfig(serverId, "recyclers_time") ?? "24";
  const cooldownHours = parseFloat(cooldownStr);
  const lastClaim = await db.getLastKitClaim(serverId, playerName, "recycler");
  if (lastClaim) {
    const cooldownMs = cooldownHours * 3600 * 1000;
    const last = new Date(lastClaim.last_claimed).getTime();
    if (Date.now() - last < cooldownMs) return;
  }

  const server = await getServerInfo(serverId);
  if (!server?.rcon_host) return;

  try {
    await rconManager.sendFireAndForget(serverId, server.rcon_host, server.rcon_port!, server.rcon_password!,
      `spawnrecycler "${playerName}"`);
    await db.recordKitClaim(serverId, playerName, "recycler");
  } catch { /* ignore */ }
}

async function handleDirectionalTp(serverId: number, playerName: string, tpConfig: string): Promise<void> {
  const enabled = await getConfig(serverId, `${tpConfig}_use`) ?? "off";
  if (enabled !== "on") return;

  const uselist = await getConfig(serverId, `${tpConfig}_uselist`) ?? "off";
  if (uselist === "on") {
    const onList = await db.isOnList(serverId, `${tpConfig.toLowerCase()}list`, playerName);
    if (!onList) return;
  }

  const combatEnabled = await getConfig(serverId, "combatlock_use") ?? "off";
  if (combatEnabled === "on") {
    const lockedUntil = combatLocked.get(`${serverId}:${playerName}`);
    if (lockedUntil && Date.now() < lockedUntil) return;
  }

  const positions = await db.getTpPositions(serverId, tpConfig);
  if (positions.length === 0) return;

  const pos = positions[Math.floor(Math.random() * positions.length)];
  const server = await getServerInfo(serverId);
  if (!server?.rcon_host) return;

  const killFirst = await getConfig(serverId, `${tpConfig}_kill`) ?? "off";
  try {
    if (killFirst === "on") {
      await rconManager.sendFireAndForget(serverId, server.rcon_host, server.rcon_port!, server.rcon_password!, `global.killplayer "${playerName}"`);
      await new Promise(r => setTimeout(r, 2000));
    }
    await rconManager.sendFireAndForget(serverId, server.rcon_host, server.rcon_port!, server.rcon_password!,
      `global.teleportpos ${pos.x},${pos.y},${pos.z} "${playerName}"`);

    const giveKit = await getConfig(serverId, `${tpConfig}_usekit`) ?? "off";
    if (giveKit === "on") {
      const kitName = await getConfig(serverId, `${tpConfig}_kitname`) ?? "";
      if (kitName) {
        await rconManager.sendFireAndForget(serverId, server.rcon_host, server.rcon_port!, server.rcon_password!, `kit givetoplayer "${kitName}" "${playerName}"`);
      }
    }
  } catch { /* ignore */ }
}

export function setCombatLock(serverId: number, playerName: string, seconds: number): void {
  combatLocked.set(`${serverId}:${playerName}`, Date.now() + seconds * 1000);
}
