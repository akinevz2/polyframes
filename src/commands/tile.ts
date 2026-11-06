// src/commands/tile.ts — closest-empty-frame navigation + tiling
// (former dots hc_tile).
import { defineCommand } from "@bunli/core";
import { tile } from "../lib/tile";

export default defineCommand({
    name: "tile" as const,
    description: "Tile into empty frame",
    handler: async ({ positional }) => {
        await tile(positional[0]);
    },
});
