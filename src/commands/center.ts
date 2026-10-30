// src/commands/center.ts — centered floating geometry (former dots
// hc_center).
import { defineCommand, option } from "@bunli/core";
import { z } from "zod";
import { center, centerWindowInOwnFrame } from "../lib/center";

export default defineCommand({
    name: "center" as const,
    description:
        "Center the focused floating window (preserving size) in its frame or the workspace (former hc_center)",
    options: {
        wid: option(z.string().optional(), {
            description:
                "Center THIS specific window within its OWN parent frame instead of the focused one (old centerInFrame semantics; no float toggling)",
            short: "w",
        }),
    },
    handler: async ({ flags, positional }) => {
        if (flags.wid) {
            await centerWindowInOwnFrame(flags.wid);
            return;
        }
        await center(positional[0]);
    },
});
