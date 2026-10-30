// src/commands/bar.ts — one-shot bar line (the `--once` behavior, as a
// proper subcommand). Bare invocation stays the daemon-entry contract.
import { defineCommand, option } from "@bunli/core";
import { z } from "zod";
import { printBar } from "../lib/bar";

export default defineCommand({
    name: "bar" as const,
    description: "Print one bar line and exit (daemon starts on bare invocation)",
    options: {
        once: option(z.coerce.boolean().default(true), {
            description: "Print a single bar line, no listeners",
            short: "o",
        }),
    },
    handler: async () => {
        await printBar();
    },
});
