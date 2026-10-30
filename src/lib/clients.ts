// src/lib/clients.ts — port of hc_get-clients.
// Returns every client on the focused tag in WM order, enriched.

import { attr, listClients } from "./hc";
import { clients as dbg, dir } from "./debug";
import { attrTree, asString, asBool } from "./hlwmJson";
import type { AttrNode } from "./hlwmJson";

export interface Client {
    /** window id */
    wid: string;
    /** window class */
    cls: string;
    /** minimized */
    min: boolean;
    /** title (tabs/newlines flattened, falls back to class) */
    ttl: string;
    /** floating_effectively */
    flt: boolean;
    /** flat frame index, or "-1" when unframed */
    frame: string;
}

/**
 * Frame attribution, exactly as hc_get-clients:
 *  - parent_frame object missing entirely -> "-1"
 *  - parent_frame.index = "" (single unsplit root frame) -> "-1"
 *    (tiling.root is semantically NOT tiling.root.0)
 *  - otherwise the index verbatim ("0", "1", "00", ...)
 */
export async function frameOf(wid: string): Promise<string> {
    const idx = await attr(`clients.${wid}.parent_frame.index`);
    const frame = idx === null ? "-1" : idx;
    dbg("frameOf(%s) -> %s%s", wid, frame,
        idx === null ? " (missing/empty parent_frame -> unframed)" : "");
    return frame;
}

/**
 * @returns WM order, never sorted. Empty array on any WM failure
 * (fail soft).
 */
export async function getClients(): Promise<Client[]> {
    dbg("getClients: querying focused tag");
    const tag = await attr("tags.focus.name");
    if (tag === null) {
        dbg("getClients: no focused tag (wm unreachable) -> []");
        return [];
    }
    const wids = await listClients({ tag });
    dbg("getClients: tag=%s, %d wids", tag, wids.length);
    const clients = await Promise.all(
        wids.map(async (wid): Promise<Client | null> => {
            let cls: string | null;
            let min: string | undefined;
            let ttl: string | undefined;
            let flt: string | undefined;
            let frame: string;
            const tree = await attrTree(`clients.${wid}.`);
            if (tree) {
                // Soft herbstutil path: two round trips for everything.
                const a = tree.attributes;
                cls = asString(a.class) ?? null;
                min = asString(a.minimized);
                ttl = asString(a.title);
                flt = asString(a.floating_effectively);
                // Frame attribution, exactly as hc_get-clients via the
                // parent_frame child object: missing entirely -> "-1",
                // empty index (single unsplit root) -> "-1", verbatim
                // otherwise ("0", "1", "00", ...).
                const pf = await attrTree(`clients.${wid}.parent_frame.`);
                const idx = pf ? asString(pf.attributes.index) : undefined;
                frame = idx === undefined || idx === null || idx === "" ? "-1" : idx;
                dbg("frameOf(%s) -> %s (herbstutil)", wid, frame);
            } else {
                // Plain-attr fallback (herbstutil absent or failed).
                const [cls_, min_, ttl_, flt_, frame_] = await Promise.all([
                    attr(`clients.${wid}.class`),
                    attr(`clients.${wid}.minimized`),
                    attr(`clients.${wid}.title`),
                    attr(`clients.${wid}.floating_effectively`),
                    frameOf(wid),
                ]);
                cls = cls_;
                min = min_ ?? undefined;
                ttl = ttl_ ?? undefined;
                flt = flt_ ?? undefined;
                frame = frame_;
            }
            // Defensive: skip rows with no wid/class (client vanished
            // mid-refresh; an empty class would swallow every group later).
            if (wid === "" || cls === null) {
                dbg("getClients: skipping vanished client wid=%j", wid);
                return null;
            }
            // Flatten tabs/newlines in titles so rows stay parseable.
            const cleanTitle = (ttl ?? "").replace(/[\t\n]/g, " ").trim();
            return {
                wid,
                cls,
                min: min === "true" || min === "1",
                ttl: cleanTitle || cls,
                flt: flt === "true" || flt === "1",
                frame,
            };
        }),
    );
    const result = clients.filter((c): c is Client => c !== null);
    dbg("getClients: %d clients (skipped %d vanished)",
        result.length, clients.length - result.length);
    dir("clients", "clients", result);
    return result;
}
