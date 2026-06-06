---
name: RCE RCON commands
description: Correct RCON command syntax for Rust Console Edition (RCE) servers used by Aviv Bot
---

## Confirmed RCE RCON Commands (verified from console screenshot)

**Kit delivery:** `kitmanager.kit "${playerName}" "${kitName}"` — NOT `kit.give`

**Permanent ban:** `global.ban "${name}" 0 "${reason}"` — 0 = permanent duration, global. prefix required

**Temp ban:** `global.ban "${name}" ${hours} "${reason}"`

**Kick:** `global.kick "${name}" "${reason}"`

**Unban:** `global.unban "${name}"`

**Mute/unmute:** `global.mutechat "${name}"` / `global.unmutechat "${name}"`

**Teleport to position:** `global.teleportpos ${name} ${x} ${y} ${z}` — global. prefix required, no quotes on coords

**Kill player:** `global.killplayer ${name}` — NOT `kill`

**Say in chat:** `global.say "message"` — global. prefix required

**Give items:** `inventory.give "${name}" "${shortname}" ${amount}` — no global. prefix

**Airdrop event:** `supply.call ${x} ${y} ${z}` — NOT `callairlift`

**Crate event:** `supply.drop ${x} ${y} ${z}` — NOT `spawnlootcrate`

**Helicopter:** `heli.call`

**Server quit/restart:** `quit`

**Unban all:** `unbanall`

**ZORP:** `o.zorp create ${name}` / `o.zorp delete ${name}`

**Recycler:** `spawnrecycler ${name}` — unverified, plugin-specific

**Teleport to bed:** `teleport2bed ${name}` — unverified in RCE console screenshots

**Why:** Confirmed from RCE server console screenshots shared by user. RCE requires `global.` prefix on most player management commands unlike PC Rust. Kit command is `kitmanager.kit` (plugin), supply events are `supply.call`/`supply.drop`.

**How to apply:** Any new RCON command must use these exact prefixes. The `global.` prefix is required for kick/ban/unban/mute/unmute/teleportpos/say/killplayer. Items use `inventory.give` (no prefix). Kits use `kitmanager.kit` (no prefix).
