// src/commands/window-menu.ts — internal window-operations rofi menu
// (former dots hc_menu). Spawned DETACHED by the `menu` action; can
// also be run standalone (resolves the focused frame's visible client
// when no wid is given).
import { defineCommand } from "@bunli/core";
import { windowMenu } from "../lib/menus/windowMenu";

export default defineCommand({
    name: "window-menu" as const,
    description:
        "Internal: window-operations rofi menu, [<wid>] or the focused frame's visible client (former hc_menu)",
    handler: async ({ positional }) => {
        await windowMenu(positional);
    },
});
