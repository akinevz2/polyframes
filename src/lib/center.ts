// src/lib/center.ts — center the focused window, PRESERVING its current
// size, fitting the window PLUS ITS DECORATION inside the target rect,
// with clamping so the full outline never overflows it (port of
// herbst/.local/bin/hc_center; hangs off `polyframes center [frame|root]`).
//   root (default)  — center within tags.focus.tiling.root.content_geometry
//   frame           — center within the focused frame's content_geometry
//
// floating_geometry addresses the CONTENT rect only; hlwm draws the
// decoration (border + title) around it. The decoration outline is
// measured live (hc_deco_margins logic, inlined below) and treated as
// an inset of the target rect.
//
// "Current size" source depends on the window's state: floating
// geometry only counts while the window is floating — for a tiled
// window the current size is its content geometry, and
// floating_geometry holds a stale pre-float value instead. The window
// is floated on before measuring so the floating theme's outline is
// the one being measured.

import * as hc from "./hc";
import { ui } from "./debug";
import { flatToDotted } from "./frames";
import { attrTree, asString, num } from "./hlwmJson";

/** hlwm draws the floating decoration per the theme.floating
 *  parameters — a deterministic margin source (the live
 *  decoration_geometry read races: hlwm applies the float deco
 *  asynchronously right after float-on, so early reads can still look
 *  like the tiled theme and the fit math shifts the outline off-screen).
 *
 *  Verified against live deco reads on this config:
 *    T = border_width + padding_top + title_height + title_depth
 *    L/R/B = border_width (+ padding_* each)
 */
export async function decoMargins(winid: string): Promise<[number, number, number, number]> {
    const theme = await attrTree("theme.floating.");
    if (theme) {
        const a = theme.attributes;
        const b = num(a.border_width, 2);
        const L = Math.max(0, b + num(a.padding_left, 0));
        const R = Math.max(0, b + num(a.padding_right, 0));
        const B = Math.max(0, b + num(a.padding_bottom, 0));
        const T = Math.max(0, b + num(a.padding_top, 0) + num(a.title_height, 0) + num(a.title_depth, 0));
        return [L, T, R, B];
    }
    // Fallback: measure the outline live from the client's own
    // decoration_geometry vs content_geometry (original hc_deco_margins
    // behaviour), falling back to the theme attr reads.
    const parseGeom = (g: string | null) => {
        const m = g?.match(/^(\d+)x(\d+)([+-]\d+)([+-]\d+)$/);
        return m ? { w: Number(m[1]), h: Number(m[2]), x: Number(m[3]), y: Number(m[4]) } : null;
    };
    const [cont_, deco_, bw, th] = await Promise.all([
        hc.attr(`clients.${winid}.content_geometry`),
        hc.attr(`clients.${winid}.decoration_geometry`),
        hc.attr("theme.floating.border_width"),
        hc.attr("theme.floating.title_height"),
    ]);
    const cont = parseGeom(cont_);
    const deco = parseGeom(deco_);
    let L: number, T: number, R: number, B: number;
    if (cont && deco) {
        L = cont.x - deco.x;
        T = cont.y - deco.y;
        R = deco.x + deco.w - cont.x - cont.w;
        B = deco.y + deco.h - cont.y - cont.h;
    } else {
        const b = bw === null ? 2 : Number(bw);
        const t = th === null ? 0 : Number(th);
        L = b; R = b; B = b;
        T = b + t;
    }
    // Margins never pull the outline inside the content.
    return [Math.max(L, 0), Math.max(T, 0), Math.max(R, 0), Math.max(B, 0)];
}

/**
 * Centered placement of a given size inside a target rect (deco inset
 * aware) — the pure-weight half of placeCenteredIn, shared with the
 * hint-snap reconciliation pass.
 */
export function centeredPlacement(
    target: Rect,
    margins: { L: number; T: number; R: number; B: number },
    size: { width: number; height: number },
): { x: number; y: number; width: number; height: number } {
    // Inner rect: the target minus the decoration outline.
    const iw = Math.max(1, target.width - margins.L - margins.R);
    const ih = Math.max(1, target.height - margins.T - margins.B);
    const wn = Math.max(1, Math.min(size.width, iw));
    const hn = Math.max(1, Math.min(size.height, ih));
    let x = target.x + margins.L + Math.floor((iw - wn) / 2);
    let y = target.y + margins.T + Math.floor((ih - hn) / 2);
    // Clamp: the outline can't start before or end after the target rect.
    if (x < target.x + margins.L) x = target.x + margins.L;
    if (x + wn > target.x + target.width - margins.R) x = target.x + target.width - margins.R - wn;
    if (y < target.y + margins.T) y = target.y + margins.T;
    if (y + hn > target.y + target.height - margins.B) y = target.y + target.height - margins.B - hn;
    return { x, y, width: wn, height: hn };
}

/**
 * After a floating_geometry write, reconcile with what hlwm actually
 * holds: float size hints (sizehints_floating=true) may SNAP the client
 * size, shifting the whole outline. One bounded re-fit against the real
 * content rect — verified from the DECORATION side afterwards (the on-
 * screen truth), not floating_geometry.
 */
async function reconcileAfterWrite(
    winid: string,
    rect: Rect,
    margins: { L: number; T: number; R: number; B: number },
    want: { x: number; y: number; width: number; height: number },
    refit: (size: { width: number; height: number }) => { x: number; y: number; width: number; height: number },
): Promise<void> {
    const realStr = await hc.attr(`clients.${winid}.content_geometry`);
    const rm2 = realStr?.match(/^(\d+)x(\d+)([+-]\d+)([+-]\d+)$/);
    if (!rm2) return;
    const real: Rect = {
        width: Number(rm2[1]),
        height: Number(rm2[2]),
        x: Number(rm2[3]),
        y: Number(rm2[4]),
    };
    const stable = real.width === want.width && real.height === want.height
        && real.x === want.x && real.y === want.y;
    if (stable) {
        ui("reconcile: %s stable (%dx%d%+d%+d)", winid, real.width, real.height, real.x, real.y);
        return;
    }
    ui("reconcile: %s snapped to %dx%d%+d%+d -> re-fitting from deco truth",
        winid, real.width, real.height, real.x, real.y);
    const fit = refit({ width: real.width, height: real.height });
    await hc.setAttr(`clients.${winid}.floating_geometry`,
        `${fit.width}x${fit.height}+${fit.x}+${fit.y}`);
}

/**
 * Center an already-floating window (PRESERVING its current size) in
 * the given target rect ("frame" = focused frame, "root" = workspace).
 * Writes floating_geometry — no lock taken, the caller owns sequencing.
 * Geometry parsing, decoration inset, size clamp and clamping are the
 * shared logic with center().
 */
export async function placeCenteredIn(winid: string, geoPath: string): Promise<void> {
    const frameGeom = await hc.attr(geoPath);
    const fm = frameGeom?.match(/^(\d+)x(\d+)([+-]\d+)([+-]\d+)$/);
    if (!fm) {
        ui("placeCenteredIn: cannot parse frame geometry %j", frameGeom);
        return;
    }
    const [, fw, fh, fx, fy] = fm.map(Number);
    const [L, T, R, B] = await decoMargins(winid);

    // Inner rect: the target minus the decoration outline.
    let iw = fw - L - R;
    let ih = fh - T - B;
    if (iw < 1) iw = 1;
    if (ih < 1) ih = 1;

    // Current size: floating_geometry is authoritative while floating —
    // fall back to content_geometry when it holds a stale value.
    let winGeom = await hc.attr(`clients.${winid}.floating_geometry`);
    if (!/^\d+x\d+/.test(winGeom ?? "")) {
        winGeom = await hc.attr(`clients.${winid}.content_geometry`);
    }
    const wm = winGeom?.match(/^(\d+)x(\d+)/);
    if (!wm) {
        ui("placeCenteredIn: cannot parse window geometry %j", winGeom);
        return;
    }
    const rect: Rect = { x: fx, y: fy, width: fw, height: fh };
    const placed = centeredPlacement(rect, { L, T, R, B }, {
        width: Number(wm[1]),
        height: Number(wm[2]),
    });
    const signed = (n: number) => (n >= 0 ? `+${n}` : `${n}`);
    ui("placeCenteredIn: %s frame %dx%d%s%s outline L=%d T=%d R=%d B=%d -> %dx%d%s%s",
        winid, fw, fh, signed(fx), signed(fy), L, T, R, B,
        placed.width, placed.height, signed(placed.x), signed(placed.y));
    await hc.setAttr(`clients.${winid}.floating_geometry`,
        `${placed.width}x${placed.height}+${placed.x}+${placed.y}`);
    // Reconcile against hlwm's real content rect (deco is the on-screen
    // truth): size-hint snapping can shift the whole placement.
    await reconcileAfterWrite(winid, rect, { L, T, R, B }, placed,
        (size) => centeredPlacement(rect, { L, T, R, B }, size));
}

/**
 * Center the FOCUSED window (the `center` command / the `hc_center`
 * shim's semantics): float it on first so the floating theme's
 * decoration is the one being measured, then place it centered inside
 * the target rect, leaving focus/raise to the closing chain.
 */
/** Width/height/position rectangle (hlwm geometry numbers). */
export interface Rect {
    x: number;
    y: number;
    width: number;
    height: number;
}

/**
 * Constraint pass for a floating window against a target rect
 * (the monitor's work area): shrink the size to FIT the inner rect
 * (decoration-aware), then nudge the position so the full outline —
 * content plus the L/T/R/B decoration margins — stays inside the
 * target. Size-preserving when everything already fits. Idempotent
 * (no changes → same values).
 */
export function fitWithinRect(
    target: Rect,
    cur: Rect,
    m: { L: number; T: number; R: number; B: number },
): { x: number; y: number; width: number; height: number; resized: boolean; nudged: boolean } {
    // Inner rect: the target minus the decoration outline.
    const innerW = Math.max(1, target.width - m.L - m.R);
    const innerH = Math.max(1, target.height - m.T - m.B);

    // Resize DOWN to fit (never grow).
    const width = Math.max(1, Math.min(cur.width, innerW));
    const height = Math.max(1, Math.min(cur.height, innerH));
    const resized = width !== cur.width || height !== cur.height;

    // Nudge into the bounds: content left edge may not be before
    // target+L, right edge not past target width - R (same for y/T/B).
    const maxX = target.x + target.width - m.R - width;
    const maxY = target.y + target.height - m.B - height;
    const x = Math.min(Math.max(cur.x, target.x + m.L), Math.max(target.x + m.L, maxX));
    const y = Math.min(Math.max(cur.y, target.y + m.T), Math.max(target.y + m.T, maxY));
    const nudged = x !== cur.x || y !== cur.y;

    return { x, y, width, height, resized, nudged };
}

/**
 * Fit a floating window (by wid) inside a target rect's content
 * geometry — "root" = the monitor's work area (the `hc_fit_to` default)
 * or the focused "frame". Shrinks oversized windows, nudges off-screen
 * ones back into bounds — nothing else touched.
 */
export async function fitTo(
    wid: string,
    target: "root" | "frame" = "root",
): Promise<void> {
    const geoPath = target === "frame"
        ? "tags.focus.tiling.focused_frame.content_geometry"
        : "tags.focus.tiling.root.content_geometry";
    const frameGeom = await hc.attr(geoPath);
    const fm = frameGeom?.match(/^(\d+)x(\d+)([+-]\d+)([+-]\d+)$/);
    if (!fm) {
        ui("fitTo: cannot parse frame geometry %j", frameGeom);
        return;
    }
    const [, fw, fh, fx, fy] = fm.map(Number);
    const rect: Rect = { x: fx, y: fy, width: fw, height: fh };

    const [L, T, R, B] = await decoMargins(wid);
    let winGeom = await hc.attr(`clients.${wid}.floating_geometry`);
    if (!/^\d+x\d+/.test(winGeom ?? "")) {
        winGeom = await hc.attr(`clients.${wid}.content_geometry`);
    }
    const wm = winGeom?.match(/^(\d+)x(\d+)([+-]\d+)([+-]\d+)$/);
    if (!wm) {
        ui("fitTo: cannot parse window geometry %j", winGeom);
        return;
    }
    const cur: Rect = {
        width: Number(wm[1]),
        height: Number(wm[2]),
        x: Number(wm[3]),
        y: Number(wm[4]),
    };
    const fit = fitWithinRect(rect, cur, { L, T, R, B });
    if (!fit.resized && !fit.nudged) {
        ui("fitTo: %s already fits (target %s)", wid, target);
        return;
    }
    ui("fitTo: %s resized=%j nudged=%j -> %dx%d%s%s%s%s",
        wid, fit.resized, fit.nudged, fit.width, fit.height,
        fit.x >= 0 ? "+" : "", fit.x, fit.y >= 0 ? "+" : "", fit.y);
    await hc.setAttr(`clients.${wid}.floating_geometry`,
        `${fit.width}x${fit.height}+${fit.x}+${fit.y}`);
    // Reconcile with the real content rect (size-hint snapping may
    // shift the outline); re-fit once from the deco-side truth.
    await reconcileAfterWrite(wid, rect, { L, T, R, B }, fit,
        (size) => {
            const f2 = fitWithinRect(
                rect, { width: size.width, height: size.height, x: fit.x, y: fit.y },
                { L, T, R, B },
            );
            return { x: f2.x, y: f2.y, width: f2.width, height: f2.height };
        });
}

/**
 * Center a SPECIFIC window inside its OWN parent frame's content
 * geometry (the old centered-window variant of `centerInFrame`).
 * Unlike center(), this does not touch float state or take locks —
 * callers sequence those. Used via `polyframes center --wid <wid>`.
 */
export async function centerWindowInOwnFrame(wid: string): Promise<void> {
    const idx = (await hc.attr(`clients.${wid}.parent_frame.index`)) ?? "";
    const dotted = idx === "" ? "" : flatToDotted(idx);
    const geoPath = dotted === ""
        ? "tags.focus.tiling.root.content_geometry"
        : `tags.focus.tiling.root.${dotted}.content_geometry`;
    ui("centerWindowInOwnFrame: %s -> %s", wid, geoPath);
    await placeCenteredIn(wid, geoPath);
}

export async function center(targetArg?: string): Promise<void> {
    // Hold the WM lock for the full float-and-center sequence: the
    // window must not be visible at its stale floating_geometry between
    // the early "floating on" (needed before measuring margins) and the
    // geometry write in the closing chain. hlwm's lock is reference-
    // counted, so callers may hold their own lock around this.
    await hc.cmd("lock");
    try {
        const target = targetArg ?? "root";
        const geoPath = target === "frame"
            ? "tags.focus.tiling.focused_frame.content_geometry"
            : target === "root"
                ? "tags.focus.tiling.root.content_geometry"
                : null;
        if (geoPath === null) {
            throw new Error(`center: unknown target '${target}' (use frame|root)`);
        }

        const winid = await hc.attr("clients.focus.winid");
        if (!winid) {
            ui("center: no focused window");
            return;
        }

        // Float the window on first so the floating theme's decoration
        // is the one being measured (floating_geometry becomes
        // authoritative). The placement itself is placeCenteredIn (the
        // single implementation all centering paths share).
        await hc.cmd("attr", `clients.${winid}.floating`, "on");
        await placeCenteredIn(winid, geoPath);

        // Closing chain, one herbstclient round trip: float on, float
        // session focus (best-effort), then focus/bring.
        await hc.cmd(
            "chain", ".",
            "lock", ".",
            "set_attr", `clients.${winid}.floating`, "on", ".",
            "try", "set_attr", "tags.focus.floating_focused", "on", ".",
            "jumpto", winid, ".",
            "bring", winid, ".",
            "unlock",
        );
    } finally {
        await hc.cmd("unlock");
    }
}
