// src/commands/scroll.ts — scroll wheel over a window label; the
// frame/class group membership is resolved live at click time.
import { defineCommand, option } from "@bunli/core";
import { z } from "zod";
import { scrollFocus } from "../lib/actions";

export default defineCommand({
    name: "scroll" as const,
    description: "Scroll-cycle focus within a window's group",
    options: {
        wid: option(z.string().min(1), { description: "Window id (0x…)", short: "w" }),
        dir: option(z.enum(["up", "down"]), { description: "Scroll direction", short: "d" }),
    },
    handler: async ({ flags }) => {
        await scrollFocus(flags.wid, flags.dir);
    },
});
