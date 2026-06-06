import { Client, GatewayIntentBits, Partials } from "discord.js";
import { handleReady } from "./events/ready.js";
import { handleInteractionCreate } from "./events/interactionCreate.js";
import { handleMessageCreate } from "./events/messageCreate.js";
import { handleGuildMemberUpdate } from "./events/guildMemberUpdate.js";
import { initParser } from "./rcon/parser.js";

let client: Client | null = null;

export function startBot(): void {
  const token = process.env["DISCORD_TOKEN"];
  if (!token) {
    console.warn("[Bot] DISCORD_TOKEN not set. Bot will not start.");
    return;
  }

  client = new Client({
    intents: [
      GatewayIntentBits.Guilds,
      GatewayIntentBits.GuildMessages,
      GatewayIntentBits.GuildMembers,
      GatewayIntentBits.MessageContent,
      GatewayIntentBits.DirectMessages,
    ],
    partials: [Partials.Channel, Partials.Message],
  });

  client.once("ready", (c) => {
    initParser(c);
    handleReady(c).catch(err => console.error("[Bot] ready error:", err));
  });

  client.on("interactionCreate", (interaction) => {
    handleInteractionCreate(interaction).catch(err => console.error("[Bot] interaction error:", err));
  });

  client.on("messageCreate", (message) => {
    handleMessageCreate(message).catch(err => console.error("[Bot] messageCreate error:", err));
  });

  client.on("guildMemberUpdate", (oldMember, newMember) => {
    handleGuildMemberUpdate(oldMember, newMember).catch(err => console.error("[Bot] guildMemberUpdate error:", err));
  });

  client.login(token).catch(err => console.error("[Bot] Login failed:", err));
}

export function getClient(): Client | null {
  return client;
}

export { rconManager } from "./rcon/manager.js";
