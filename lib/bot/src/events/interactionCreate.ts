import type { Interaction } from "discord.js";
import { MessageFlags } from "discord.js";
import { commands } from "../commands/registry.js";
import {
  handleAvivButton,
  handleAvivToggle,
  handleAvivEditModal,
  handleAvivEditModalSubmit,
} from "../commands/handlers/setup.js";
import { handleShopInteraction, handleShopModalSubmit } from "../commands/handlers/shop.js";
import { autocompleteServer } from "../commands/handlers/utils.js";

function isShopInteraction(customId: string): boolean {
  return customId === "shop:srv" || customId.startsWith("shop:g");
}

export async function handleInteractionCreate(interaction: Interaction): Promise<void> {
  if (interaction.isAutocomplete()) {
    const focused = interaction.options.getFocused(true);
    if (focused.name === "server") {
      await autocompleteServer(interaction);
      return;
    }
    const cmd = commands.find(c => c.data.name === interaction.commandName);
    if (cmd?.autocomplete) {
      await cmd.autocomplete(interaction);
    }
    return;
  }

  // Aviv settings panel — modal submits
  if (interaction.isModalSubmit()) {
    if (interaction.customId.startsWith("aem:")) {
      await handleAvivEditModalSubmit(interaction).catch(err => {
        console.error("[Bot] Aviv modal submit error:", err);
      });
      return;
    }
    if (interaction.customId.startsWith("shop:g")) {
      await handleShopModalSubmit(interaction).catch(err => {
        console.error("[Bot] Shop modal error:", err);
      });
      return;
    }
    return;
  }

  if (interaction.isButton()) {
    // Aviv settings panel — toggle buttons (at:)
    if (interaction.customId.startsWith("at:")) {
      await handleAvivToggle(interaction).catch(err => {
        console.error("[Bot] Aviv toggle error:", err);
      });
      return;
    }

    // Aviv settings panel — edit modal trigger buttons (ae:)
    if (interaction.customId.startsWith("ae:")) {
      await handleAvivEditModal(interaction).catch(err => {
        console.error("[Bot] Aviv edit modal error:", err);
      });
      return;
    }

    // Aviv settings panel — category + back buttons (aviv_*)
    if (interaction.customId.startsWith("aviv_")) {
      await handleAvivButton(interaction).catch(err => {
        console.error("[Bot] Aviv button error:", err);
      });
      return;
    }

    // Shop buttons
    if (isShopInteraction(interaction.customId)) {
      await handleShopInteraction(interaction).catch(err => {
        console.error("[Bot] Shop interaction error:", err);
      });
      return;
    }
  }

  // Shop select menus
  if (interaction.isStringSelectMenu() && isShopInteraction(interaction.customId)) {
    await handleShopInteraction(interaction).catch(err => {
      console.error("[Bot] Shop interaction error:", err);
    });
    return;
  }

  if (!interaction.isChatInputCommand()) return;

  const cmd = commands.find(c => c.data.name === interaction.commandName);
  if (!cmd) {
    await interaction.reply({ content: "Unknown command.", flags: MessageFlags.Ephemeral }).catch(() => null);
    return;
  }

  try {
    await cmd.execute(interaction);
  } catch (err) {
    if ((err as { code?: number })?.code === 10062) {
      console.warn(`[Bot] /${interaction.commandName} interaction expired (10062) — skipping`);
      return;
    }
    console.error(`[Bot] Command /${interaction.commandName} error:`, err);
    const msg = { content: "An error occurred while executing this command.", flags: MessageFlags.Ephemeral };
    if (interaction.replied || interaction.deferred) {
      await interaction.followUp(msg).catch(() => null);
    } else {
      await interaction.reply(msg).catch(() => null);
    }
  }
}
