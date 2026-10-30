// src/lib/menus/switcherMenu.ts — rofi dmenu for one (frame, class)
// group (port of herbst/.local/bin/hc_switcher).
//
// Internal: actions.switcher spawns this detached as
// `polyframes switcher-menu <frame> <class> <selRow> <widthEm> <wid>...`
// and the menu lines are produced here, one title per wid, read FRESH
// from hlwm so the list matches what the bar showed. Indicators:
//   "-> " — the frame's VISIBLE (selected) client, i.e. the one whose
//           title the bar label shows (frame selection, independent of
//           global focus).
//   "*"   — the globally focused window (when different from visible).
//
// The chosen row index (0-based) maps back to the wid; the focus change
// is executed HERE (the caller is detached and never reads stdout).
// jumpto handles unminimize + raise implicitly; raise is kept for parity.

import * as hc from "../hc";
import { ui } from "../debug";
import { flatToDotted } from "../frames";
import { runRofiDmenu } from "./rofi";
import { toggleFocus } from "../actions";

const SWITCHER_THEME = `${process.env.HOME}/.config/rofi/window-switcher.rasi`;

export interface SwitcherMenuArgs {
    frame: string;
    cls: string;
    selrow?: number;
    width?: number;
    wids: string[];
    xOffsetPx?: number;
}

export async function switcherMenu(args: SwitcherMenuArgs): Promise<void> {
    const { frame, cls, selrow = -1, width = 30, wids, xOffsetPx = 0 } = args;
    if (!cls || wids.length === 0) {
        ui("switcher-menu: missing args (frame=%s cls=%s wids=%d)", frame, cls, wids.length);
        return;
    }

    // The frame's visible client: selection index S of frame <frame> is the
    // (S+1)-th wid of list_clients --frame=<idx>. The caller passes the wids
    // in exactly that order, so derive the visible row from hlwm directly.
    let visibleWid = "";
    const dotted = flatToDotted(frame);
    const selPath = dotted === ""
        ? "tags.focus.tiling.root.selection"
        : `tags.focus.tiling.root.${dotted}.selection`;
    const selIdx = await hc.attr(selPath);
    if (
        selIdx !== null && Number(selIdx) >= 0 && Number.isInteger(Number(selIdx))
        && Number(selIdx) < wids.length
    ) {
        visibleWid = wids[Number(selIdx)];
    }
    const focusedWid = await hc.attr("clients.focus.winid");

    // Build the menu lines from fresh hlwm state. Fall back to the
    // class name when the title is empty.
    const menuLines: string[] = [];
    for (const wid of wids) {
        const ttl = await hc.attr(`clients.${wid}.title`);
        const min = await hc.attr(`clients.${wid}.minimized`);
        const flt = await hc.attr(`clients.${wid}.floating_effectively`);
        let line = `${ttl || cls}`;
        if (min === "true") line += " [min]";
        else if (flt === "true") line += " [flt]";
        if (wid === visibleWid) line = `-> ${line}`;
        else if (wid === focusedWid) line = `* ${line}`;
        menuLines.push(line);
    }

    // -format i makes rofi print the selected ROW INDEX (-1 on cancel)
    // instead of the line text — duplicate titles in a group would
    // otherwise all match the first row in a text comparison.
    const { stdout, status } = await runRofiDmenu([
        "-dmenu", "-i", "-l", String(wids.length),
        "-format", "i",
        "-selected-row", String(selrow),
        "-theme", SWITCHER_THEME,
        "-theme-str", `window { width: ${width}em; }`,
        "-p", cls,
    ], menuLines.map((l) => l + "\n").join(""), xOffsetPx);

    if (status !== 0) {
        ui("switcher-menu: rofi failed/cancelled (status %s)", status);
        return;
    }
    const choice = stdout.trim();
    if (choice === "" || !Number.isInteger(Number(choice)) || Number(choice) < 0) {
        ui("switcher-menu: no choice (%j)", choice);
        return;
    }
    const target = wids[Number(choice)];
    if (!target) {
        ui("switcher-menu: choice %s out of range", choice);
        return;
    }
    ui("switcher-menu: chose %s (%s)", target, menuLines[Number(choice)]);
    // The switcher REPLICATES the single-window frame left-click
    // behaviours (the toggle-focus state machine): selecting an
    // inactive window brings it forward, selecting the active one
    // floats it, and so on — one selection semantics for both paths.
    // (Runs here — the caller is detached and never reads stdout.)
    await toggleFocus(target);
    // Emit the chosen wid (discarded when detached; handy for debugging).
    process.stdout.write(`${target}\n`);
}
