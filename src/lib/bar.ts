// src/lib/bar.ts — the bar-line heart: one print + the daemon loops.
// Shared by the bare-daemon entry, `--once`, and the `bar` command.

import { spawn } from "node:child_process";
import { createHash } from "node:crypto";
import * as hc from "./hc";
import { getClients } from "./clients";
import { groupClients } from "./groups";
import { render } from "./render";
import { selfCommand } from "./self";
import { ui } from "./debug";

export async function printBar(): Promise<void> {
    ui("printBar: start");
    const clients = await getClients();
    const activeWid = (await hc.attr("clients.focus.winid")) ?? "";
    // The focused frame's flat index drives the current-frame group
    // styling (gold underline + yellow text for its multi-window
    // groups).
    const currentFrame = (await hc.attr("tags.focus.tiling.focused_frame.index")) ?? "";
    ui("printBar: activeWid=%s currentFrame=%j", activeWid || "(none)", currentFrame);
    const groups = await groupClients(clients, activeWid);
    const bar = render(groups, selfCommand(), {}, currentFrame);
    ui("printBar: writing %d-byte bar line", bar.length);
    process.stdout.write(bar + "\n");
}

/**
 * Hook listener: regenerate on hlwm hooks (instant updates for focus,
 * titles, tags, urgent). Frame splits/removals emit no hook in hlwm
 * 0.9.5 — the poll loop covers those. quit_panel/reload terminate us.
 */
export function startHookListener(): { kill(): void } {
    const child = spawn("herbstclient", ["--idle"], {
        env: { ...process.env, DISPLAY: process.env.DISPLAY || "localhost:0.0" },
        stdio: ["ignore", "pipe", "ignore"],
    });
    ui("hookListener: started (pid %d)", child.pid);
    let buf = "";
    child.stdout.on("data", (chunk) => {
        buf += chunk.toString();
        let idx: number;
        while ((idx = buf.indexOf("\n")) !== -1) {
            const hook = buf.slice(0, idx).trim();
            buf = buf.slice(idx + 1);
            if (!hook) continue;
            ui("hook: %s", hook);
            if (hook === "quit_panel") {
                ui("hook: quit_panel -> exiting");
                child.kill();
                process.exit(0);
            } else if (hook === "reload") {
                ui("hook: reload -> exiting");
                process.exit(0);
            } else {
                void printBar().catch(() => { });
            }
        }
    });
    child.on("error", (err) => ui("hook listener error: %s", err.message));
    child.on("exit", (code) => ui("hook listener exited (code %s)", code));
    return {
        kill: () => child.kill(),
    };
}

/**
 * Layout poll: regenerate only when the frame tree signature changes
 * (split, remove, resize, layout change). The dump is hashed, not
 * parsed. Returns a stop function (used by tests).
 */
export function startLayoutPoll(intervalMs = 1000): () => void {
    let sig = "";
    ui("layoutPoll: started (interval %dms)", intervalMs);
    const timer = setInterval(async () => {
        const d = await hc.dump();
        const newSig = d === null ? "" : createHash("md5").update(d).digest("hex");
        if (newSig !== sig) {
            ui("layoutPoll: signature changed (%s -> %s), regenerating",
                sig.slice(0, 8) || "(none)", newSig.slice(0, 8) || "(none)");
            sig = newSig;
            await printBar().catch(() => { });
        }
    }, intervalMs);
    return () => clearInterval(timer);
}

/** Daemon mode: print the bar, then keep it fresh. Listeners keep the
 *  event loop alive; polybar kills us on quit_panel/reload. */
export async function runDaemon(): Promise<void> {
    ui("daemon: bar + hook listener + layout poll");
    await printBar();
    startHookListener();
    startLayoutPoll();
}
