// src/commands/hidden.ts — hidden (minimized) windows picker
// (former dots rofi_hidden). Exits non-zero when there are no hidden
// clients, so the WM keybind's `|| herbstclient use_previous` chain
// keeps working.
import { defineCommand } from "@bunli/core";
import { hiddenMenu, hiddenRows } from "../lib/menus/hidden";

export default defineCommand({
    name: "hidden" as const,
    description:
        "Hidden (minimized) windows picker; exits non-zero when none, for shell chaining (former rofi_hidden)",
    handler: async () => {
        // Launcher mode: no hidden clients -> in-process fallback to the
        // windows switcher, whose rofi exit status becomes this process'
        // exit code (the keybind's `|| use_previous` chain only fires on
        // cancel, like the original exec chain). Backend mode: rows for
        // rofi, exit 0 like the shell script.
        await hiddenMenu();
    },
});
