// src/lib/menus/clients.ts — client enumeration + field lookup for the
// hidden/windows menus (ports of the shell client_fields/window_rows/
// hidden_rows helpers), PURE hlwm: no xprop.
//
// Ordering note: the shell originals walked the X stacking list
// (_NET_CLIENT_LIST_STACKING) top-down for "most recently used first".
// hlwm 0.9.5 does not expose the stacking order, so the replacement is
// deterministic and pure-herbstclient:
//   1. the globally focused window (one click away, most relevant),
//   2. the focused tag's clients in WM order,
//   3. every other tag's clients, tags in tag_status order,
//      clients in WM order.
// The exact MRU interleaving is deliberately given up for hlwm-purity;
// state styling (visible/active/urgent) in the menus is unaffected and
// rofi filtering makes order secondary anyway.

import * as hc from "../hc";
import { attrRaw } from "./rofi";
import { ui } from "../debug";
import { attrTree, asString, asBool } from "../hlwmJson";

export interface StackRow {
    wid: string;
    cls: string;
    min: boolean;
    tg: string;
    ttl: string;
}

/**
 * Pure-hlwm window ordering approximating "most recently used first":
 * focused window, then the focused tag (WM order), then all other tags
 * (tag_status order). See the module comment on why the X stacking
 * order was given up. With herbstutil present, one tree call lists all
 * clients in a single round trip.
 */
export async function allClientWids(): Promise<string[]> {
    const tree = await attrTree("clients.");
    if (tree) {
        const wids = tree.children.filter((c) => /^0x[0-9a-f]+$/i.test(c));
        ui("allClientWids: %d clients (herbstutil): %j", wids.length, wids);
        return wids;
    }
    const r = await hc.cmd("attr", "clients");
    if (r === null) return [];
    const wids: string[] = [];
    for (const line of r.stdout.split("\n")) {
        const m = line.match(/^\s*(0x[0-9a-f]+)\.?$/i);
        if (m) wids.push(m[1]);
    }
    ui("allClientWids: %d clients: %j", wids.length, wids);
    return wids;
}

/**
 * One round trip per window via the soft herbstutil dependency
 * (`attr clients.<wid>.`); falls back to parallel plain attr reads when
 * the tool is absent. Returns null when the client vanished.
 */
export async function clientFields(wid: string): Promise<StackRow | null> {
    const tree = await attrTree(`clients.${wid}.`);
    if (tree) {
        const a = tree.attributes;
        const w = asString(a.winid);
        if (!w) {
            ui("clientFields: vanished client %s (herbstutil tree)", wid);
            return null;
        }
        return {
            wid: w,
            cls: asString(a.class) ?? "",
            min: asBool(a.minimized),
            tg: asString(a.tag) ?? "",
            ttl: asString(a.title) ?? "",
        };
    }
    // Plain-attr fallback (tool absent / failed).
    const [w, cls, min, tg, ttl] = await Promise.all([
        attrRaw(`clients.${wid}.winid`),
        hc.attr(`clients.${wid}.class`),
        hc.attr(`clients.${wid}.minimized`),
        attrRaw(`clients.${wid}.tag`),
        hc.attr(`clients.${wid}.title`),
    ]);
    if (!w) return null;
    return {
        wid: w,
        cls: cls ?? "",
        min: min === "true",
        tg: tg ?? "",
        ttl: ttl ?? "",
    };
}

/** Tag names in hlwm's own order (tag_status order, no markers). */
async function tagOrder(): Promise<string[]> {
    const r = await hc.cmd("tag_status");
    if (r === null) return [];
    const tags: string[] = [];
    for (const entry of r.stdout.split(/\s+/)) {
        if (!entry) continue;
        const name = /^[\.\!\+\:\#]/.test(entry[0]) ? entry.slice(1) : entry;
        if (name !== "") tags.push(name);
    }
    return tags;
}

/**
 * Pure-hlwm window ordering approximating "most recently used first":
 * focused window, then the focused tag (WM order), then all other tags
 * (tag_status order). See the module comment on why the X stacking
 * order was given up.
 */
export async function windowOrder(): Promise<string[]> {
    const [wids, focused, focusTag] = await Promise.all([
        allClientWids(),
        hc.attr("clients.focus.winid"),
        hc.attr("tags.focus.name"),
    ]);

    if (!focused) {
        // No focused window: plain tag-grouped WM order everywhere.
        const tags = await tagOrder();
        const objs = await Promise.all(
            wids.map((wid) => clientFields(wid)),
        );
        const rows = objs.filter((o): o is StackRow => o !== null);
        return tags.map((t) => rows.filter((o) => o.tg === t).map((o) => o.wid)).flat();
    }

    const head = [focused];
    const rest = wids.filter((w) => w !== focused);

    // Tag of every remaining client.
    const rows = await Promise.all(rest.map((wid) => clientFields(wid)));
    const mapped = rows
        .map((r, i) => ({ r, wid: rest[i] }))
        .filter((x): x is { r: StackRow; wid: string } => x.r !== null);

    // Focused tag first, then the other tags in order.
    const tags = await tagOrder();
    const orderedTags = focusTag
        ? [focusTag, ...tags.filter((t) => t !== focusTag)]
        : tags;
    const byTag = new Map<string, string[]>();
    for (const { r, wid } of mapped) {
        const list = byTag.get(r.tg) ?? [];
        list.push(wid);
        byTag.set(r.tg, list);
    }
    const out: string[] = [...head];
    for (const t of orderedTags) {
        out.push(...(byTag.get(t) ?? []));
    }
    ui("windowOrder: %d windows: %j", out.length, out);
    return out;
}
