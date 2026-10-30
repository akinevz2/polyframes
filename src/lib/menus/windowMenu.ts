// src/lib/menus/windowMenu.ts — the window-operations rofi menu for a
// hlwm client (port of herbst/.local/bin/hc_menu).
//
// Internal: actions.menu spawns this detached as
// `polyframes window-menu [<wid>]`. With a wid it operates on that
// client; without one it resolves the "visible" client of the focused
// frame — selection index S of frame index F means the (S+1)-th wid of
// `herbstclient list_clients --frame=<idx>`.
//
// Menu actions:
//   Tile           — disable floating (join the tiling layout) via
//                    polyframes' own tile subcommand (after hc_unmaximize)
//   Maximize       — move the window to tag "<current>-max"; delegated
//                    to the dots helper hc_maximize (stays external,
//                    shared with other dots scripts)
//   Minimize one   — minimize the target window (prunes an emptied frame)
//   Unminimize     — restore the target window
//   Minimize all   — minimize every window sharing the target's
//                    (frame, class) group
//   Focus          — change the target window's frame layout to "max"
//   Close          — close the target window

import * as hc from "../hc";
import { ui } from "../debug";
import { tile } from "../tile";
import { runRofiDmenu } from "./rofi";

const BIN_DIR = `${process.env.HOME}/.local/bin`;
const OPS_THEME = `${process.env.HOME}/.config/rofi/window-ops.rasi`;

/** Exec a dots helper script, awaiting completion (uses exit codes). */
async function dots(script: string, args: string[]): Promise<number> {
    const { execFile } = await import("node:child_process");
    const { promisify } = await import("node:util");
    const execFileP = promisify(execFile);
    try {
        await execFileP(`${BIN_DIR}/${script}`, args, {
            env: { ...process.env, DISPLAY: process.env.DISPLAY || "localhost:0.0" },
        });
        return 0;
    } catch (err) {
        ui("window-menu: %s %j failed: %s", script, args, err);
        return 1;
    }
}

/** Resolve the focused frame's visible client. */
async function resolveVisibleWid(): Promise<string | null> {
    const sel = await hc.attr("tags.focus.tiling.focused_frame.selection");
    const idx = (await hc.attr("tags.focus.tiling.focused_frame.index")) ?? "";
    if (sel === null) return null;
    const wids = await hc.listClients({ frame: idx });
    return wids[Number(sel)] ?? null;
}

export async function windowMenu(args: string[], xOffsetPx = 0): Promise<void> {
    let wid = args[0] ?? "";
    if (wid === "") {
        wid = (await resolveVisibleWid()) ?? "";
        if (wid === "") {
            ui("window-menu: no focused window");
            return;
        }
    }

    // Window state for menu filtering.
    const isInMaxFrame = await hc.attr(`clients.${wid}.parent_frame.algorithm`);
    const isMinimizedRaw = await hc.attr(`clients.${wid}.minimized`);
    const isMinimized = isMinimizedRaw === "true";
    // NOTE: the shell original compared against "1" here — hlwm reports
    // booleans as "true"/"false", so the Unminimize branch was
    // unreachable there; fixed in this port.

    const menu: string[] = ["Tile"];
    if (isInMaxFrame !== "max") menu.push("Focus");
    menu.push("Maximize");
    if (isMinimized) {
        menu.push("Unminimize");
    } else {
        menu.push("Minimize", "Minimize all");
    }
    menu.push("Close");

    const title = await hc.attr(`clients.${wid}.title`);
    const { stdout, status } = await runRofiDmenu(
        [
            "-dmenu", "-i", "-no-automatch", "-no-history",
            "-mesg", "Window Operations",
            "-theme", OPS_THEME,
            "-theme-str", "window { width: 24em; }",
            "-l", String(menu.length),
            "-p", title || "window",
        ],
        menu.map((m) => m + "\n").join(""),
        xOffsetPx,
    );
    if (status !== 0) {
        ui("window-menu: rofi failed/cancelled (status %s)", status);
        return;
    }
    const cmd = stdout.trim();
    if (cmd === "") return;

    // --- dispatch -------------------------------------------------------
    switch (cmd) {
        case "Tile":
            // Delegate: hc_unmaximize restores a maximized window to its
            // original spot first, then tile finds/creates the empty
            // frame and unfloats the window into it.
            await dots("hc_unmaximize", [wid]);
            await tile(wid);
            return;
        case "Maximize":
            // Reversible toggle: dedicated "<tag>-max" tag; the dots
            // helper owns the record/restore state machine.
            await dots("hc_maximize", [wid]);
            return;
        case "Minimize":
            if (isMinimized) {
                await hc.cmd("jumpto", wid);
                await hc.cmd("set_attr", `clients.${wid}.minimized`, "false");
            } else {
                await dots("hc_unmaximize", [wid]);
                await hc.cmd("jumpto", wid);
                await hc.cmd("set_attr", `clients.${wid}.minimized`, "true");
                // If the vacated frame has no more children, merge it
                // away. (Count read BEFORE minimizing detached the
                // frame association.)
                const cc = (await hc.attr(`clients.${wid}.parent_frame.client_count`)) ?? "1";
                if (cc === "0") await hc.cmd("remove");
            }
            return;
        case "Unminimize":
            await hc.cmd("jumpto", wid);
            await hc.cmd("set_attr", `clients.${wid}.minimized`, "false");
            return;
        case "Minimize all": {
            const frame = (await hc.attr(`clients.${wid}.parent_frame.index`)) ?? "";
            const cls = (await hc.attr(`clients.${wid}.class`)) ?? "";
            if (isMinimized) {
                // Unminimize the target only.
                await hc.cmd("jumpto", wid);
                await hc.cmd("set_attr", `clients.${wid}.minimized`, "false");
                return;
            }
            await dots("hc_unmaximize", [wid]);
            await hc.cmd("set_attr", `clients.${wid}.minimized`, "true");
            for (const w of await hc.listClients({ frame })) {
                if (w === wid) continue;
                const wcls = await hc.attr(`clients.${w}.class`);
                if (wcls === cls) await hc.cmd("set_attr", `clients.${w}.minimized`, "true");
            }
            const cc = (await hc.attr(`clients.${wid}.parent_frame.client_count`)) ?? "1";
            if (cc === "0") await hc.cmd("remove");
            return;
        }
        case "Focus":
            await hc.cmd("attr", `clients.${wid}.parent_frame.algorithm`, "max");
            return;
        case "Close":
            await hc.cmd("close", wid);
            return;
    }
}
