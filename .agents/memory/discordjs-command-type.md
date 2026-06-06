---
name: discord.js SlashCommandOptionsOnlyBuilder
description: Adding options to SlashCommandBuilder narrows the type to SlashCommandOptionsOnlyBuilder
---

## Rule
When a helper function calls `.addIntegerOption()` (or any option adder) on a `SlashCommandBuilder`, TypeScript narrows the return to `SlashCommandOptionsOnlyBuilder`. The `Command.data` interface must include this type:

```ts
import type { SlashCommandOptionsOnlyBuilder } from "discord.js";

export interface Command {
  data: SlashCommandBuilder | SlashCommandOptionsOnlyBuilder | Omit<SlashCommandBuilder, "addSubcommand" | "addSubcommandGroup">;
  ...
}
```

**Why:** discord.js builder methods use a discriminated builder pattern. Calling any option adder strips the subcommand-related methods from the return type.

**How to apply:** Always include `SlashCommandOptionsOnlyBuilder` in the Command.data union type in registry.ts.
