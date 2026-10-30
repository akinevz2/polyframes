// src/lib/resize.ts — migration of the dots `hc_resize` helper into
// the polyframes binary (herbstutil-based reads come from the bundled
// attrTree — no shell PATH/nvm fragility at keybind-spawn time).
//
// Modes (mirroring the bash helper's interface):
//   deltas      — nudge the focused (or --wid) floating/pseudotile
//                 client by pixel deltas; 0 0 canonicalises and prints
//   fill        — stretch `wid` to its parent frame's content
//                 geometry (or the focused frame when the client has
//                 no parent_frame — floating clients carry none)
//   explicit    — set an EXACT content rect (the hc_zoom pre-float
//                 tile-rect carry-over)
//
// Success output: one JSON line {"wid":"…","geometry":"WxH+X+Y"} —
// jq-pipeable, same contract as the bash original.

import * as hc from "./hc";
import { attrTree, asBool, num, asString } from "./hlwmJson";
import { ui } from "./debug";
import { flatToDotted } from "./frames";
import { decoMargins } from "./center";

const GEO_RE = /^([0-9]+)x([0-9]+)([+-][0-9]+)([+-][0-9]+)$/;

interface Geometry {
    x: number;
    y: number;
    width: number;
    height: number;
}

/** herbstutil types geometries as objects; accept strings defensively. */
function asGeom(v: unknown): Geometry | null {
    if (v !== null && typeof v === "object") {
        const o = v as Record<string, unknown>;
        if (typeof o.width === "number" && typeof o.height === "number") {
            return { x: num(o.x, 0), y: num(o.y, 0), width: o.width, height: o.height };
        }
        return null;
    }
    const s = typeof v === "string" ? v : String(v ?? "");
    const m = s.match(GEO_RE);
    if (!m) return null;
    return { x: Number(m[3]), y: Number(m[4]), width: Number(m[1]), height: Number(m[2]) };
}

async function writeGeometry(wid: string, g: Geometry): Promise<void> {
    await hc.setAttr(`clients.${wid}.floating_geometry`,
        `${g.width}x${g.height}+${g.x}+${g.y}`);
}

function emit(wid: string, g: Geometry): void {
    process.stdout.write(`{"wid":"${wid}","geometry":"${g.width}x${g.height}+${g.x}+${g.y}"}\n`);
}

async function requireFloating(wid: string): Promise<Geometry> {
    const tree = await attrTree(`clients.${wid}.`);
    if (!tree) throw new Error(`hc_resize: no client ${wid}`);
    const a = tree.attributes;
    if (!asBool(a.floating) && !asBool(a.pseudotile)) {
        throw new Error("hc_resize: client is tiled — the layout owns its geometry");
    }
    const geo = asGeom(a.floating_geometry);
    if (!geo) throw new Error("hc_resize: no floating_geometry on client");
    return geo;
}

/** Delta mode: nudge (and canonicalise with 0/0). */
export async function resizeDelta(wid: string, dx: number, dy: number): Promise<void> {
    const cur = await requireFloating(wid);
    let w = cur.width + dx;
    let h = cur.height + dy;
    // Sane minimums; bigger than any sane text window is across workspaces.
    if (w < 50) w = 50;
    if (h < 50) h = 50;
    const g: Geometry = { x: cur.x, y: cur.y, width: w, height: h };
    ui("resize: delta %dx%+d%+d -> %dx%d+%d+%d", dx, dy, g.width, g.height, g.x, g.y);
    await writeGeometry(wid, g);
    emit(wid, g);
}

/** Fill mode: stretch to the parent (or focused) frame's content rect
 *  with the DECO OUTLINE flush to it — the content rect is the frame
 *  rect inset by the theme float margins, so the decoration borders
 *  coincide exactly with the frame's content rect (the tile-rect
 *  carry-over left a 2px/side residue: the tiling band is 11px where
 *  the float deco is 9px). Target "root" fills the monitor's work
 *  area (the whole screen minus panels) instead of the focused frame. */
export async function resizeFill(
    wid: string,
    target: "frame" | "root" = "frame",
): Promise<void> {
    await requireFloating(wid);
    let frameObj: Awaited<ReturnType<typeof attrTree>> = null;
    let framepath = "tags.focus.tiling.root";
    if (target === "root") {
        frameObj = await attrTree("tags.focus.tiling.root.");
    } else {
        const parent = await attrTree(`clients.${
            wid}.parent_frame.`);
        if (parent) {
            const idx = asString(parent.attributes.index) ?? "";
            const dotted = idx === "" ? "" : flatToDotted(idx);
            framepath = dotted === ""
                ? "tags.focus.tiling.root"
                : `tags.focus.tiling.root.${dotted}`;
            frameObj = await attrTree(`${framepath}.`);
        } else {
            ui("resize: %s has no parent frame (floating/unattached) -> focused frame", wid);
            frameObj = await attrTree("tags.focus.tiling.focused_frame.");
        }
    }
    if (!frameObj) throw new Error(`hc_resize: no frame at ${framepath}`);
    const raw = asGeom(frameObj.attributes.content_geometry);
    if (!raw) throw new Error(`hc_resize: no content geometry on ${framepath}`);
    // Deco-flush fill: frame rect minus the floating theme margins.
    const [L, T, R, B] = await decoMargins(wid);
    const g: Geometry = {
        x: raw.x + L,
        y: raw.y + T,
        width: Math.max(1, raw.width - L - R),
        height: Math.max(1, raw.height - T - B),
    };
    await writeGeometry(wid, g);
    emit(wid, g);
}

/** Explicit-rect mode: apply a decided content geometry verbatim. */
export async function resizeToRect(wid: string, rect: string): Promise<void> {
    if (!GEO_RE.test(rect)) {
        throw new Error(`hc_resize: not a content rect: '${rect}'`);
    }
    await requireFloating(wid);
    const m = rect.match(GEO_RE) as RegExpMatchArray;
    const g: Geometry = {
        x: Number(m[3]),
        y: Number(m[4]),
        width: Number(m[1]),
        height: Number(m[2]),
    };
    await writeGeometry(wid, g);
    emit(wid, g);
}
