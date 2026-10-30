// src/lib/tile.ts — navigate to the closest empty frame, or create one
// (port of herbst/.local/bin/hc_tile; hangs off `polyframes tile [wid]`).
//
//   a) SWITCH to the window's own tag (callers hand over wids from any
//      tag — polybar's window list, the rofi menu — while the ranking,
//      the "stay put" guard and any split decision would otherwise be
//      made against the FOCUSED tag's layout, i.e. the wrong tree).
//      If an empty leaf frame exists there, focus the one whose flat
//      index shares the longest common prefix with the window's
//      parent_frame.index (closest by parent). No empty frame:
//   b) `split auto` the window's frame and focus the new empty child —
//      determined by MEASURING the children's client_count after the
//      split, not by assuming hlwm's 0/1 content/empty convention.
//
// Split suppression:
//   - explicit-wid calls whose window is TILED and is the ONLY client
//     of its frame stay put (no move, no split) — the
//     unmaximize-into-emptied-frame return path;
//   - a floating window always USES an empty frame found by the search
//     (bring + unfloat into it); splitting is only ever reached when
//     the search found no empty frame.
//
// Verified hlwm 0.9.5 semantics this port relies on:
//   - a MINIMIZED client has NO parent_frame (ranking ref degrades to
//     prefix 0 — still functional, tree-order);
//   - an UNMINIMIZED client re-attaches into the CURRENTLY-FOCUSED
//     frame of its tag (that is why the split branch unminimizes FIRST,
//     and focus/bring immediately after);
//   - curframe_wcount is 0 whenever a floating window is focused or the
//     focused frame's clients are minimized, so the "stay put" guard
//     only applies when NO wid was given (self-resolved focus).

import { execFile } from "node:child_process";
import { promisify } from "node:util";
import * as hc from "./hc";
import { ui } from "./debug";
import { flatToDotted } from "./frames";

/** Dotted object path prefix for an attr lookup of a leaf frame. */
function leafAttrPrefix(flat: string): string {
    const dotted = flatToDotted(flat);
    return dotted === "" ? "tags.focus.tiling.root" : `tags.focus.tiling.root.${dotted}`;
}

/** Depth-first collection of all leaf frames as flat indexes. A leaf is
 *  a frame node with no child frames; hlwm prints split nodes as
 *  "N children:" and leaf frames as "0 children." — any node whose
 *  object print lacks a "children" header is a leaf. */
async function collectLeaves(dotted: string, flat: string): Promise<string[]> {
    const path = dotted === "" ? "tags.focus.tiling.root" : `tags.focus.tiling.root.${dotted}`;
    const r = await hc.cmd("attr", path);
    if (r === null) return [];
    const m = r.stdout.match(/^(\d+) children:$/m);
    const count = m ? Number(m[1]) : 0;
    if (count > 0) {
        return [
            ...(await collectLeaves(`${dotted === "" ? "" : dotted + "."}0`, `${flat}0`)),
            ...(await collectLeaves(`${dotted === "" ? "" : dotted + "."}1`, `${flat}1`)),
        ];
    }
    return [flat];
}

/** Longest common prefix length of two flat indexes. */
function commonPrefixLen(a: string, b: string): number {
    let n = 0;
    while (n < a.length && a[n] === b[n]) n += 1;
    return n;
}

export async function tile(widArg?: string): Promise<void> {
    // Optional: window whose own tag is operated on and whose parent
    // frame ranks the empty frames. Without it the script stays on
    // tags.focus and the ranking falls back to prefix length 0.
    let wid = widArg ?? "";
    if (wid === "") {
        wid = (await hc.attr("clients.focus.winid")) ?? "";
    }
    ui("tile: wid=%s", wid || "(focused)");

    // Under one lock: find/split the destination frame and point the
    // focused frame at it. Released in a finally on every path.
    await hc.cmd("lock");
    try {
        if (wid !== "") {
            // Follow the WINDOW, not the focused tag: explicit-wid
            // callers hand over windows from any tag.
            let wtag = await hc.attr(`clients.${wid}.tag`);
            wtag = wtag?.replace(/"/g, "") ?? null;
            const focusTag = await hc.attr("tags.focus.name");
            if (wtag && wtag !== focusTag) {
                await hc.cmd("use", wtag);
            }
            // Un-hide now: a minimized client has no parent frame UNTIL
            // it is shown again, and hlwm re-attaches it into the
            // currently focused frame once unminimized (would otherwise
            // corrupt the ranking and the split-branch destination).
            // Idempotent if already visible.
            await hc.cmd("attr", `clients.${wid}.minimized`, "false");
        }

        // "Stay put" only applies to self-resolved, already-visible
        // calls (no argument): navigating away would strand the caller's
        // focus when the focused frame's client count is genuinely zero.
        // curframe_wcount is ALSO 0 when a FLOAT is focused — must not
        // short-circuit an explicit-wid call.
        if (widArg === undefined) {
            const empty = await hc.cmd("compare", "tags.focus.curframe_wcount", "=", "0");
            if (empty !== null) {
                ui("tile: self-resolved call with empty focused frame -> stay put");
                return;
            }
        }

        // Guard (a): explicit-wid call whose window is already TILED and
        // is the ONLY client of its frame — perfectly placed (the
        // unmaximize "returning home into the emptied frame" case). Do
        // not move it and NEVER split its frame.
        if (widArg !== undefined) {
            const wfloat = await hc.attr(`clients.${wid}.floating`);
            if (wfloat !== "true") {
                const mycc = (await hc.attr(`clients.${wid}.parent_frame.client_count`)) ?? "-1";
                if (mycc === "1") {
                    await hc.cmd("jumpto", wid);
                    await hc.cmd("attr", `clients.${wid}.floating`, "off");
                    ui("tile: %s is sole tiled client -> stay put", wid);
                    return;
                }
            }
        }

        // Reference frame for the closeness ranking (a minimized window
        // has no parent_frame; empty wid -> "" so the ranking still works).
        const frame = wid !== ""
            ? ((await hc.attr(`clients.${wid}.parent_frame.index`)) ?? "")
            : ((await hc.attr("tags.focus.tiling.focused_frame.index")) ?? "");

        const leaves = await collectLeaves("", "");

        // Empty leaves ranked by closeness (longest common prefix) to the
        // window's frame.
        let best = "";
        let bestScore = -1;
        for (const leaf of leaves) {
            const cc = (await hc.attr(`${leafAttrPrefix(leaf)}.client_count`)) ?? "0";
            if (cc === "0") {
                const score = commonPrefixLen(frame, leaf);
                if (score > bestScore) {
                    best = leaf;
                    bestScore = score;
                }
            }
        }
        ui("tile: leaves=%j empty best=%s (score %d)", leaves, best || "(none)", bestScore);

        if (best === "") {
            // No empty frame: split the window's OWN frame. Bring focuses
            // it (floating or not) so split auto divides exactly the
            // frame the window surfaced into, THEN capture the index,
            // THEN measure both children's client_count for the freshly
            // emptied slot.
            if (wid) await hc.cmd("bring", wid);
            const pre = (await hc.attr("tags.focus.tiling.focused_frame.index")) ?? "";
            await hc.cmd("split", "auto");
            for (const child of [`${pre}0`, `${pre}1`]) {
                const cc = (await hc.attr(`${leafAttrPrefix(child)}.client_count`)) ?? "-1";
                if (cc === "0") {
                    best = child;
                    break;
                }
            }
            if (best === "") best = `${pre}1`; // both populated: hlwm's convention
            ui("tile: split %s -> destination %s", pre, best);
        }

        // Point the focused frame at the destination: set the selection
        // attr on every split node from the ROOT down, one digit per
        // level (focus is resolved top-down; a deep write has no effect
        // until all ancestors point at it — the root's own selection
        // must be written too).
        let path = "tags.focus.tiling.root";
        for (const d of flatToDotted(best).split(".").filter(Boolean)) {
            await hc.cmd("attr", `${path}.selection`, d);
            path = `${path}.${d}`;
        }

        // Insert the window into the freshly-focused empty frame: bring
        // moves tiled windows into the focused frame and refocuses
        // floats; the unfloat then re-tiles a float into that frame.
        // Guard (b): an empty frame found by the search is USED; the
        // split branch is only reached when the search found none.
        if (wid) await hc.cmd("bring", wid);
        if (wid) await hc.cmd("jumpto", wid);
        await hc.cmd("attr", `clients.${wid}.floating`, "off");
    } finally {
        await hc.cmd("unlock");
    }
}
