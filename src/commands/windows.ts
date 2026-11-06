// src/commands/windows.ts — rofi window switcher (former dots
// rofi_windows). Args [class] [frame]; envs PROMPT/WIDTH_EM honored.
import { defineCommand } from "@bunli/core";
import { windowsMenu } from "../lib/menus/windows";

export default defineCommand({
    name: "windows" as const,
    description: "Rofi window switcher",
    handler: async ({ positional }) => {
        await windowsMenu(positional);
    },
});
