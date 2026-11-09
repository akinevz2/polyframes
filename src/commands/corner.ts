// src/commands/corner.ts — pin the focused float to the TOP-LEFT
// QUADRANT of the monitor's work area (default) or the focused frame:
// the size shrinks down to half the inner rect (never grows), the
// position anchors at the top-left inner corner (deco-aware, with the
// shared size-hint reconcile pass). The hc_floatx ModCtrl-x register
// calls this on an already-floating window.
import { defineCommand, option } from "@bunli/core";
import { z } from "zod";
import { cornerQuadrant } from "../lib/center";

export default defineCommand({
    name: "corner" as const,
    description: "Pin float to top-left quadrant",
    options: {
        wid: option(z.string().optional(), {
            description: "Pin THIS window instead of the focused one",
            short: "w",
        }),
    },
    handler: async ({ flags, positional }) => {
        const { attr, cmd } = await import("../lib/hc");
        const wid = flags.wid || (await attr("clients.focus.winid"));
        if (!wid) return; // no focused client: fail soft like the other helpers
        const target = positional[0] === "frame" ? "frame" : "root";
        // Float the window on first so the floating theme's decoration
        // is the one being measured (idempotent on an already-floating
        // window — the standalone-invocation safety center() applies).
        await cmd("attr", `clients.${wid}.floating`, "on");
        await cornerQuadrant(wid, target);
    },
});
