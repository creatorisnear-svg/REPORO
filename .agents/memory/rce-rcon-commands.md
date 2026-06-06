---
name: RCE RCON commands
description: Correct RCON command syntax for Rust Console Edition (RCE) servers used by Aviv Bot
---

## Confirmed RCE RCON Commands

**Kit delivery:** `kit.give "${playerName}" "${kitName}"` — NOT `giveto`
- Used in parser.ts handleKit and handleDirectionalTp

**Permanent ban:** `ban "${name}" 0 "${reason}"` — 0 = permanent duration (hours), NOT omitting duration
- `/ban` slash command and `/temp-ban` both use this format (temp-ban passes actual hour count)

**Kick:** `kick "${name}" "${reason}"` — same as PC Rust

**Mute/unmute:** `mute "${name}"` / `unmute "${name}"` — same as PC Rust

**Teleport to position:** `teleportpos ${name} ${x} ${y} ${z}` — no quotes needed

**Teleport to bed:** `teleport2bed ${name}`

**Kill player:** `kill ${name}`

**Give items:** `inventory.give "${name}" "${shortname}" ${amount}`

**ZORP:** `o.zorp create ${name}` / `o.zorp delete ${name}` — o. prefix

**Recycler:** `spawnrecycler ${name}` — plugin-specific command

**Unban all:** `unbanall`

**Server quit/restart:** `quit`

**Say in chat:** `say "message"`

**Event commands (unverified - may need adjustment):**
- Airdrop: `callairlift x y z`
- Crate: `spawnlootcrate x y z`

**Why:** These are RCE-specific or confirmed via ka0s.uk docs. The main differences from PC Rust are kit.give (not giveto), ban with duration field, and inventory.give for items.

**How to apply:** Any new RCON command in parser.ts, moderation.ts, admin-wipe.ts should follow these patterns. Verify event commands with the server owner since callairlift/spawnlootcrate are unconfirmed for RCE.
