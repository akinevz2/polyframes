// src/commands/menu.ts — middle click: open the hc_menu rofi window
// menu for exactly the window whose label was clicked.
import { defineCommand, option } from "@bunli/core";
import { z } from "zod";
import { menu } from "../lib/actions";

export default defineCommand({
    name: "menu" as const,
    description: "Open the hc_menu window-operations menu for a window",
    options: {
        wid: option(z.string().min(1), { description: "Window id (0x…)", short: "w" }),
    },
    handler: async ({ flags }) => {
        await menu(flags.wid);
    },
});
