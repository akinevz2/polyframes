// src/commands/switcher-menu.ts — internal rofi dmenu for one
// (frame, class) group (former dots hc_switcher). Spawned DETACHED by
// the `switcher` action, which pgrep-matches this invocation for the
// double-click dismissal.
import { defineCommand } from "@bunli/core";
import { switcherMenu } from "../lib/menus/switcherMenu";

export default defineCommand({
    name: "switcher-menu" as const,
    description:
        "Internal: rofi dmenu for one (frame, class) group. Args: <frame> <class> <selrow> <widthEm> <wid...> (former hc_switcher)",
    handler: async ({ positional }) => {
        await switcherMenu(positional);
    },
});
