import type { Interaction } from "discord.js";
import { commands } from "../commands/registry.js";
import { handleAvivButton } from "../commands/handlers/setup.js";
import { handleShopInteraction } from "../commands/handlers/shop.js";

function isShopInteraction(customId: string): boolean {
  return customId === "shop:srv" || customId.startsWith("shop:s");
}

export async function handleInteractionCreate(interaction: Interaction): Promise<void> {
  if (interaction.isAutocomplete()) {
    const cmd = commands.find(c => c.data.name === interaction.commandName);
    if (cmd?.autocomplete) {
      await cmd.autocomplete(interaction);
    }
    return;
  }

  // Handle /aviv panel category buttons
  if (interaction.isButton() && interaction.customId.startsWith("aviv_")) {
    await handleAvivButton(interaction).catch(err => {
      console.error("[Bot] Aviv button error:", err);
    });
    return;
  }

  // Handle all shop interactions (select menus + buttons)
  if (
    (interaction.isStringSelectMenu() || interaction.isButton()) &&
    isShopInteraction(interaction.customId)
  ) {
    await handleShopInteraction(interaction).catch(err => {
      console.error("[Bot] Shop interaction error:", err);
    });
    return;
  }

  if (!interaction.isChatInputCommand()) return;

  const cmd = commands.find(c => c.data.name === interaction.commandName);
  if (!cmd) {
    await interaction.reply({ content: "Unknown command.", ephemeral: true }).catch(() => null);
    return;
  }

  try {
    await cmd.execute(interaction);
  } catch (err) {
    console.error(`[Bot] Command /${interaction.commandName} error:`, err);
    const msg = { content: "An error occurred while executing this command.", ephemeral: true };
    if (interaction.replied || interaction.deferred) {
      await interaction.followUp(msg).catch(() => null);
    } else {
      await interaction.reply(msg).catch(() => null);
    }
  }
}
