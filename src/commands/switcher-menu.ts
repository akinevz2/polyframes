// src/commands/switcher-menu.ts — internal rofi dmenu for one
// (frame, class) group (former dots hc_switcher). Spawned DETACHED by
// the `switcher` action, which pgrep-matches this invocation for the
// double-click dismissal.
import { defineCommand, option } from "@bunli/core";
import { z } from "zod";
import { switcherMenu } from "../lib/menus/switcherMenu";

export default defineCommand({
    name: "switcher-menu" as const,
    description:
        "Internal: rofi dmenu for one (frame, class) group, all typed (former hc_switcher)",
    options: {
        frame: option(z.string(), { description: "Flat frame index", short: "f" }),
        cls: option(z.string(), { description: "Window class of the group", short: "c" }),
        selrow: option(z.coerce.number().default(-1), {
            description: "0-based row to pre-select (-1 none)", short: "r",
        }),
        width: option(z.coerce.number().default(30), {
            description: "Rofi window width (em)", short: "W",
        }),
        wids: option(z.string(), {
            description: "The group's wids, comma-separated (one per menu row)",
        }),
        xoffset: option(z.coerce.number().default(0), {
            description: "Horizontal offset (px) of this label from the bar's center (menu anchoring)",
        }),
    },
    handler: async ({ flags }) => {
        await switcherMenu({
            frame: flags.frame,
            cls: flags.cls,
            selrow: flags.selrow,
            width: flags.width,
            wids: flags.wids.split(",").map((w) => w.trim()).filter(Boolean),
            xOffsetPx: flags.xoffset,
        });
    },
});
