// src/commands/launch.ts — rofi drun/run app launcher (former dots
// rofi_launch). Extra args are passed through to rofi.
import { defineCommand } from "@bunli/core";
import { spawnSync } from "node:child_process";
import { wmEnv } from "../lib/menus/rofi";

export default defineCommand({
    name: "launch" as const,
    description: "Rofi drun/run app launcher (former rofi_launch)",
    handler: async ({ positional }) => {
        const r = spawnSync("rofi", [
            "-modi", "drun,run",
            "-show", "drun",
            "-theme", `${process.env.HOME}/.config/rofi/launcher.rasi`,
            ...positional,
        ], { env: wmEnv(), stdio: "inherit" });
        process.exitCode = r.status ?? 1;
    },
});
