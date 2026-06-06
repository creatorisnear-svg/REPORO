---
name: RCE RCON commands
description: Correct RCON command syntax for Rust Console Edition (RCE) servers — verified from official GitBook docs
---

## Confirmed RCE RCON Commands (from official GitBook)

**Kit gifting to player:** `kit givetoplayer "kitname" "playerID"` — kitname FIRST, player second. NOT `kitmanager.kit` (that command only creates/edits kits, not gives them).

**Teleport to position:** `global.teleportpos x,y,z "playerID"` — coordinates FIRST (comma-separated), then player. NOT player-first.

**Kill player:** `global.killplayer "playerID"`

**Say in chat:** `global.say "message"` — Server Admin level, confirmed

**Kick:** `global.kick "playerID" "reason"`

**Ban:** `global.ban "playerID" hours "reason"` — 0 = permanent

**Unban:** `global.unban "playerID"`

**Mute/unmute:** `global.mutechat "playerID"` / `global.unmutechat "playerID"`

**Supply airdrop:** `supply.call` — NO coordinates, takes no input

**Supply drop (crate):** `supply.drop` — NO coordinates, takes no input

**Trigger named event:** `events.triggerevent "event_airdrop"` / `events.triggerevent "event_helicopter"` etc.

**Helicopter:** `heli.call` — no input

**Cargo ship:** `cargoships.spawncargoship` — no input

**Items page has no give-to-player command** — `inventory.give` / `inventory.giveto` not in official docs; use with caution (may work as undocumented commands from in-game console screenshots).

**Why:** Confirmed from official RCE GitBook pages pasted directly by the user (Player commands, Kit Management, Events, Tools, Items & Inventory pages).

**How to apply:** Any new RCON command must follow these exact formats. Key traps: coords come before player in teleportpos; kit gifting is `kit givetoplayer` not `kitmanager.kit`; supply events take no arguments.
