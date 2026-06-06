import type { Client } from "discord.js";
import { REST, Routes } from "discord.js";
import { commands } from "../commands/registry.js";
import { startScheduler } from "../features/scheduler.js";
import { updatePlayerCountChannels } from "../features/playercount.js";
import { runZorpExpiryCheck } from "../features/zorp.js";
import { runPrisonReleaseCheck, runPrisonKeepCheck } from "../features/prison.js";
import { getAllServers } from "@workspace/db";
import { rconManager } from "../rcon/manager.js";

export async function handleReady(client: Client<true>): Promise<void> {
  console.info(`[Bot] Logged in as ${client.user.tag}`);

  const token = process.env["DISCORD_TOKEN"];
  const clientId = process.env["DISCORD_CLIENT_ID"];

  if (!token || !clientId) {
    console.warn("[Bot] DISCORD_TOKEN or DISCORD_CLIENT_ID not set. Skipping command registration.");
    return;
  }

  const rest = new REST().setToken(token);
  const commandData = commands.map(c => c.data.toJSON());

  try {
    await rest.put(Routes.applicationCommands(clientId), { body: commandData });
    console.info(`[Bot] Registered ${commandData.length} slash commands globally.`);
  } catch (err) {
    console.error("[Bot] Failed to register commands:", err);
  }

  // Auto-connect to all configured RCON servers on startup
  try {
    const servers = await getAllServers();
    const rconServers = servers.filter(s => s.rcon_host && s.rcon_port && s.rcon_password);
    console.info(`[RCON] Auto-connecting to ${rconServers.length} server(s)...`);
    for (const server of rconServers) {
      rconManager.connect(server.id, server.rcon_host!, server.rcon_port!, server.rcon_password!)
        .then(() => console.info(`[RCON] Connected to Server ${server.server_number}: ${server.server_label}`))
        .catch(err => console.warn(`[RCON] Server ${server.server_number} (${server.server_label}) failed: ${(err as Error).message}`));
    }
  } catch (err) {
    console.error("[RCON] Failed to load servers for auto-connect:", err);
  }

  // Start scheduled message loop
  startScheduler(client);

  // Player count voice channel - every 2 minutes
  setInterval(() => {
    updatePlayerCountChannels(client).catch(e => console.error("[PlayerCount]", e));
  }, 2 * 60_000);

  // ZORP expiry check - every 5 minutes
  setInterval(() => {
    runZorpExpiryCheck(client).catch(e => console.error("[ZORP]", e));
  }, 5 * 60_000);

  // Prison auto-release - every 1 minute
  setInterval(() => {
    runPrisonReleaseCheck(client).catch(e => console.error("[Prison]", e));
  }, 60_000);

  // Prison keep-sending-back - every 30 seconds
  setInterval(() => {
    runPrisonKeepCheck(client).catch(e => console.error("[PrisonKeep]", e));
  }, 30_000);

  // Run initial checks
  runZorpExpiryCheck(client).catch(() => null);
  runPrisonReleaseCheck(client).catch(() => null);
  updatePlayerCountChannels(client).catch(() => null);
}
