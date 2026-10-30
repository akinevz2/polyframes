// src/lib/hlwmJson.ts — JSON view of herbstclient's attr output.
//
// Parsing is DELEGATED to the herbstutil npm package (the user's own
// `herbstclient attr` -> JSON utility) — we call its exposed
// `parseAttr()` on the raw herbstclient output instead of maintaining a
// parser here. The herbstutil CLI no longer needs to be installed: it
// is a normal dependency of this project, bundled at build time.
//
// Why: every field used by the menus/bar used to cost one herbstclient
// spawn (~15 ms each). One `attr clients.<wid>.` call returns the whole
// object tree in one round trip, with REAL type coercion already done
// by herbstutil (booleans as booleans, geometries as {x,y,width,height}
// objects) — 5 spawns collapse into 1.
//
// Wire format (herbstutil parseAttr):
//   { value: "", children: ["parent_frame"], attributes: { class: "…",
//     minimized: false, ... } }
//
// All callers must treat a null result as "read failed" and fall back
// to the plain per-attribute hc.ts reads.

import { parseAttr } from "herbstutil/src/commands/parse.js";
import { cmd as hcCmd } from "./hc";
import { ui } from "./debug";

export interface AttrNode {
    /** the node's own value ("" for object/container nodes) */
    value: string;
    /** child object names, trailing dot stripped ("parent_frame") */
    children: string[];
    /** typed attribute map (booleans as booleans, geometries as objects) */
    attributes: Record<string, unknown>;
}

/**
 * `herbstclient attr <path>`, parsed by herbstutil's parseAttr — one
 * round trip for the whole node. Resolves null on ANY failure (wm
 * unreachable, missing object) — callers fall back to plain attr reads.
 */
export async function attrTree(path: string): Promise<AttrNode | null> {
    const r = await hcCmd("attr", path);
    if (r === null) return null;
    try {
        const parsed = parseAttr(r.stdout);
        return {
            value: String(parsed.value ?? ""),
            children: (parsed.children ?? []).map((c) => String(c).replace(/\.+$/, "")),
            attributes: parsed.attributes ?? {},
        };
    } catch (err) {
        ui("attrTree(%s) parse failed: %s", path, err);
        return null;
    }
}

/** String semantics for values the old string-based code compared. */
export function asString(v: unknown): string | undefined {
    if (v === undefined || v === null) return undefined;
    return typeof v === "string" ? v : String(v);
}

/** Boolean semantics: accepts real booleans and "true"/"false". */
export function asBool(v: unknown): boolean {
    return v === true || v === "true";
}

/** Number semantics with a default: herbstutil types numeric attrs,
 *  and unreliable readers fall back to the default here. */
export function num(v: unknown, fallback: number): number {
    if (typeof v === "number" && Number.isFinite(v)) return v;
    if (typeof v === "string") {
        const n = Number(v);
        if (Number.isFinite(n)) return n;
    }
    return fallback;
}
