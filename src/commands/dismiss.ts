// src/commands/dismiss.ts — right click: minimize without floating;
// unminimize + re-center when already minimized; prune emptied frames.
import { defineCommand, option } from "@bunli/core";
import { z } from "zod";
import { dismiss } from "../lib/actions";

export default defineCommand({
    name: "dismiss" as const,
    description: "Minimize a window (pruning its frame when it empties), or restore it",
    options: {
        wid: option(z.string().min(1), { description: "Window id (0x…)", short: "w" }),
    },
    handler: async ({ flags }) => {
        await dismiss(flags.wid);
    },
});
