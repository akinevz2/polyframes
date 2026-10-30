// src/commands/switcher.ts — group switcher: rofi dmenu of one group's
// windows. Double-click (re-click while the menu is open) dismisses it
// and focuses/minimizes the group's visible window.
import { defineCommand } from "@bunli/core";
import { z } from "zod";
import { switcher } from "../lib/actions";

const frameSchema = z.string().regex(/^\d+$/, "flat frame index digits");
const classSchema = z.string().min(1);

export default defineCommand({
    name: "switcher" as const,
    description:
        "Open the frame+class window switcher (rofi dmenu). Usage: polyframes switcher <frame> <class>",
    handler: async ({ positional }) => {
        const [frame = "", cls = ""] = positional;
        if (!cls) throw new Error("Usage: polyframes switcher <frame> <class>");
        await switcher(
            frameSchema.parse(frame),
            classSchema.parse(cls),
        );
    },
});
