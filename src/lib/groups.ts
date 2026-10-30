// src/lib/groups.ts — port of polyframes-groups.
// Group every client on the focused tag into bar entries.
// Pure function over the clients array; frame-selection lookups are
// injectable (defaults to frames.ts).

import { frameSelection } from "./frames";
import { format as dbg, dir } from "./debug";
import type { Client } from "./clients";

export type GroupState = "min" | "flt" | "tiling";

export interface Group {
    /** flat frame index, "-1" for unframed */
    frame: string;
    /** window class */
    cls: string;
    /** representative wid (frame's selected client for tiled groups, else own wid) */
    rep: string;
    /** group holds the globally focused window */
    isActive: 0 | 1;
    /** group's class is the frame's visible (selected) client's class */
    isVisible: 0 | 1;
    /** windows sharing the group key */
    count: number;
    /** representative title (falls back to class) */
    title: string;
    state: GroupState;
}

/**
 * Group key for one client row (same rules as polyframes-groups):
 *   min=true or flt=true -> "minflt|<wid>"  (solo)
 *   frame === "-1"       -> "unframed|<wid>" (solo)
 *   else                 -> "frame|<frame>|<class>"
 */
export function keyOf(c: Client): string {
    if (c.min || c.flt) return `minflt|${c.wid}`;
    if (c.frame === "-1") return `unframed|${c.wid}`;
    return `frame|${c.frame}|${c.cls}`;
}

/**
 * @param clients WM order, never sorted
 * @param activeWid globally focused winid ("" if unknown)
 * @param selFn injectable frame-selection lookup (for testing)
 * @returns one group per key, first-wins dedup, in WM order. Rows with
 *   empty wid/cls are skipped.
 */
export async function groupClients(
    clients: Client[],
    activeWid = "",
    selFn: (flatIndex: string) => Promise<string | null> = frameSelection,
): Promise<Group[]> {
    const rows = clients.filter((c) => c.wid && c.cls);
    dbg("groupClients: %d/%d rows usable", rows.length, clients.length);

    // Key stream = source of truth for group sizes.
    const keys = rows.map(keyOf);
    const countOf = (key: string) => keys.filter((k) => k === key).length;

    const seen = new Set<string>();
    const groups: Group[] = [];
    for (const c of rows) {
        const key = keyOf(c);
        if (seen.has(key)) continue;
        seen.add(key);

        const state: GroupState = c.min ? "min" : c.flt ? "flt" : "tiling";

        // Representative: the frame's selected client for tiled frame
        // groups, else the window itself. The frame's selection is only
        // adopted when it belongs to THIS group's class — in a
        // mixed-class frame the selection can be another class's
        // window, and using it here would make this group's label,
        // left-click target and menu target all point at the wrong
        // window (e.g. clicking the Code group minimizing Alacritty).
        let rep = c.wid;
        let selCls: string | null = null; // class of the frame's selected client, if any
        if (key.startsWith("frame|")) {
            const vis = await selFn(c.frame);
            const visRow = vis ? rows.find((r) => r.wid === vis) : null;
            if (visRow) selCls = visRow.cls;
            if (visRow && visRow.cls === c.cls) rep = vis!;
            dbg("groupClients: key=%s rep=%s (frame selection: %s)",
                key, rep,
                vis ? (rep === vis ? "adopted" : "other class, rejected")
                    : "none, fell back to first row");
        }

        // Active: the group holding the globally focused window —
        // compare the focused window's own key, computed the same way.
        const active = rows.find((r) => r.wid === activeWid);
        const isActive = active !== undefined && keyOf(active) === key ? 1 : 0;

        // Title must come from the REPRESENTATIVE window (the frame's
        // visible client), not from the first row of the group — the
        // rep can be any member, so resolve its row in the clients
        // array. Falls back to the class when the rep vanished
        // mid-refresh.
        const repRow = rows.find((r) => r.wid === rep);

        // Only use the rep's title if the rep actually belongs to this
        // group's class. In a mixed-class frame the rep is the frame's
        // visible client, which may be of another class (e.g. the
        // focused one) — showing its title here would make an inactive
        // group display the focused window's title. In that case the
        // group falls back to its own class name.
        const repMatchesClass = repRow && repRow.cls === c.cls;

        // Visible: the group's class matches the frame's selected
        // client's class. Only the selected client of a frame is shown
        // on screen, so a same-class group in a frame whose selection
        // moved to another class is NOT visible — even though the
        // focused window may live in a different frame. Computed from
        // the frame's selection directly (selCls), NOT from the rep —
        // the rep is always the group's own window now.
        const isVisible = key.startsWith("frame|") && selCls === c.cls ? 1 : 0;

        groups.push({
            frame: c.frame,
            cls: c.cls,
            rep,
            isActive,
            isVisible,
            count: countOf(key),
            title: (repMatchesClass && repRow!.ttl) || c.cls,
            state,
        });
        dbg("groupClients: + group key=%s count=%d active=%d",
            key, countOf(key), isActive);
    }
    dir("format", "groups", groups);
    return groups;
}
