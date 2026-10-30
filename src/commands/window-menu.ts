// src/commands/window-menu.ts — internal window-operations rofi menu
// (former dots hc_menu). Spawned DETACHED by the `menu` action; can
// also be run standalone (resolves the focused frame's visible client
// when no wid is given).
import { defineCommand, option } from "@bunli/core";
import { z } from "zod";
import { windowMenu } from "../lib/menus/windowMenu";

export default defineCommand({
    name: "window-menu" as const,
    description:
        "Internal: window-operations rofi menu, [<wid>] or the focused frame's visible client (former hc_menu)",
    options: {
        xoffset: option(z.coerce.number().default(0), {
            description: "Horizontal offset (px) of this label from the bar's center (menu anchoring)",
        }),
    },
    handler: async ({ flags, positional }) => {
        await windowMenu(positional, flags.xoffset);
    },
});
