// src/commands/tags.ts — rofi tag switcher (former dots rofi_tags).
import { defineCommand } from "@bunli/core";
import { tagsMenu } from "../lib/menus/tags";

export default defineCommand({
    name: "tags" as const,
    description: "Rofi tag switcher across tags (former rofi_tags)",
    handler: async ({ positional }) => {
        await tagsMenu(positional);
    },
});
