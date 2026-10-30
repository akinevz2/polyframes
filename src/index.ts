#!/usr/bin/env bun
// src/index.ts — polyframes CLI (bunli 0.8.x + Bun 1.4+).
//
// Bare invocation is polybar's contract: `exec = ~/.local/bin/polyframes`
// gets NO arguments and must start the bar daemon (bar line + hook
// listener + layout poll). That branch is handled BEFORE bunli's arg
// parsing, which would otherwise show help on empty argv.
//
// Everything else goes through the bunli command tree; run
// `polyframes --help` for the full surface.

import { createCLI } from "@bunli/core";

import { runDaemon, printBar } from "./lib/bar";
import { setVerbose } from "./lib/debug";

import barCommand from "./commands/bar";
import switcherCommand from "./commands/switcher";
import scrollCommand from "./commands/scroll";
import toggleFocusCommand from "./commands/toggle-focus";
import toggleCommand from "./commands/toggle";
import closeCommand from "./commands/close";
import dismissCommand from "./commands/dismiss";
import menuCommand from "./commands/menu";
import { default as tagsCommand } from "./commands/tags";
import { default as hiddenCommand } from "./commands/hidden";
import { default as windowsCommand } from "./commands/windows";
import { default as launchCommand } from "./commands/launch";
import { default as switcherMenuCommand } from "./commands/switcher-menu";
import { default as windowMenuCommand } from "./commands/window-menu";
import { default as tileCommand } from "./commands/tile";
import { default as centerCommand } from "./commands/center";
import { default as spawnCommand } from "./commands/spawn";
import { default as fitCommand } from "./commands/fit";
import { default as resizeCommand } from "./commands/resize";

async function main(): Promise<void> {
    const argv = process.argv.slice(2);

    // Polybar invokes the binary with no args. Honor `--once` (the old
    // shell-era one-shot flag) the same way. `-v` enables all debug
    // layers via argv + env in debug.ts.
    if (argv.length === 0) {
        await runDaemon();
        return;
    }
    if (argv.includes("-v") || argv.includes("--verbose")) {
        argv.splice(argv.indexOf("-v") !== -1 ? argv.indexOf("-v") : argv.indexOf("--verbose"), 1);
        setVerbose(true);
    }
    if (argv.length === 0) {
        // Only -v given: fall back to a one-shot bar print.
        await printBar();
        return;
    }
    if (argv[0] === "--once") {
        await printBar();
        return;
    }

    // bunli's createCLI() always auto-imports bunli.config.ts from the
    // current directory. A compiled binary cannot runtime-resolve the
    // config's @bunli/core import (node_modules are not carried in the
    // executable), so move out of the cwd for it and rely on the inline
    // override. The generated-types import inside createCLI() is
    // non-fatal (debug-logged), so skipping discovery is safe.
    if (!/(^|\/)bun(\.[a-z0-9]+)?$/.test(process.execPath ?? "")) {
        process.chdir("/");
    }

    const cli = await createCLI({
        name: "polyframes",
        version: "2.0.0",
        description:
            "Polybar window-list renderer for herbstluftwm. Bare invocation starts the bar daemon.",
    });

    cli.command(barCommand);
    cli.command(switcherCommand);
    cli.command(scrollCommand);
    cli.command(toggleFocusCommand);
    cli.command(toggleCommand);
    cli.command(closeCommand);
    cli.command(dismissCommand);
    cli.command(menuCommand);
    // former dots herbst helpers, now managed here
    cli.command(tagsCommand);
    cli.command(hiddenCommand);
    cli.command(windowsCommand);
    cli.command(launchCommand);
    cli.command(switcherMenuCommand);
    cli.command(windowMenuCommand);
    cli.command(tileCommand);
    cli.command(centerCommand);
    cli.command(spawnCommand);
    cli.command(fitCommand);
    cli.command(resizeCommand);

    await cli.run();
}

main().catch((err) => {
    process.stderr.write(`${err && err.stack ? err.stack : err}\n`);
    process.exitCode = 1;
});
