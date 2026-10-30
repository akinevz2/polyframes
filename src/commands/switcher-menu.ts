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
        "Internal: rofi dmenu for one (frame, class) group. Args: <frame> <class> <selrow> <widthEm> <wid...> (former hc_switcher)",
    options: {
        xoffset: option(z.coerce.number().default(0), {
            description: "Horizontal offset (px) of this label from the bar's center (menu anchoring)",
        }),
    },
    handler: async ({ flags, positional }) => {
        await switcherMenu(positional, flags.xoffset);
    },
});
