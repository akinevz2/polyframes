// src/lib/actions.ts — on-click handlers (ports of the polywins.sh
// click functions + polyframes-toggle). All async; every invocation
// re-queries fresh WM state.

import { execFile, spawn, type StdioOptions } from "node:child_process";
import { openSync } from "node:fs";
import { promisify } from "node:util";
import * as hc from "./hc";
import { getClients, type Client } from "./clients";
import { frameSelection } from "./frames";
import { ui } from "./debug";
import { selfCommand } from "./self";
import { labelOffsetPx } from "./barlabel";

const execFileP = promisify(execFile);

// SETTINGS (kept in sync with render.ts defaults).
export const SETTINGS = {
    char_limit: 20,
    max_windows: 15,
    forbidden_classes: "Polybar Conky Gmrun",
};

/** This binary's own absolute path — the double-click switcher, the
 *  tag/hidden menus and the window-operations+tile/center helpers are
 *  INVOKED VIA IT as subcommands (`polyframes switcher-menu ...`,
 *  `polyframes window-menu ...`, ...), which also keeps the dislike
 *  double-click detection findable via pgrep. */
const SELF = selfCommand();
const LOG_PATH = "/tmp/polyframes.log";

/**
 * The group's members, rebuilt fresh on every invocation — the same
 * source of truth the renderer uses. Port of frame_clients().
 */
export async function frameClients(frame: string, cls: string): Promise<Client[]> {
    const clients = await getClients();
    const members = clients.filter((c) => c.cls === cls && c.frame === frame);
    ui("frameClients(frame=%s, cls=%s) -> %d members: %j",
        frame, cls, members.length, members.map((c) => c.wid));
    return members;
}

export async function getFocusedWid(): Promise<string> {
    return (await hc.attr("clients.focus.winid")) ?? "";
}

/**
 * Prune an empty focused frame: if the tag has more than one frame
 * and the FOCUSED frame holds zero clients, remove it. Checks the
 * focused frame (not the window's parent_frame) because minimized
 * windows lose their parent_frame attribute — it reads as missing.
 */
async function removeEmptyFrame(): Promise<void> {
    const frameCount = Number(
        (await hc.attr("tags.focus.frame_count")) ?? "1");
    if (frameCount <= 1) return;
    const clients = Number(
        (await hc.attr("tags.focus.tiling.focused_frame.client_count"))
        ?? "1");
    if (clients < 1) {
        ui("removeEmptyFrame: focused frame empty -> remove");
        await hc.remove();
    }
}

/**
 * Rofi dmenu of one group's windows; selecting an entry focuses it.
 * FIXES the shell bug: pairs were built with command substitution that
 * stripped trailing newlines, collapsing all pairs onto one line so
 * the wid lookup matched garbage. Here pairs are array elements joined
 * with explicit "\n" — each display string maps to exactly one wid.
 */
export async function switcher(frame: string, cls: string): Promise<void> {
    ui("switcher: frame=%s cls=%s", frame, cls);

    // Double-click semantics: if a switcher rofi is already running for
    // THIS group (same frame + class), dismiss it and focus the frame's
    // currently visible window instead of re-opening the menu.
    // Detection uses pgrep -f on the wrapper path + frame + class, so a
    // switcher opened over another group is left alone.
    const pid = await findSwitcherPid(frame, cls);
    if (pid) {
        ui("switcher: already running for this group (pid %d) -> dismiss + focus visible", pid);
        try {
            process.kill(pid, "SIGTERM");
        } catch (err) {
            ui("switcher: kill pid %d failed: %s", pid, (err as Error).message);
        }
        const vis = await frameSelection(frame);
        const active = await getFocusedWid();
        // The group's visible window is the frame's selected client —
        // but only when it belongs to this group's class. In a
        // mixed-class frame the selection can be another group's
        // window; then this group has no visible window and the click
        // is a no-op (the menu was just dismissed).
        const visInGroup = vis && (await frameClients(frame, cls))
            .some((c) => c.wid === vis);
        if (visInGroup && vis === active) {
            // The group's visible window is already focused: minimize it.
            ui("switcher: group's visible %s is already focused -> minimize", vis);
            await dismiss(vis!);
        } else if (visInGroup) {
            ui("switcher: focusing group's visible window %s", vis);
            await hc.jumpto(vis!);
        } else {
            ui("switcher: frame's selection %s not in group (%s) -> nothing to focus",
                vis ?? "none", cls);
        }
        return;
    }

    const members = await frameClients(frame, cls);
    if (members.length === 0) {
        ui("switcher: no members, aborting");
        return;
    }

    // Build display strings. Duplicate titles are intentionally NOT
    // disambiguated: the list is in WM order, so the user picks by
    // position (frame-relative index). Selection is resolved by row
    // index, never by matching the display text.
    const pairs: { disp: string; wid: string }[] = []; // { disp, wid }
    for (const c of members) {
        const ind = c.min ? " [min]" : c.flt ? " [flt]" : "";
        pairs.push({ disp: `${c.ttl || c.cls}${ind}`, wid: c.wid });
    }

    // Pre-select the focused window's row with a "-> " prefix.
    const activeWid = await getFocusedWid();
    const selRow = pairs.findIndex((p) => p.wid === activeWid);

    const maxlen = Math.max(
        20,
        ...pairs.map((p) => (p.disp.length + 3 > 20 ? p.disp.length + 3 : 20)),
    );
    const widthEm = Math.floor((maxlen * 62) / 100) + 5;

    // Launch the shell wrapper DETACHED, fire-and-forget. The wrapper
    // builds the menu from hlwm itself, feeds rofi from a temp file
    // (guaranteed EOF — a never-EOFing stdin pipe from this long-lived
    // process leaves rofi windowless while holding the keyboard grab,
    // freezing the WM), and executes the focus change itself. No output
    // is expected back.
    // Launch the menu DETACHED, fire-and-forget. The menu builds the
    // rows from hlwm itself and feeds rofi from pre-closed stdin
    // (guaranteed EOF — a never-EOFing stdin pipe from this long-lived
    // process leaves rofi windowless while holding the keyboard grab,
    // freezing the WM), and executes the focus change itself. No output
    // is expected back. The menu anchors under THIS group's label in
    // the bar (the clicked label's pixel offset from the bar's center).
    // ALL args travel as =form options: bunli consumes dash-prefixed
    // positionals (a hidden group's selrow is -1 → the argv shifted
    // and the rofi theme got `width: 0x40003em` — the rofi error).
    const xoffset = await labelOffsetPx({ frame, cls });
    spawnDetached(SELF, [
        "switcher-menu",
        `--cls=${cls}`,
        `--frame=${frame}`,
        `--selrow=${selRow}`,
        `--width=${widthEm}`,
        `--wids=${pairs.map((p) => p.wid).join(",")}`,
        `--xoffset=${xoffset}`,
    ], { toLog: true });
}

/**
 * Find a running switcher-menu process launched for the given
 * frame+class group, via pgrep -f. The command is invoked as:
 *   polyframes switcher-menu <frame> <cls> <selRow> <widthEm> <wid>...
 * so matching the self path + subcommand + frame + class makes the
 * check group-specific; a switcher over another group won't match.
 * @returns pid or null
 */
async function findSwitcherPid(frame: string, cls: string): Promise<number | null> {
    try {
        const { stdout } = await execFileP("pgrep", [
            "-f",
            `${SELF} switcher-menu ${frame} ${cls}`,
        ]);
        const pid = Number.parseInt(stdout.trim().split("\n")[0], 10);
        return Number.isInteger(pid) ? pid : null;
    } catch {
        return null; // no match (pgrep exits 1) or pgrep missing
    }
}

/**
 * Scroll wheel over a window's label (identified by wid; its
 * frame/class group membership is resolved live at click time).
 *
 * ESCALATION LADDER (solo group, window focused) — scroll UP steps up,
 * scroll DOWN steps down:
 *   tiled  -> floating -> maximized -> minimized (up)
 *   minimized <- floating <- maximized <- tiled            (down)
 *   up:   tiled = float it; floating = hc_maximize; maximized =
 *         minimize (the max-tag janitor tidies the emptied tag)
 *   down: maximized = hc_unmaximize; floating = PLAIN unfloat
 *         (floating off — deliberately NOT the left-click/hc_tile
 *         re-tile semantics); tiled = minimize (frame kept)
 *
 * Unfocused group (any shape):
 *   up   -> focus its representative first (solo: raise + jumpto;
 *           multi: focus the frame's selected client) — only scroll
 *           up focuses
 *   down -> the tag switcher, WITHOUT focusing anything
 *
 * Minimized solo group:
 *   up -> jumpto it (unminimize + focus); down -> tag switcher
 *
 * Multi-member group, focused: cycle focus previous/next within the
 * group, wraparound, including minimized members.
 */
export async function scrollFocus(wid: string, dir: "up" | "down"): Promise<void> {
    ui("scrollFocus: wid=%s dir=%s", wid, dir);
    // Resolve the window's frame/class fresh at click time — the bar
    // label only carried the representative wid, so group membership
    // reflects the CURRENT layout, not the one at render time.
    const clients = await getClients();
    const row = clients.find((c) => c.wid === wid);
    if (!row) {
        ui("scrollFocus: wid %s vanished, aborting", wid);
        return;
    }
    const members = await frameClients(row.frame, row.cls);
    if (members.length === 0) {
        ui("scrollFocus: no members, aborting");
        return;
    }

    const unminimized = members.filter((c) => !c.min);
    const active = await getFocusedWid();

    // Solo minimized window (minflt group: frame "-1", one member):
    // up -> jumpto (unminimize + focus); down -> tag switcher
    // (rofi_tags).
    if (members.length === 1 && members[0].min) {
        const wid = members[0].wid;
        if (dir === "up") {
            ui("scrollFocus: minimized %s up -> unminimize + jumpto", wid);
            // Original shell port called attr(path, false) — attr only
            // READS, so the explicit unminimize never happened (jumpto
            // masked it). Set it properly here.
            await hc.setAttr(`clients.${wid}.minimized`, "false");
            await hc.jumpto(wid);
        } else {
            ui("scrollFocus: minimized %s down -> tag switcher", wid);
            spawnDetached(SELF, ["tags"], { toLog: true });
        }
        return;
    }

    // Group with exactly one unminimized member (the visible rep).
    // Focused -> the escalation ladder; unfocused -> up: raise+jumpto,
    // down: tag switcher (no focus).
    if (members.length === 1 && unminimized.length === 1) {
        const m = unminimized[0];
        const wid = m.wid;
        if (wid === active) {
            // Ladder state: maximized (on a "<...>-max" tag) > floating
            // > tiled.
            const tag = (await hc.attr(`clients.${wid}.tag`)) ?? "";
            if (dir === "up") {
                if (tag.endsWith("-max")) {
                    ui("scrollFocus: solo %s up (maximized) -> minimize", wid);
                    await hc.setAttr(`clients.${wid}.minimized`, "true");
                } else if (m.flt) {
                    ui("scrollFocus: solo %s up (floating) -> maximize", wid);
                    spawnDetached(`${process.env.HOME}/.local/bin/hc_maximize`, [], { toLog: true });
                } else {
                    // Float + center to frame, under a lock so both
                    // land in one motion (no intermediate paint of the
                    // uncentered float). The vacated frame is
                    // deliberately LEFT in place even when this was
                    // its only client — hlwm never auto-removes frames
                    // and nothing here removes it; the window centers
                    // within the frame's content geometry (hc_center's
                    // frame mode), not the monitor.
                    ui("scrollFocus: solo %s up (tiled) -> float + center to frame", wid);
                    await hc.lock();
                    try {
                        await hc.setAttr(`clients.${wid}.floating`, "true");
                        await runHelper(`${process.env.HOME}/.local/bin/hc_center`, ["frame"]);
                    } finally {
                        await hc.unlock();
                    }
                }
            } else {
                if (tag.endsWith("-max")) {
                    ui("scrollFocus: solo %s down (maximized) -> unmaximize", wid);
                    spawnDetached(`${process.env.HOME}/.local/bin/hc_unmaximize`, [], { toLog: true });
                } else if (m.flt) {
                    // PLAIN unfloat — deliberately not the left-click
                    // hc_tile re-tile semantics.
                    ui("scrollFocus: solo %s down (floating) -> unfloat", wid);
                    await hc.setAttr(`clients.${wid}.floating`, "false");
                } else {
                    ui("scrollFocus: solo %s down (tiled) -> minimize (keep frame)", wid);
                    await hc.setAttr(`clients.${wid}.minimized`, "true");
                }
            }
            return;
        }
        if (dir === "down") {
            ui("scrollFocus: solo %s down (unfocused, visible) -> raise + jumpto", wid);
            await hc.raise(wid);
            await hc.jumpto(wid);
            return;
        }
        ui("scrollFocus: solo %s up (unfocused) -> raise + jumpto", wid);
        await hc.raise(wid);
        await hc.jumpto(wid);
        return;
    }

    // Multi-member group. The styling matrix renders all-minimized
    // groups grey WITHOUT underline — those are the only groups whose
    // scroll-down opens the tag switcher; visible (grey-underlined or
    // plain) groups are FOCUSED on scroll-down in both directions.
    if (active && !members.some((m) => m.wid === active)) {
        const sel = (await frameSelection(row.frame)) ?? "";
        const rep = members.some((m) => m.wid === sel) ? sel : members[0].wid;
        if (members.every((m) => m.min)) {
            if (dir === "down") {
                ui("scrollFocus: inactive all-minimized group -> tag switcher (no focus)");
                spawnDetached(SELF, ["tags"], { toLog: true });
                return;
            }
            ui("scrollFocus: inactive all-minimized group up -> unminimize + focus %s", rep);
            await hc.setAttr(`clients.${rep}.minimized`, "false");
            await hc.jumpto(rep);
            await hc.raise(rep);
            return;
        }
        ui("scrollFocus: inactive group -> focus its representative %s first", rep);
        await hc.jumpto(rep);
        await hc.raise(rep);
        return;
    }

    // Cycle focus within the group (wraparound, including minimized
    // members) — scroll UP selects the NEXT window, scroll DOWN the
    // previous (the reversed order per the user's spec).
    const wids = members.map((c) => c.wid);

    // Position of the active window (0 = not found -> treat as "before first").
    let pos = 0;
    for (let i = 0; i < wids.length; i += 1) {
        if (wids[i] === active) {
            pos = i + 1;
            break;
        }
    }
    const n = wids.length;
    let target: string | undefined;
    if (dir === "up") {
        target = pos === 0 || pos >= n ? wids[0] : wids[pos];
    } else {
        target = pos <= 1 ? wids[n - 1] : wids[pos - 2];
    }
    if (target) {
        ui("scrollFocus: active=%s pos=%d of %d -> target=%s", active, pos, n, target);
        await hc.jumpto(target);
    } else {
        ui("scrollFocus: no target resolved (pos=%d n=%d)", pos, n);
    }
}

/**
 * Left click state machine (single-window entries) — standard desktop
 * "restore/step forward" semantics, one step at a time:
 *   minimized            -> unminimize (float state untouched)
 *   floating + focused    -> hc_tile, then unfloat (re-tile it)
 *   floating + unfocused  -> focus only (raise + jumpto)
 *   tiling + focused      -> float
 *   tiling + unfocused    -> focus (raise + jumpto)
 */
export async function toggleFocus(wid: string): Promise<void> {
    ui("toggleFocus: wid=%s", wid);
    await hc.lock();
    try {
        const min = (await hc.attr(`clients.${wid}.minimized`)) === "true";
        const flt =
            (await hc.attr(`clients.${wid}.floating_effectively`)) === "true";
        const active = await getFocusedWid();
        if (min && flt) {
            ui("toggleFocus: %s minimized -> unminimize", wid);
            await runHelper(SELF, ["tile", wid]);
            await hc.setAttr(`clients.${wid}.minimized`, "false");
            await hc.setAttr(`clients.${wid}.floating`, "false");
            await hc.jumpto(wid);
        } else if (flt && wid === active) {
            // Focused floating: re-tile it. hc_tile navigates to the
            // closest empty frame (or splits a new one) FIRST, then the
            // window un-floats into it — order matters, so runHelper
            // awaits it before the floating toggle. NOTE: hc.lock is
            // held here; hc_tile takes its own lock internally, but
            // hlwm locks are reference-counted per client connection,
            // and hc_tile runs in its own herbstclient process, so its
            // lock/unlock pair is independent and cannot deadlock.
            ui("toggleFocus: %s focused floating -> unfloat", wid);
            await hc.setAttr(`clients.${wid}.floating`, "false");
            await hc.jumpto(wid);
        } else if (flt) {
            ui("toggleFocus: %s unfocused floating -> focus only", wid);
            await hc.jumpto(wid);
            await hc.raise(wid);
        } else if (wid === active) {
            ui("toggleFocus: %s focused tiling -> float", wid);
            await hc.setAttr(`clients.${wid}.floating`, "true");
            await hc.raise(wid);
        } else {
            ui("toggleFocus: %s unfocused -> focus", wid);
            await hc.jumpto(wid);
            await hc.raise(wid);
        }
    } finally {
        await hc.unlock();
    }
}

export async function closeWindow(wid: string): Promise<void> {
    ui("close: wid=%s", wid);
    await hc.close(wid);
}

/**
 * Spawn a process fully detached: no stdin/stdout/stderr ties to this
 * process, own session. The child's lifetime is independent of ours —
 * used for every rofi-spawning helper so a slow/hung rofi can never
 * wedge this process (and through it, the bar).
 *
 * NOTE: intentionally NOT awaitable.
 */
export function spawnDetached(cmd: string, args: string[], opts?: { toLog?: boolean }): void {
    // Strip WAYLAND_DISPLAY: WSLg's socket makes dual-backend apps
    // (rofi) pick Wayland and abort with "requires the layer shell
    // protocol" — even when the click arrived outside the shim.
    const { WAYLAND_DISPLAY, ...rest } = process.env;
    // toLog: route the child's stdout/stderr to the debug log instead
    // of /dev/null — rofi -dmenu DIES (rc=1, silently) when its stdout
    // is /dev/null, so every rofi-bearing child must log.
    const stdio: StdioOptions = opts?.toLog
        ? ["ignore", openSync(LOG_PATH, "a"), openSync(LOG_PATH, "a")]
        : "ignore";
    const child = spawn(cmd, args, {
        env: { ...rest, DISPLAY: process.env.DISPLAY || "localhost:0.0" },
        stdio,
        detached: true,
    });
    child.unref();
    child.on("error", (err) => ui("spawnDetached %s failed: %s", cmd, err.message));
}

/**
 * Run a helper script to completion and await its exit. Use this (not
 * spawnDetached) when subsequent WM state changes must happen AFTER
 * the helper finishes.
 */
export async function runHelper(cmd: string, args: string[]): Promise<{ exitCode: number; stdout: string; stderr: string }> {
    try {
        const r = (await execFileP(cmd, args, {
            env: { ...process.env, DISPLAY: process.env.DISPLAY || "localhost:0.0" },
        })) as { stdout: string; stderr: string; signal: string | null };
        const { stdout, stderr, signal } = r;
        const exitCode = signal === null ? 0 : 1;
        return { exitCode, stdout, stderr };
    } catch (err) {
        ui("runHelper %s failed: %s", cmd, err);
        return Promise.reject({ exitCode: (err as { code?: number }).code || 1, err });
    }
}

/**
 * Left-click state machine for a single-window entry.
 *   tiling (any focus)   -> float the window
 *   floating + focused   -> minimize
 *   floating + unfocused -> jumpto + raise
 *   minimized            -> unminimize; if its frame still has clients,
 *                           unfloat (join the tiling layout); if the
 *                           frame is empty, keep floating and center
 *                           the window (current size) in the frame.
 */
export async function toggle(wid: string): Promise<void> {
    ui("toggle: wid=%s", wid);
    await hc.lock();
    try {
        const min = (await hc.attr(`clients.${wid}.minimized`)) === "true";
        const flt =
            (await hc.attr(`clients.${wid}.floating_effectively`)) === "true";
        const foc = (await hc.attr("clients.focus.winid")) ?? "";
        ui("toggle: wid=%s min=%s flt=%s foc=%s", wid, min, flt, foc);

        if (min) {
            await unminimizeIntoFrame(wid);
        } else if (flt && wid !== foc) {
            ui("toggle: %s floating unfocused -> jumpto+raise", wid);
            await hc.jumpto(wid);
            await hc.raise(wid);
        } else if (flt) {
            ui("toggle: %s focused floating -> minimize", wid);
            await hc.setAttr(`clients.${wid}.minimized`, "true");
        } else {
            ui("toggle: %s tiling -> float", wid);
            await hc.setAttr(`clients.${wid}.floating`, "true");
            await hc.raise(wid);
        }
    } finally {
        await hc.unlock();
    }
}

/**
 * Unminimize a window into its frame. If the frame still holds other
 * clients, unfloat it (tile). If the frame is empty, keep it floating
 * and center its CURRENT size within the frame's content_geometry.
 */
export async function unminimizeIntoFrame(wid: string): Promise<void> {
    ui("unminimizeIntoFrame: wid=%s", wid);
    await hc.lock();
    const frame = (await hc.attr(`clients.${wid}.parent_frame.index`)) ?? "";
    const wids = await hc.listClients(
        frame === "" ? {} : { frame },
    );
    const others = wids.filter((w) => w !== wid);
    if (others.length > 0) {
        ui("unminimizeIntoFrame: frame %j has %d other clients -> tile", frame, others.length);
        await hc.setAttr(`clients.${wid}.floating`, "false");
        await hc.setAttr(`clients.${wid}.minimized`, "false");
        await hc.jumpto(wid);
        await hc.raise(wid);
        await hc.unlock();
        return;
    }
    // Empty frame: unminimize, stay floating, center current size.
    // Routing through `center --wid` (the hc_center implementation):
    // own-parent-frame centering, same order as before — center first,
    // then focus/raise.
    ui("unminimizeIntoFrame: frame %j empty -> center floating", frame);
    await hc.setAttr(`clients.${wid}.floating`, "true");
    await hc.setAttr(`clients.${wid}.minimized`, "false");
    await runHelper(SELF, ["center", "--wid", wid]);
    await hc.jumpto(wid);
    await hc.raise(wid);
    await hc.unlock();
}

/**
 * Middle click: minimize non-minimized windows, unminimize
 * already-minimized windows and center them appropriately.
 */
export async function dismiss(wid: string): Promise<void> {
    ui("dismiss: wid=%s", wid);
    const min = (await hc.attr(`clients.${wid}.minimized`)) === "true";
    const flt = (await hc.attr(`clients.${wid}.floating`)) === "true";

    if (min) {
        // Unminimize: restore and center
        ui("dismiss: %s minimized -> unminimize", wid);
        await hc.setAttr(`clients.${wid}.minimized`, "false");
        await hc.setAttr(`clients.${wid}.floating`, "true");
        if (flt) {
            await runHelper(SELF, ["center", "root"]);
        }
        await hc.jumpto(wid);
        return;
    }

    const parentIndex = await hc.attr(`clients.${wid}.parent_frame.index`);
    const frameClients = Number(
        (await hc.attr("tags.focus.curframe_wcount")) ?? "1");
    const active = await getFocusedWid();
    ui("dismiss: parentIndex=%j frameClients=%d active=%s", parentIndex, frameClients, active);

    // If tiling and focused: simply minimize
    if (flt && wid === active) {
        ui("dismiss: %s tiling and focused -> minimize", wid);
        await hc.setAttr(`clients.${wid}.minimized`, "true");
        return;
    }

    // If tiling and NOT focused: remove parent frame if it will be
    // empty after minimization
    if (!flt) {
        const frameCount = Number(
            (await hc.attr("tags.focus.frame_count")) ?? "1");
        ui("dismiss: %s tiling and NOT focused -> check frame removal (count=%d)", wid, frameCount);

        // Check if frameCount is <= 1 - bail to prevent removing last frame
        if (frameCount <= 1) {
            ui("dismiss: %s frameCount <= 1, cannot remove", wid);
            await hc.setAttr(`clients.${wid}.minimized`, "true");
            return;
        }

        await hc.jumpto(wid);

        // Check if the parent frame is now empty (wcount < 1)
        const newFrameClients = Number(
            (await hc.attr("tags.focus.curframe_wcount")) ?? "1");

        // Minimize the window, then check if the frame becomes empty
        await hc.setAttr(`clients.${wid}.minimized`, "true");

        // Remove the frame if it's empty and not the last frame
        try {
            if (newFrameClients <= 1) {
                ui("dismiss: %s frame is now empty (wcount=%d) -> remove it", wid, newFrameClients);
                await hc.lock();
                await hc.remove();
            }
            if (wid !== active) await hc.jumpto(active);
        } finally {
            await hc.unlock();
        }

        ui("dismiss: %s frame not empty after minimization (wcount=%d)", wid, newFrameClients);
        return;
    }

    await hc.setAttr(`clients.${wid}.minimized`, "true");
}

/**
 * Middle click: launch the hc_menu rofi script for this window.
 * hc_menu resolves the visible client itself when no wid is given,
 * but we always pass the wid so the menu operates on exactly the
 * window whose title the bar label shows.
 */
export async function menu(wid: string): Promise<void> {
    ui("menu: wid=%s", wid);
    // The window-menu anchors under the clicked label: the wid's
    // group's label offset from the bar's center.
    const xoffset = await labelOffsetPx({ wid });
    spawnDetached(SELF, ["window-menu", String(wid), `--xoffset=${xoffset}`], { toLog: true });
}
