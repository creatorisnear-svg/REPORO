import type { Client } from "discord.js";
import { REST, Routes } from "discord.js";
import { commands } from "../commands/registry.js";
import { startScheduler } from "../features/scheduler.js";
import { updatePlayerCountChannels } from "../features/playercount.js";

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

  startScheduler(client);

  setInterval(() => {
    updatePlayerCountChannels(client).catch(e => console.error("[PlayerCount]", e));
  }, 5 * 60_000);
}
