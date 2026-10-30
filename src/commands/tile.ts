// src/commands/tile.ts — closest-empty-frame navigation + tiling
// (former dots hc_tile).
import { defineCommand } from "@bunli/core";
import { tile } from "../lib/tile";

export default defineCommand({
    name: "tile" as const,
    description:
        "Navigate to the closest empty frame (or split auto one) and tile the window into it (former hc_tile)",
    handler: async ({ positional }) => {
        await tile(positional[0]);
    },
});
