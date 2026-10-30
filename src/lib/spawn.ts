// src/lib/spawn.ts — snake one-shot `herbstclient rule once` spawns
// (`polyframes spawn ...`).
//
// "rule once" fires for the NEXT matching window only, so the flow is:
// install the rule, THEN detach the command; hlwm applies the rule at
// attach time.
//
// hlwm 0.9.5 constraint: the `floating` consequence only takes
// on/off (no `center`), so --center does the centering itself: the rule
// floats+focuses the window, and after attach the new client is placed
// centered (decoration-aware, via the center.ts geometry math).

import * as hc from "./hc";
import { getClients } from "./clients";
import { placeCenteredIn } from "./center";
import { ui } from "./debug";
import { spawn as childSpawn } from "node:child_process";

/** Criteria the one-shot rule matches on. At least one is REQUIRED —
 *  a matcher-free rule would swallow the next window attach of any class. */
export interface SpawnMatch {
    cls?: string;
    instance?: string;
    title?: string;
}

export interface SpawnOnceOptions extends SpawnMatch {
    /** tag to place the window on (its NAME) */
    tag?: string;
    /** floating consequence (hlwm booleans only; center via `center`) */
    floating?: "on" | "off";
    /** follow the window to its tag */
    switchtag?: "on" | "off";
    /** focus the new client */
    focus?: boolean;
    /** float + focus + follow + center it (the guard-dialog preset) */
    center?: boolean;
    /** spawn via the shell from a full command STRING (needed when the
     *  command itself has flag-like arguments: bunli parses tokens
     *  after `--` too, so `-timeout 6` would be mis-consumed); runs as
     *  `sh -c <cmdString>`, detached in the usual way */
    cmdString?: string;
}

/**
 * Spawn `cmd args...` detached after installing a `rule once` rule for
 * the documented criteria/consequences. Fails soft: a rule install
 * failure never blocks the spawn itself.
 * Returns the newly attached wid when `center` resolved it (else "").
 */
export async function spawnOnce(
    cmd: string,
    args: string[],
    o: SpawnOnceOptions = {},
): Promise<string> {
    if (!cmd && !o.cmdString) throw new Error("spawn: no command given");
    if (!o.cls && !o.instance && !o.title) {
        throw new Error(
            "spawn: at least one of --class/--instance/--title is required "
            + "(a rule without criteria would float the next window attach of any class)",
        );
    }
    if (o.center && o.floating === "off") {
        throw new Error("spawn: --center implies floating; drop --floating off");
    }

    const rule = ["rule", "once"];
    if (o.cls) rule.push(`class=${o.cls}`);
    if (o.instance) rule.push(`instance=${o.instance}`);
    if (o.title) rule.push(`title=${o.title}`);
    const floating = o.center ? "on" : o.floating;
    if (floating) rule.push(`floating=${floating}`);
    if (o.center || o.focus) rule.push("focus=on");
    const switchtag = o.center ? "on" : o.switchtag;
    if (switchtag) rule.push(`switchtag=${switchtag}`);
    if (o.tag) rule.push(`tag=${o.tag}`);
    ui("spawn: rule %j for %s", rule, [cmd, ...args].join(" "));

    // Snapshot so the newly attached client can be identified even
    // while other windows come and go.
    const before = new Set((await getClients()).map((c) => c.wid));

    // Rule must exist BEFORE the window attaches; ignoring failure for
    // WM-unreachable (the window still spawns untiled).
    await hc.cmd(...rule);

    if (o.cmdString !== undefined) {
        spawnDetached("sh", ["-c", o.cmdString]);
    } else {
        spawnDetached(cmd, args);
    }

    if (!o.center) return "";

    // Poll for the new client (up to ~30s), then center it in the
    // focused frame. Failures here degrade to a plain floated window.
    for (let i = 0; i < 300; i += 1) {
        await new Promise((r) => setTimeout(r, 100));
        const now = await getClients();
        const fresh = now.find((c) => !before.has(c.wid));
        if (fresh) {
            // The client may still be performing its own initial
            // resize (Xaw sizing etc.) — wait until the geometry stops
            // moving before we stamp our centered one, or we end up
            // centering the 32x32 placeholder while the app grows it
            // back to +0+0.
            let last = { w: 0, h: 0 };
            let stable = 0;
            for (let n = 0; n < 40; n += 1) {
                const fg = await hc.attr(`clients.${fresh.wid}.floating_geometry`);
                const m = fg?.match(/^(\d+)x(\d+)/);
                const w = m ? Number(m[1]) : 0;
                const h = m ? Number(m[2]) : 0;
                if (w > 50 && h > 20 && w === last.w && h === last.h) {
                    stable += 1;
                    if (stable >= 2) break;
                } else {
                    stable = 0;
                }
                last = { w, h };
                await new Promise((r) => setTimeout(r, 100));
            }
            await placeCenteredIn(fresh.wid, "frame");
            await hc.jumpto(fresh.wid);
            await hc.raise(fresh.wid);
            return fresh.wid;
        }
    }
    ui("spawn: --center: no new client appeared within 30s, skipping centering");
    return "";
}

/**
 * Spawn a process fully detached: no stdin/stdout/stderr ties to this
 * process, own session. WSLg's WAYLAND_DISPLAY is stripped (dual-backend
 * apps would pick Wayland and abort) and DISPLAY is defaulted.
 */
export function spawnDetached(cmd: string, args: string[] = []): void {
    const { WAYLAND_DISPLAY, ...rest } = process.env;
    const child = childSpawn(cmd, args, {
        env: { ...rest, DISPLAY: process.env.DISPLAY || "localhost:0.0" },
        stdio: "ignore",
        detached: true,
    });
    child.unref();
    child.on("error", (err: Error) => ui("spawnDetached %s failed: %s", cmd, err.message));
}
