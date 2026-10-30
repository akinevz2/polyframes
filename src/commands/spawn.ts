// src/commands/spawn.ts — one-shot `herbstclient rule once` spawns with
// typed parameters.
//
//   polyframes spawn --class Xmessage --center -- xmessage ...args
//
// The binary `--` and everything after it is the command to spawn
// (detached). At least one match criterion (--class/--instance/--title)
// is required; a criterion-free rule would float the NEXT window attach
// of any class, which is never what you want.

import { defineCommand, option } from "@bunli/core";
import { z } from "zod";
import { spawnOnce } from "../lib/spawn";

export default defineCommand({
    name: "spawn" as const,
    description:
        "Spawn a client with a one-off hlwm rule (floating/centered/tag options). "
        + "Args after -- : <command> [args...]",
    options: {
        class: option(z.string().optional(), {
            description: "WM_CLASS match criterion", short: "c",
        }),
        instance: option(z.string().optional(), {
            description: "WM_INSTANCE match criterion", short: "i",
        }),
        title: option(z.string().optional(), {
            description: "window title match criterion", short: "t",
        }),
        tag: option(z.string().optional(), {
            description: "tag NAME to place the window on", short: "a",
        }),
        floating: option(z.enum(["on", "off"]).optional(), {
            description: "floating consequence (center via --center)", short: "f",
        }),
        switchtag: option(z.enum(["on", "off"]).optional(), {
            description: "follow the window to its tag", short: "s",
        }),
        focus: option(z.coerce.boolean().default(false), {
            description: "focus the new client", short: "F",
        }),
        center: option(z.coerce.boolean().default(false), {
            description:
                "float + focus + follow + center the window (guard-dialog preset)", short: "C",
        }),
        cmd: option(z.string().min(1).optional(), {
            description:
                "spawn via shell from a STRING (use when the command has flag-like args; '--' positional can't shield dash tokens)",
        }),
    },
    handler: async ({ flags, positional }) => {
        const [cmd = "", ...args] = positional;
        if (flags.cmd && (cmd !== "" || args.length > 0)) {
            throw new Error(
                "Usage: polyframes spawn [--flags] <command> [args...] — "
                + "or polyframes spawn --cmd '<shell command>' — not both",
            );
        }
        if (!flags.cmd && !cmd) {
            throw new Error("Usage: polyframes spawn [--flags] -- <command> [args...]");
        }
        await spawnOnce(cmd, args, {
            cls: flags.class,
            instance: flags.instance,
            title: flags.title,
            tag: flags.tag,
            floating: flags.floating,
            switchtag: flags.switchtag,
            focus: flags.focus,
            center: flags.center,
            cmdString: flags.cmd,
        });
    },
});
