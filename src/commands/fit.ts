// src/commands/fit.ts — constraint pass for a floating window: shrink
// oversized windows, nudge off-screen ones (deco-aware), size-preserving
// otherwise. Target: "monitor" (default, the work area) or the focused
// "frame". `hc_fit_to [monitor|frame]` is its dots shim.
import { defineCommand, option } from "@bunli/core";
import { z } from "zod";
import { fitTo } from "../lib/center";

export default defineCommand({
    name: "fit" as const,
    description:
        "Fit a floating window: resize down + nudge into bounds (deco-aware). Default target: the monitor work area; 'frame' constrains to the focused frame",
    options: {
        wid: option(z.string().optional(), {
            description: "Fit THIS window instead of the focused one",
            short: "w",
        }),
        target: option(z.enum(["monitor", "frame"]).default("monitor"), {
            description: "Rectangle to fit within:",
            short: "t",
        }),
    },
    handler: async ({ flags, positional }) => {
        const { attr } = await import("../lib/hc");
        const wid = flags.wid || (await attr("clients.focus.winid"));
        if (!wid) return; // no focused client: fail soft like the other helpers
        const target = positional[0] === "frame" || positional[0] === "monitor"
            ? positional[0]
            : flags.target ?? "monitor";
        await fitTo(wid, target === "frame" ? "frame" : "root");
    },
});
