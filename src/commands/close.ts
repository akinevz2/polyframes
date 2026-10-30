// src/commands/close.ts — close a window.
import { defineCommand, option } from "@bunli/core";
import { z } from "zod";
import { closeWindow } from "../lib/actions";

export default defineCommand({
    name: "close" as const,
    description: "Close a window",
    options: {
        wid: option(z.string().min(1), { description: "Window id (0x…)", short: "w" }),
    },
    handler: async ({ flags }) => {
        await closeWindow(flags.wid);
    },
});
