// src/commands/toggle.ts — alt left-click state machine:
// float windows / minimize focused floating / unminimize into frame.
import { defineCommand, option } from "@bunli/core";
import { z } from "zod";
import { toggle } from "../lib/actions";

export default defineCommand({
    name: "toggle" as const,
    description: "Float / minimize / unminimize-into-frame state machine",
    options: {
        wid: option(z.string().min(1), { description: "Window id (0x…)", short: "w" }),
    },
    handler: async ({ flags }) => {
        await toggle(flags.wid);
    },
});
