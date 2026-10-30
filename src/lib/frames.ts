// src/lib/frames.ts — port of hc_get-frame-selection.
// Prints the winid of a frame's currently selected (visible) client.

import { attr, listClients } from "./hc";
import { frames as dbg } from "./debug";

/**
 * Convert a FLAT frame index ("0", "00", "010") to the dotted object
 * path segment ("0", "0.0", "0.1.0"). Each digit is one child choice;
 * the object path inserts a dot between every digit.
 */
export function flatToDotted(flat: string): string {
    const dotted = String(flat)
        .split("")
        .filter((d) => /\d/.test(d))
        .join(".");
    dbg("flatToDotted(%j) -> %j", flat, dotted);
    return dotted;
}

/**
 * Frame selection lookup.
 *
 * Semantics (verified against hlwm):
 *  - flatToDotted is used ONLY for the attr path: "00" -> root.0.0
 *    (root.00 does not exist). "0" stays "0" — a real index, never
 *    normalized to "".
 *  - list_clients --frame expects the FLAT index verbatim; an object
 *    path is silently ignored there and returns ALL tag clients.
 *  - No argument -> tags.focus.tiling.root.selection (the root frame
 *    itself, only meaningful in an unsplit layout).
 *
 * @param flatIndex flat frame index, e.g. "0", "00", "010"
 * @returns winid, or null when the frame is empty / the WM is
 *   unreachable.
 */
export async function frameSelection(flatIndex?: string): Promise<string | null> {
    const idx = flatIndex === undefined ? "" : String(flatIndex);
    const dotted = idx === "" ? "" : flatToDotted(idx);
    const path = dotted === ""
        ? "tags.focus.tiling.root.selection"
        : `tags.focus.tiling.root.${dotted}.selection`;
    dbg("frameSelection(%j): attr path=%s", idx, path);
    const sel = await attr(path);
    if (sel === null) {
        dbg("frameSelection(%j): no selection attr (empty frame?) -> null", idx);
        return null;
    }
    const selNum = Number.parseInt(sel, 10);
    if (!Number.isInteger(selNum)) {
        dbg("frameSelection(%j): non-integer selection %j -> null", idx, sel);
        return null;
    }
    const wids = await listClients({ frame: idx });
    const win = wids[selNum];
    dbg("frameSelection(%j): selection=%d of %d clients -> %s",
        idx, selNum, wids.length, win ?? "null (out of range)");
    return win === undefined ? null : win;
}
