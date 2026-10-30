// src/commands/toggle-focus.ts — left-click state machine for
// single-window entries (restore / step forward, one step at a time).
import { defineCommand, option } from "@bunli/core";
import { z } from "zod";
import { toggleFocus } from "../lib/actions";

export default defineCommand({
    name: "toggle-focus" as const,
    description: "Left-click state machine: unminimize / focus / float / re-tile",
    options: {
        wid: option(z.string().min(1), { description: "Window id (0x…)", short: "w" }),
    },
    handler: async ({ flags }) => {
        await toggleFocus(flags.wid);
    },
});
