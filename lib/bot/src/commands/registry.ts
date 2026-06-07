import {
  SlashCommandBuilder,
  type SlashCommandOptionsOnlyBuilder,
  type ChatInputCommandInteraction,
  type AutocompleteInteraction,
} from "discord.js";

export interface Command {
  data: SlashCommandBuilder | SlashCommandOptionsOnlyBuilder | Omit<SlashCommandBuilder, "addSubcommand" | "addSubcommandGroup">;
  execute: (interaction: ChatInputCommandInteraction) => Promise<void>;
  autocomplete?: (interaction: AutocompleteInteraction) => Promise<void>;
}

// All config keys for /set autocomplete
export const ALL_CONFIG_KEYS = [
  "freekit_use","freekit_time","freekit_name",
  "vipkit_use","vipkit_time","vipkit_name",
  "elitekit_use","elitekit_time",
  "recyclers_use","recyclers_time","recyclers_uselist",
  "currency_name","player_kill_points","scientist_kill_points",
  "daily_min","daily_max",
  "zorp","zorptime","zorpExpiryTime","zorpallowlist","zorpMinDistance",
  "chatbridge",
  "KillFeedGame","KillFeedDiscord","KillFeedKD","MiscKills",
  "AdminLogs","InGameLogs","DiscordLogs",
  "ScientistKiller","ScientistVictim",
  "killercolor","phrasecolor","victimcolor","killphrase","killphraserandomizer",
  "raidalerts",
  "SRP","srp-time-monday","srp-time-tuesday","srp-time-wednesday",
  "srp-time-thursday","srp-time-friday","srp-time-saturday","srp-time-sunday",
  "BountySystem","BountyReward","BountyScale","BountyDuration","BountyMaxTargets","BountyMinKills","BountyUnique",
  "combatlock_use","combatlock_time",
  "scheduler","scheduler-time",
  "notemessaging","noteblocklist",
  "prisonsystem",
  "prison-location",
  "event1_use","event1_type","event1_interval","event1_msg1","event1_msg2","event1_msg3",
  "event2_use","event2_type","event2_interval","event2_msg1","event2_msg2","event2_msg3",
  "event3_use","event3_type","event3_interval","event3_msg1","event3_msg2","event3_msg3",
  "TPN_use","TPN_name","TPN_time","TPN_uselist","TPN_usedelay","TPN_delaytime","TPN_usekit","TPN_kitname","TPN_kill",
  "TPNE_use","TPNE_name","TPNE_time","TPNE_uselist","TPNE_usedelay","TPNE_delaytime","TPNE_usekit","TPNE_kitname","TPNE_kill",
  "TPE_use","TPE_name","TPE_time","TPE_uselist","TPE_usedelay","TPE_delaytime","TPE_usekit","TPE_kitname","TPE_kill",
  "TPSE_use","TPSE_name","TPSE_time","TPSE_uselist","TPSE_usedelay","TPSE_delaytime","TPSE_usekit","TPSE_kitname","TPSE_kill",
  "TPS_use","TPS_name","TPS_time","TPS_uselist","TPS_usedelay","TPS_delaytime","TPS_usekit","TPS_kitname","TPS_kill",
  "TPSW_use","TPSW_name","TPSW_time","TPSW_uselist","TPSW_usedelay","TPSW_delaytime","TPSW_usekit","TPSW_kitname","TPSW_kill",
  "TPW_use","TPW_name","TPW_time","TPW_uselist","TPW_usedelay","TPW_delaytime","TPW_usekit","TPW_kitname","TPW_kill",
  "TPNW_use","TPNW_name","TPNW_time","TPNW_uselist","TPNW_usedelay","TPNW_delaytime","TPNW_usekit","TPNW_kitname","TPNW_kill",
  "TPHOME_use","TPHOME_time",
];

import { handleSetup, handleAddServer, handleRemoveServer, handleDiag, handleAviv } from "./handlers/setup.js";
import { handleLink, handleUnlink, handleAdminLink, handleWhois, handleSyncMe, handleSyncTarget, handleGetPlayerinfo } from "./handlers/linking.js";
import { handleAddToList, handleRemoveFromList, handleGetList, handleAddVip, handleRemoveVip } from "./handlers/lists.js";
import { handleGivekit, handleRefreshKits, autocompleteGivekit } from "./handlers/kits.js";
import { handleBalance, handleDaily, handleTransfer, handleSwap, handleLeaderboard, handleSetdailyscale, handleKillpoints, handleAddPointsPlayer, handleSubPointsPlayer, handleAddPointsServer, handleSubPointsServer, handleWipeEconomy } from "./handlers/economy.js";
import { handleSpin, handleCoinflip, handleBlackjack, handleMaxbet, handleRoshambo } from "./handlers/gambling.js";
import { handleShop, handleAdminShopCreateShop, handleAdminShopDeleteShop, handleAdminShopAddCategory, handleAdminShopAddSubcategory, handleAdminShopAddItem, handleAdminShopAddKit, handleAdminShopEditProduct, handleAdminShopRemoveProduct, handleDelayshop, handleOpenshop, autocompleteShopAdmin } from "./handlers/shop.js";
import { handleKick, handleBan, handleUnban, handleMute, handleUnmute, handleWarn, handleWarnings, handleClearwarnings, handleTempBan, handleGive, handlePlaying, handleGetBan } from "./handlers/moderation.js";
import { handlePrison, handleUnprison, handlePrisonList } from "./handlers/prison.js";
import { handleWipeZorp, handleDelZorp } from "./handlers/zorp.js";
import { handleRaidlink, handleListRaidlink, handleListRaidalert, handleWipeRaidlink, handleDelRaidlink } from "./handlers/raidalerts.js";
import { handleAdminChannels, handleAdminPositions, handleAdminScheduler } from "./handlers/channels.js";
import { handleWipeClaims, handleWipeKills, handleWipeTpHome, handleWipeShopTimers, handleWipePositions, handleClearList, handleBanboom, handleUnbanboom, handleTimedrestart, handleDelayClaims, handleTriggerEvent, handleClearAnEvent, handleSetLeaderboard, handleWipeBank } from "./handlers/admin-wipe.js";
import { handleStats, handleProfile, handleTopkillers, handleScratch } from "./handlers/player.js";
import { handleSet, autocompleteSet, handleConfigs } from "./handlers/configs.js";
import { handleRconLog } from "./handlers/rconlog.js";
import { handleTestKillfeed } from "./handlers/testkillfeed.js";
import { handleBank } from "./handlers/bank.js";
import { handleActions } from "./handlers/actions.js";
import { handleClan } from "./handlers/clan.js";

function serverOption(cmd: SlashCommandBuilder) {
  return cmd.addIntegerOption(o =>
    o.setName("server").setDescription("Server number — type to search by name or number").setRequired(false).setAutocomplete(true)
  );
}

export const commands: Command[] = [
  // Setup & core
  {
    data: new SlashCommandBuilder().setName("setup").setDescription("Create roles, channels, and configure Aviv Bot for this server"),
    execute: handleSetup,
  },
  {
    data: serverOption(new SlashCommandBuilder().setName("add-server").setDescription("Add a Rust server RCON connection")
      .addStringOption(o => o.setName("host").setDescription("RCON host/IP").setRequired(true))
      .addIntegerOption(o => o.setName("port").setDescription("RCON port").setRequired(true))
      .addStringOption(o => o.setName("password").setDescription("RCON password").setRequired(true))
      .addStringOption(o => o.setName("label").setDescription("Server label").setRequired(false)) as SlashCommandBuilder),
    execute: handleAddServer,
  },
  {
    data: serverOption(new SlashCommandBuilder().setName("remove-server").setDescription("Remove a Rust server connection") as SlashCommandBuilder),
    execute: handleRemoveServer,
  },
  {
    data: serverOption(new SlashCommandBuilder().setName("configs").setDescription("View all settings for this server") as SlashCommandBuilder),
    execute: handleConfigs,
  },
  {
    data: serverOption(new SlashCommandBuilder().setName("set").setDescription("Change a bot setting")
      .addStringOption(o => o.setName("config").setDescription("Config key").setRequired(true).setAutocomplete(true))
      .addStringOption(o => o.setName("value").setDescription("New value").setRequired(true)) as SlashCommandBuilder),
    execute: handleSet,
    autocomplete: autocompleteSet,
  },
  {
    data: new SlashCommandBuilder().setName("aviv").setDescription("Open the Aviv Bot settings panel"),
    execute: handleAviv,
  },
  {
    data: new SlashCommandBuilder().setName("diag").setDescription("Diagnostics: RCON health, ping, and status"),
    execute: handleDiag,
  },
  {
    data: serverOption(new SlashCommandBuilder().setName("test-killfeed").setDescription("Fire a fake kill event to test killfeed output (admin only)")
      .addStringOption(o => o.setName("type").setDescription("Type of kill to simulate").setRequired(false)
        .addChoices(
          { name: "PvP (player kills player)", value: "pvp" },
          { name: "Fall damage / environmental", value: "fall" },
          { name: "Suicide", value: "suicide" },
          { name: "Scientist kills player", value: "scientist" },
        ))
      .addStringOption(o => o.setName("killer").setDescription("Killer name (for PvP)").setRequired(false))
      .addStringOption(o => o.setName("victim").setDescription("Victim name").setRequired(false))
      .addStringOption(o => o.setName("weapon").setDescription("Weapon name").setRequired(false)) as SlashCommandBuilder),
    execute: handleTestKillfeed,
  },
  {
    data: serverOption(new SlashCommandBuilder().setName("rcon-log").setDescription("View the last raw RCON messages received from the server (admin only)")
      .addIntegerOption(o => o.setName("count").setDescription("Number of entries to show (max 50, default 30)").setRequired(false).setMinValue(1).setMaxValue(50))
      .addStringOption(o => o.setName("filter").setDescription("Filter by message type").setRequired(false)
        .addChoices(
          { name: "Kill events", value: "Kill" },
          { name: "Chat messages", value: "Chat" },
          { name: "Generic / console", value: "Generic" },
          { name: "Errors", value: "Error" },
          { name: "Warnings", value: "Warning" },
        )) as SlashCommandBuilder),
    execute: handleRconLog,
  },
  {
    data: new SlashCommandBuilder().setName("admin-channels").setDescription("Reassign Discord channel feeds")
      .addStringOption(o => o.setName("feed").setDescription("Feed type").setRequired(true)
        .addChoices(
          { name: "Kill Feed", value: "killfeed" },
          { name: "Player Feed", value: "player-feed" },
          { name: "Chat", value: "chat" },
          { name: "Raid Alerts", value: "raid-alerts" },
          { name: "Errors", value: "errors" },
          { name: "Logs", value: "logs" },
          { name: "Events", value: "events" },
          { name: "Announcements", value: "announcements" },
          { name: "Cmd Logs", value: "cmd-logs" },
          { name: "Player Count (voice)", value: "player-count" },
          { name: "Note Feed (in-game notes)", value: "note-feed" },
          { name: "Transactions (Tip4Serv)", value: "transactions" },
          { name: "Chat Bridge (relay)", value: "chatbridge" },
        ))
      .addChannelOption(o => o.setName("channel").setDescription("Channel to assign").setRequired(true)),
    execute: handleAdminChannels,
  },
  {
    data: serverOption(new SlashCommandBuilder().setName("admin-positions").setDescription("View/add/remove teleport positions")
      .addStringOption(o => o.setName("action").setDescription("Action").setRequired(true).addChoices(
        { name: "list", value: "list" },
        { name: "add", value: "add" },
        { name: "remove", value: "remove" }
      ))
      .addStringOption(o => o.setName("type").setDescription("Position type (TPN, TPS, prison, etc.)").setRequired(false))
      .addNumberOption(o => o.setName("x").setDescription("X coordinate").setRequired(false))
      .addNumberOption(o => o.setName("y").setDescription("Y coordinate").setRequired(false))
      .addNumberOption(o => o.setName("z").setDescription("Z coordinate").setRequired(false))
      .addIntegerOption(o => o.setName("id").setDescription("Position ID to remove").setRequired(false)) as SlashCommandBuilder),
    execute: handleAdminPositions,
  },
  {
    data: serverOption(new SlashCommandBuilder().setName("admin-scheduler").setDescription("View/add/remove scheduled messages")
      .addStringOption(o => o.setName("action").setDescription("Action").setRequired(true).addChoices(
        { name: "list", value: "list" },
        { name: "add", value: "add" },
        { name: "remove", value: "remove" }
      ))
      .addStringOption(o => o.setName("message").setDescription("Message to schedule").setRequired(false))
      .addIntegerOption(o => o.setName("interval").setDescription("Interval in minutes").setRequired(false))
      .addIntegerOption(o => o.setName("id").setDescription("Message ID to remove").setRequired(false)) as SlashCommandBuilder),
    execute: handleAdminScheduler,
  },
  // Linking
  {
    data: new SlashCommandBuilder().setName("link").setDescription("Link your Discord account to your in-game name across all servers")
      .addStringOption(o => o.setName("ingame_name").setDescription("Your Rust in-game name").setRequired(true)) as SlashCommandBuilder,
    execute: handleLink,
  },
  {
    data: new SlashCommandBuilder().setName("unlink").setDescription("Remove your Discord-to-game link from all servers"),
    execute: handleUnlink,
  },
  {
    data: serverOption(new SlashCommandBuilder().setName("admin-link").setDescription("Manually link a player (admin)")
      .addStringOption(o => o.setName("ingame_name").setDescription("In-game name").setRequired(true))
      .addUserOption(o => o.setName("discord_user").setDescription("Discord user").setRequired(true)) as SlashCommandBuilder),
    execute: handleAdminLink,
  },
  {
    data: new SlashCommandBuilder().setName("whois").setDescription("Look up who is linked to what")
      .addUserOption(o => o.setName("discord_user").setDescription("Discord user").setRequired(false))
      .addStringOption(o => o.setName("ingame_name").setDescription("In-game name").setRequired(false)),
    execute: handleWhois,
  },
  {
    data: serverOption(new SlashCommandBuilder().setName("sync-me").setDescription("Sync your own roles") as SlashCommandBuilder),
    execute: handleSyncMe,
  },
  {
    data: serverOption(new SlashCommandBuilder().setName("sync-target").setDescription("Sync another player's roles (admin)")
      .addUserOption(o => o.setName("player").setDescription("Discord user").setRequired(true)) as SlashCommandBuilder),
    execute: handleSyncTarget,
  },
  {
    data: serverOption(new SlashCommandBuilder().setName("get-playerinfo").setDescription("View player info and lists")
      .addStringOption(o => o.setName("ingame_name").setDescription("In-game name").setRequired(true)) as SlashCommandBuilder),
    execute: handleGetPlayerinfo,
  },
  // Lists
  {
    data: serverOption(new SlashCommandBuilder().setName("add-to-list").setDescription("Add a player to a list")
      .addStringOption(o => o.setName("list").setDescription("List name (viplist, elitelist1..44, zorpallowlist, etc.)").setRequired(true))
      .addStringOption(o => o.setName("ingame_name").setDescription("In-game name").setRequired(true)) as SlashCommandBuilder),
    execute: handleAddToList,
  },
  {
    data: serverOption(new SlashCommandBuilder().setName("remove-from-list").setDescription("Remove a player from a list")
      .addStringOption(o => o.setName("list").setDescription("List name").setRequired(true))
      .addStringOption(o => o.setName("ingame_name").setDescription("In-game name").setRequired(true)) as SlashCommandBuilder),
    execute: handleRemoveFromList,
  },
  {
    data: serverOption(new SlashCommandBuilder().setName("get-list").setDescription("View a list")
      .addStringOption(o => o.setName("list").setDescription("List name").setRequired(true)) as SlashCommandBuilder),
    execute: handleGetList,
  },
  // Kits
  {
    data: serverOption(new SlashCommandBuilder().setName("givekit").setDescription("Give a kit to a player (admin only)")
      .addStringOption(o => o.setName("ingame_name").setDescription("Player's in-game name — search as you type").setRequired(true).setAutocomplete(true))
      .addStringOption(o => o.setName("kit_name").setDescription("Kit name — search as you type").setRequired(true).setAutocomplete(true)) as SlashCommandBuilder),
    execute: handleGivekit,
    autocomplete: autocompleteGivekit,
  },
  {
    data: serverOption(new SlashCommandBuilder().setName("refresh-kits").setDescription("Sync kit list from RCON server into autocomplete (admin)") as SlashCommandBuilder),
    execute: handleRefreshKits,
  },
  // Economy
  {
    data: new SlashCommandBuilder().setName("balance").setDescription("Check your balance across all linked servers")
      .addUserOption(o => o.setName("player").setDescription("Check another player (admins only)").setRequired(false)) as SlashCommandBuilder,
    execute: handleBalance,
  },
  {
    data: serverOption(new SlashCommandBuilder().setName("daily").setDescription("Claim your daily coin reward") as SlashCommandBuilder),
    execute: handleDaily,
  },
  {
    data: serverOption(new SlashCommandBuilder().setName("transfer").setDescription("Send coins to another player")
      .addUserOption(o => o.setName("player").setDescription("Discord user to send to").setRequired(true))
      .addIntegerOption(o => o.setName("amount").setDescription("Amount to transfer").setRequired(true).setMinValue(1)) as SlashCommandBuilder),
    execute: handleTransfer,
  },
  {
    data: new SlashCommandBuilder().setName("swap").setDescription("Move coins between servers")
      .addIntegerOption(o => o.setName("amount").setDescription("Amount").setRequired(true).setMinValue(1))
      .addIntegerOption(o => o.setName("from").setDescription("Source server").setRequired(true).addChoices({ name: "Server 1", value: 1 }, { name: "Server 2", value: 2 }, { name: "Server 3", value: 3 }))
      .addIntegerOption(o => o.setName("to").setDescription("Destination server").setRequired(true).addChoices({ name: "Server 1", value: 1 }, { name: "Server 2", value: 2 }, { name: "Server 3", value: 3 })),
    execute: handleSwap,
  },
  {
    data: serverOption(new SlashCommandBuilder().setName("leaderboard").setDescription("View the top earners") as SlashCommandBuilder),
    execute: handleLeaderboard,
  },
  {
    data: new SlashCommandBuilder().setName("setdailyscale").setDescription("Set daily reward min/max (admin)")
      .addIntegerOption(o => o.setName("min").setDescription("Minimum reward").setRequired(true))
      .addIntegerOption(o => o.setName("max").setDescription("Maximum reward").setRequired(true)),
    execute: handleSetdailyscale,
  },
  {
    data: serverOption(new SlashCommandBuilder().setName("killpoints").setDescription("Set points per kill type (admin)")
      .addStringOption(o => o.setName("type").setDescription("Kill type").setRequired(true).addChoices({ name: "player", value: "player" }, { name: "scientist", value: "scientist" }))
      .addIntegerOption(o => o.setName("amount").setDescription("Points to award").setRequired(true)) as SlashCommandBuilder),
    execute: handleKillpoints,
  },
  {
    data: serverOption(new SlashCommandBuilder().setName("add-points-player").setDescription("Give coins to one player (admin)")
      .addStringOption(o => o.setName("ingame_name").setDescription("In-game name").setRequired(true))
      .addIntegerOption(o => o.setName("amount").setDescription("Amount").setRequired(true)) as SlashCommandBuilder),
    execute: handleAddPointsPlayer,
  },
  {
    data: serverOption(new SlashCommandBuilder().setName("sub-points-player").setDescription("Remove coins from one player (admin)")
      .addStringOption(o => o.setName("ingame_name").setDescription("In-game name").setRequired(true))
      .addIntegerOption(o => o.setName("amount").setDescription("Amount").setRequired(true)) as SlashCommandBuilder),
    execute: handleSubPointsPlayer,
  },
  {
    data: serverOption(new SlashCommandBuilder().setName("add-points-server").setDescription("Give coins to ALL players (admin)")
      .addIntegerOption(o => o.setName("amount").setDescription("Amount per player").setRequired(true)) as SlashCommandBuilder),
    execute: handleAddPointsServer,
  },
  {
    data: serverOption(new SlashCommandBuilder().setName("sub-points-server").setDescription("Remove coins from ALL players (admin)")
      .addIntegerOption(o => o.setName("amount").setDescription("Amount per player").setRequired(true)) as SlashCommandBuilder),
    execute: handleSubPointsServer,
  },
  // Gambling
  {
    data: serverOption(new SlashCommandBuilder().setName("spin").setDescription("Spin the Rust bandit wheel")
      .addIntegerOption(o => o.setName("bet").setDescription("Bet amount").setRequired(true).setMinValue(1)) as SlashCommandBuilder),
    execute: handleSpin,
  },
  {
    data: serverOption(new SlashCommandBuilder().setName("coinflip").setDescription("Flip a coin")
      .addIntegerOption(o => o.setName("bet").setDescription("Bet amount").setRequired(true).setMinValue(1))
      .addStringOption(o => o.setName("choice").setDescription("Heads or tails").setRequired(true).addChoices({ name: "heads", value: "heads" }, { name: "tails", value: "tails" })) as SlashCommandBuilder),
    execute: handleCoinflip,
  },
  {
    data: serverOption(new SlashCommandBuilder().setName("blackjack").setDescription("Play blackjack")
      .addIntegerOption(o => o.setName("bet").setDescription("Bet amount").setRequired(true).setMinValue(1)) as SlashCommandBuilder),
    execute: handleBlackjack,
  },
  {
    data: new SlashCommandBuilder().setName("maxbet").setDescription("Set the maximum bet allowed (admin)")
      .addIntegerOption(o => o.setName("amount").setDescription("Max bet amount").setRequired(true)),
    execute: handleMaxbet,
  },
  // Shop
  {
    data: new SlashCommandBuilder().setName("shop").setDescription("Browse and buy from the guild shop"),
    execute: handleShop,
  },
  {
    data: new SlashCommandBuilder().setName("admin-shop-create-shop").setDescription("Initialize the shop for this guild"),
    execute: handleAdminShopCreateShop,
  },
  {
    data: new SlashCommandBuilder().setName("admin-shop-delete-shop").setDescription("Delete the entire guild shop"),
    execute: handleAdminShopDeleteShop,
  },
  {
    data: new SlashCommandBuilder().setName("admin-shop-add-category").setDescription("Add a shop category")
      .addStringOption(o => o.setName("name").setDescription("Category name").setRequired(true))
      .addStringOption(o => o.setName("type").setDescription("Category type").setRequired(false).addChoices({ name: "item", value: "item" }, { name: "kit", value: "kit" })) as SlashCommandBuilder,
    execute: handleAdminShopAddCategory,
  },
  {
    data: new SlashCommandBuilder().setName("admin-shop-add-subcategory").setDescription("Add a subcategory under an existing category")
      .addStringOption(o => o.setName("name").setDescription("Subcategory name").setRequired(true))
      .addStringOption(o => o.setName("parent").setDescription("Parent category — search as you type").setRequired(true).setAutocomplete(true)) as SlashCommandBuilder,
    execute: handleAdminShopAddSubcategory,
    autocomplete: autocompleteShopAdmin,
  },
  {
    data: new SlashCommandBuilder().setName("admin-shop-add-item").setDescription("Add an item to the shop")
      .addStringOption(o => o.setName("name").setDescription("Item display name").setRequired(true))
      .addStringOption(o => o.setName("shortname").setDescription("Rust item shortname — search as you type").setRequired(true).setAutocomplete(true))
      .addIntegerOption(o => o.setName("price").setDescription("Price in coins").setRequired(true))
      .addStringOption(o => o.setName("category").setDescription("Category — search as you type").setRequired(true).setAutocomplete(true))
      .addIntegerOption(o => o.setName("timer_hours").setDescription("Cooldown in hours (0 = none)").setRequired(false))
      .addIntegerOption(o => o.setName("stock").setDescription("Stock amount (-1 = unlimited)").setRequired(false)) as SlashCommandBuilder,
    execute: handleAdminShopAddItem,
    autocomplete: autocompleteShopAdmin,
  },
  {
    data: new SlashCommandBuilder().setName("admin-shop-add-kit").setDescription("Add a kit to the shop")
      .addStringOption(o => o.setName("kit_name").setDescription("Kit name").setRequired(true))
      .addIntegerOption(o => o.setName("price").setDescription("Price in coins").setRequired(true))
      .addStringOption(o => o.setName("category").setDescription("Category — search as you type").setRequired(true).setAutocomplete(true))
      .addIntegerOption(o => o.setName("timer_hours").setDescription("Cooldown in hours").setRequired(false)) as SlashCommandBuilder,
    execute: handleAdminShopAddKit,
    autocomplete: autocompleteShopAdmin,
  },
  {
    data: new SlashCommandBuilder().setName("admin-shop-edit-product").setDescription("Edit a shop product's price or stock")
      .addIntegerOption(o => o.setName("product_id").setDescription("Product ID").setRequired(true))
      .addIntegerOption(o => o.setName("price").setDescription("New price").setRequired(false))
      .addIntegerOption(o => o.setName("stock").setDescription("New stock (-1 = unlimited)").setRequired(false)) as SlashCommandBuilder,
    execute: handleAdminShopEditProduct,
  },
  {
    data: new SlashCommandBuilder().setName("admin-shop-remove-product").setDescription("Remove a product from the shop")
      .addIntegerOption(o => o.setName("product_id").setDescription("Product ID").setRequired(true)) as SlashCommandBuilder,
    execute: handleAdminShopRemoveProduct,
  },
  {
    data: new SlashCommandBuilder().setName("delayshop").setDescription("Temporarily close the shop for the whole guild")
      .addIntegerOption(o => o.setName("minutes").setDescription("Duration in minutes").setRequired(true)) as SlashCommandBuilder,
    execute: handleDelayshop,
  },
  {
    data: new SlashCommandBuilder().setName("openshop").setDescription("Reopen the shop early"),
    execute: handleOpenshop,
  },
  // Moderation
  {
    data: serverOption(new SlashCommandBuilder().setName("kick").setDescription("Kick a player")
      .addStringOption(o => o.setName("ingame_name").setDescription("In-game name").setRequired(true))
      .addStringOption(o => o.setName("reason").setDescription("Reason").setRequired(false)) as SlashCommandBuilder),
    execute: handleKick,
  },
  {
    data: serverOption(new SlashCommandBuilder().setName("ban").setDescription("Ban a player")
      .addStringOption(o => o.setName("ingame_name").setDescription("In-game name").setRequired(true))
      .addStringOption(o => o.setName("reason").setDescription("Reason").setRequired(false)) as SlashCommandBuilder),
    execute: handleBan,
  },
  {
    data: serverOption(new SlashCommandBuilder().setName("unban").setDescription("Unban a player")
      .addStringOption(o => o.setName("ingame_name").setDescription("In-game name").setRequired(true)) as SlashCommandBuilder),
    execute: handleUnban,
  },
  {
    data: serverOption(new SlashCommandBuilder().setName("mute").setDescription("Mute a player in-game")
      .addStringOption(o => o.setName("ingame_name").setDescription("In-game name").setRequired(true)) as SlashCommandBuilder),
    execute: handleMute,
  },
  {
    data: serverOption(new SlashCommandBuilder().setName("unmute").setDescription("Unmute a player")
      .addStringOption(o => o.setName("ingame_name").setDescription("In-game name").setRequired(true)) as SlashCommandBuilder),
    execute: handleUnmute,
  },
  {
    data: serverOption(new SlashCommandBuilder().setName("warn").setDescription("Issue a warning to a player")
      .addStringOption(o => o.setName("ingame_name").setDescription("In-game name").setRequired(true))
      .addStringOption(o => o.setName("reason").setDescription("Reason").setRequired(true)) as SlashCommandBuilder),
    execute: handleWarn,
  },
  {
    data: serverOption(new SlashCommandBuilder().setName("warnings").setDescription("View a player's warnings")
      .addStringOption(o => o.setName("ingame_name").setDescription("In-game name").setRequired(true)) as SlashCommandBuilder),
    execute: handleWarnings,
  },
  {
    data: serverOption(new SlashCommandBuilder().setName("clearwarnings").setDescription("Clear all warnings for a player")
      .addStringOption(o => o.setName("ingame_name").setDescription("In-game name").setRequired(true)) as SlashCommandBuilder),
    execute: handleClearwarnings,
  },
  // Prison
  {
    data: serverOption(new SlashCommandBuilder().setName("prison").setDescription("Send a player to prison")
      .addStringOption(o => o.setName("ingame_name").setDescription("In-game name").setRequired(true))
      .addIntegerOption(o => o.setName("duration").setDescription("Duration in minutes").setRequired(true))
      .addStringOption(o => o.setName("reason").setDescription("Reason").setRequired(false)) as SlashCommandBuilder),
    execute: handlePrison,
  },
  {
    data: serverOption(new SlashCommandBuilder().setName("unprison").setDescription("Release a player from prison")
      .addStringOption(o => o.setName("ingame_name").setDescription("In-game name").setRequired(true)) as SlashCommandBuilder),
    execute: handleUnprison,
  },
  {
    data: serverOption(new SlashCommandBuilder().setName("prison-list").setDescription("View all imprisoned players") as SlashCommandBuilder),
    execute: handlePrisonList,
  },
  // Wipe commands
  {
    data: serverOption(new SlashCommandBuilder().setName("wipe-economy").setDescription("Reset all player balances to 0 on this server (admin)") as SlashCommandBuilder),
    execute: handleWipeEconomy,
  },
  // ZORP
  {
    data: serverOption(new SlashCommandBuilder().setName("wipe-zorp").setDescription("Delete all ZORP zones (admin)") as SlashCommandBuilder),
    execute: handleWipeZorp,
  },
  {
    data: serverOption(new SlashCommandBuilder().setName("del-zorp").setDescription("Delete one player's ZORP zone (admin)")
      .addStringOption(o => o.setName("ingame_name").setDescription("In-game name").setRequired(true)) as SlashCommandBuilder),
    execute: handleDelZorp,
  },
  // Raid alerts
  {
    data: serverOption(new SlashCommandBuilder().setName("raidlink").setDescription("Register your base broadcaster frequency")
      .addStringOption(o => o.setName("ingame_name").setDescription("Your in-game name").setRequired(true))
      .addStringOption(o => o.setName("frequency").setDescription("Your base frequency").setRequired(true)) as SlashCommandBuilder),
    execute: handleRaidlink,
  },
  {
    data: serverOption(new SlashCommandBuilder().setName("list-raidlink").setDescription("View all registered frequencies (admin)") as SlashCommandBuilder),
    execute: handleListRaidlink,
  },
  {
    data: serverOption(new SlashCommandBuilder().setName("list-raidalert").setDescription("Check currently firing frequencies (admin)") as SlashCommandBuilder),
    execute: handleListRaidalert,
  },
  {
    data: serverOption(new SlashCommandBuilder().setName("wipe-raidlink").setDescription("Clear all frequency registrations (admin)") as SlashCommandBuilder),
    execute: handleWipeRaidlink,
  },
  {
    data: serverOption(new SlashCommandBuilder().setName("del-raidlink").setDescription("Remove one frequency registration (admin)")
      .addStringOption(o => o.setName("ingame_name").setDescription("In-game name").setRequired(true)) as SlashCommandBuilder),
    execute: handleDelRaidlink,
  },
  // Additional moderation
  {
    data: serverOption(new SlashCommandBuilder().setName("temp-ban").setDescription("Temporarily ban a player")
      .addStringOption(o => o.setName("ingame_name").setDescription("In-game name").setRequired(true))
      .addIntegerOption(o => o.setName("hours").setDescription("Duration in hours").setRequired(true).setMinValue(1))
      .addStringOption(o => o.setName("reason").setDescription("Reason").setRequired(false)) as SlashCommandBuilder),
    execute: handleTempBan,
  },
  {
    data: serverOption(new SlashCommandBuilder().setName("give").setDescription("Give items to a player (mod)")
      .addStringOption(o => o.setName("ingame_name").setDescription("In-game name").setRequired(true))
      .addStringOption(o => o.setName("item").setDescription("Item shortname (e.g. wood, stones, metal.fragments)").setRequired(true))
      .addIntegerOption(o => o.setName("amount").setDescription("Amount (default 1)").setRequired(false).setMinValue(1)) as SlashCommandBuilder),
    execute: handleGive,
  },
  {
    data: serverOption(new SlashCommandBuilder().setName("playing").setDescription("Check if a player is currently online")
      .addStringOption(o => o.setName("ingame_name").setDescription("In-game name").setRequired(true)) as SlashCommandBuilder),
    execute: handlePlaying,
  },
  // Wipe commands
  {
    data: serverOption(new SlashCommandBuilder().setName("wipe-claims").setDescription("Clear all kit claim records — players can claim again immediately (admin)") as SlashCommandBuilder),
    execute: handleWipeClaims,
  },
  {
    data: serverOption(new SlashCommandBuilder().setName("wipe-kills").setDescription("Reset all player kill counts to 0 (admin)") as SlashCommandBuilder),
    execute: handleWipeKills,
  },
  {
    data: serverOption(new SlashCommandBuilder().setName("wipe-tphome").setDescription("Clear all TP home records (admin)") as SlashCommandBuilder),
    execute: handleWipeTpHome,
  },
  {
    data: serverOption(new SlashCommandBuilder().setName("wipe-shoptimers").setDescription("Clear all shop purchase cooldowns (admin)") as SlashCommandBuilder),
    execute: handleWipeShopTimers,
  },
  {
    data: serverOption(new SlashCommandBuilder().setName("wipe-positions").setDescription("Clear all positions for a given type (admin)")
      .addStringOption(o => o.setName("type").setDescription("Position type (TPN, crate1, airdrop1, prison, etc.)").setRequired(true)) as SlashCommandBuilder),
    execute: handleWipePositions,
  },
  {
    data: serverOption(new SlashCommandBuilder().setName("clear-list").setDescription("Remove all entries from a list (admin)")
      .addStringOption(o => o.setName("list").setDescription("List name (e.g. viplist, elitelist1, recyclerlist)").setRequired(true)) as SlashCommandBuilder),
    execute: handleClearList,
  },
  {
    data: serverOption(new SlashCommandBuilder().setName("banboom").setDescription("Ban all currently online players (admin)")
      .addStringOption(o => o.setName("reason").setDescription("Reason for ban").setRequired(false)) as SlashCommandBuilder),
    execute: handleBanboom,
  },
  {
    data: serverOption(new SlashCommandBuilder().setName("unbanboom").setDescription("Unban all players on this server (admin)") as SlashCommandBuilder),
    execute: handleUnbanboom,
  },
  {
    data: serverOption(new SlashCommandBuilder().setName("timedrestart").setDescription("Schedule a server restart with player warning (admin)")
      .addIntegerOption(o => o.setName("minutes").setDescription("Minutes until restart").setRequired(true).setMinValue(1)) as SlashCommandBuilder),
    execute: handleTimedrestart,
  },
  {
    data: serverOption(new SlashCommandBuilder().setName("delay-claims").setDescription("Temporarily block kit claims (admin)")
      .addIntegerOption(o => o.setName("hours").setDescription("Hours to delay").setRequired(true).setMinValue(1)) as SlashCommandBuilder),
    execute: handleDelayClaims,
  },
  // Auto Events
  {
    data: serverOption(new SlashCommandBuilder().setName("trigger-event").setDescription("Manually trigger an auto event (mod)")
      .addIntegerOption(o => o.setName("event").setDescription("Event number (1, 2, or 3)").setRequired(true).addChoices(
        { name: "Event 1", value: 1 }, { name: "Event 2", value: 2 }, { name: "Event 3", value: 3 }
      )) as SlashCommandBuilder),
    execute: handleTriggerEvent,
  },
  {
    data: serverOption(new SlashCommandBuilder().setName("clear-an-event").setDescription("Clear all positions for an event (admin)")
      .addIntegerOption(o => o.setName("event").setDescription("Event number (1, 2, or 3)").setRequired(true).addChoices(
        { name: "Event 1", value: 1 }, { name: "Event 2", value: 2 }, { name: "Event 3", value: 3 }
      ))
      .addStringOption(o => o.setName("type").setDescription("Override type: airdrop or crate").setRequired(false).addChoices(
        { name: "airdrop", value: "airdrop" }, { name: "crate", value: "crate" }
      )) as SlashCommandBuilder),
    execute: handleClearAnEvent,
  },
  {
    data: serverOption(new SlashCommandBuilder().setName("setleaderboard").setDescription("Set a channel for automatic leaderboard posts (admin)")
      .addStringOption(o => o.setName("type").setDescription("Leaderboard type").setRequired(true).addChoices(
        { name: "Economy (balances)", value: "economy" }, { name: "Kills", value: "kills" }
      ))
      .addChannelOption(o => o.setName("channel").setDescription("Channel to post leaderboard in").setRequired(true)) as SlashCommandBuilder),
    execute: handleSetLeaderboard,
  },
  // Player / user commands
  {
    data: serverOption(new SlashCommandBuilder().setName("stats").setDescription("View your (or another player's) stats")
      .addUserOption(o => o.setName("player").setDescription("Discord user to check (optional)").setRequired(false)) as SlashCommandBuilder),
    execute: handleStats,
  },
  {
    data: serverOption(new SlashCommandBuilder().setName("profile").setDescription("View a player's profile")
      .addStringOption(o => o.setName("ingame_name").setDescription("In-game name (leave blank for your own)").setRequired(false)) as SlashCommandBuilder),
    execute: handleProfile,
  },
  {
    data: serverOption(new SlashCommandBuilder().setName("topkillers").setDescription("View the top 10 players by kills") as SlashCommandBuilder),
    execute: handleTopkillers,
  },
  {
    data: serverOption(new SlashCommandBuilder().setName("scratch").setDescription("Play a Rust scratch card for a chance to win coins")
      .addIntegerOption(o => o.setName("bet").setDescription("Amount to bet").setRequired(true).setMinValue(1)) as SlashCommandBuilder),
    execute: handleScratch,
  },
  // Bank
  {
    data: serverOption(new SlashCommandBuilder().setName("bank").setDescription("Manage your bank savings account")
      .addSubcommand(s => s.setName("balance").setDescription("Check your wallet and bank balance"))
      .addSubcommand(s => s.setName("deposit").setDescription("Deposit coins from your wallet into the bank")
        .addIntegerOption(o => o.setName("amount").setDescription("Amount to deposit").setRequired(true).setMinValue(1)))
      .addSubcommand(s => s.setName("withdraw").setDescription("Withdraw coins from the bank to your wallet")
        .addIntegerOption(o => o.setName("amount").setDescription("Amount to withdraw").setRequired(true).setMinValue(1))) as SlashCommandBuilder),
    execute: handleBank,
  },
  {
    data: serverOption(new SlashCommandBuilder().setName("wipe-bank").setDescription("Wipe all bank balances on this server (admin)") as SlashCommandBuilder),
    execute: handleWipeBank,
  },
  // Roshambo
  {
    data: serverOption(new SlashCommandBuilder().setName("roshambo").setDescription("Play rock paper scissors against the bot for coins")
      .addIntegerOption(o => o.setName("bet").setDescription("Bet amount").setRequired(true).setMinValue(1))
      .addStringOption(o => o.setName("choice").setDescription("Your choice").setRequired(true)
        .addChoices(
          { name: "🪨 Rock", value: "rock" },
          { name: "📄 Paper", value: "paper" },
          { name: "✂️ Scissors", value: "scissors" },
        )) as SlashCommandBuilder),
    execute: handleRoshambo,
  },
  // Actions
  {
    data: serverOption(new SlashCommandBuilder().setName("actions").setDescription("View all available in-game emote commands and their cooldowns") as SlashCommandBuilder),
    execute: handleActions,
  },
  // Get ban
  {
    data: serverOption(new SlashCommandBuilder().setName("get-ban").setDescription("Check if a player is on the server ban list (mod)")
      .addStringOption(o => o.setName("ingame_name").setDescription("In-game name to look up").setRequired(true)) as SlashCommandBuilder),
    execute: handleGetBan,
  },
  // VIP shortcuts
  {
    data: serverOption(new SlashCommandBuilder().setName("add-vip").setDescription("Add a player to the VIP list (mod)")
      .addStringOption(o => o.setName("ingame_name").setDescription("In-game name").setRequired(true)) as SlashCommandBuilder),
    execute: handleAddVip,
  },
  {
    data: serverOption(new SlashCommandBuilder().setName("remove-vip").setDescription("Remove a player from the VIP list (mod)")
      .addStringOption(o => o.setName("ingame_name").setDescription("In-game name").setRequired(true)) as SlashCommandBuilder),
    execute: handleRemoveVip,
  },
  // Clan
  {
    data: serverOption(new SlashCommandBuilder().setName("clan").setDescription("Clan system — create, join, or manage clans")
      .addSubcommand(s => s.setName("create").setDescription("Create a new clan")
        .addStringOption(o => o.setName("name").setDescription("Clan name (2–32 chars)").setRequired(true))
        .addStringOption(o => o.setName("tag").setDescription("Clan tag (1–6 chars, shown in brackets)").setRequired(false)))
      .addSubcommand(s => s.setName("join").setDescription("Join an existing clan")
        .addStringOption(o => o.setName("name").setDescription("Clan name to join").setRequired(true)))
      .addSubcommand(s => s.setName("leave").setDescription("Leave your current clan"))
      .addSubcommand(s => s.setName("disband").setDescription("Disband your clan (leader only)"))
      .addSubcommand(s => s.setName("info").setDescription("View info about a clan")
        .addStringOption(o => o.setName("name").setDescription("Clan name (leave blank for your own clan)").setRequired(false)))
      .addSubcommand(s => s.setName("list").setDescription("List all clans on this server")) as SlashCommandBuilder),
    execute: handleClan,
  },
];
