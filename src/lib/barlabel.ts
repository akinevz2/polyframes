// src/lib/barlabel.ts — the pixel offset of a group's label from the
// bar's center, so the menus open under the CLICKED LABEL (the center
// module centers the whole line; each label's position = the character
// arithmetic over the rendered order).
//
// The math:
//   charPx  — from the polybar config's font-0 (mono assumption:
//             Fira Code's advance ≈ 0.6 × pixelsize)
//   labelChars — the visible label text (labelText: truncation, casing,
//             add_spaces) + the 1-char separator between labels
//   dx      = ((cumBefore + labelLen/2) − totalChars/2) × charPx
//
// polybar's `label-padding` wraps the MODULE's whole label once
// (a constant shift) and `module-margin` applies between modules (we
// are one module) — neither affects the per-group offset.

import { readFileSync } from "node:fs";
import { getClients } from "./clients";
import { groupClients, type Group } from "./groups";
import { DEFAULTS, labelText, type RenderSettings } from "./render";
import { ui } from "./debug";

/** Parse the bar's font pixelsize out of config.ini ([bar/*] font-0). */
export function barFontPixelSize(configPath = `${process.env.HOME}/.config/polybar/config.ini`): number {
    try {
        const ini = readFileSync(configPath, "utf8");
        for (const line of ini.split("\n")) {
            const m = line.match(/^\s*font-0\s*=\s*.*?(?:pixelsize|size)=(\d+)/i);
            if (m) return Number(m[1]);
        }
    } catch (err) {
        ui("barlabel: config read failed: %s", err);
    }
    return 12; // polybar's default-ish pixel size
}

/** Mono advance estimate: Fira Code's advance ≈ 0.6em. */
export function charPixelWidth(configPath?: string): number {
    return barFontPixelSize(configPath) * 0.6;
}

/**
 * The rendered ORDER (same rank sort as render(): WM order with the
 * minimized groups pushed last) + per-group visible char counts.
 */
export function orderedLabelChars(
    groups: Group[],
    settings: RenderSettings = DEFAULTS,
): { group: Group; len: number; cumBefore: number; index: number; total: number }[] {
    const forbidden = String(settings.forbidden_classes).split(/\s+/).filter(Boolean);
    const rank = (g: Group) => (g.state === "min" ? 1 : 0);
    const ordered = groups
        .map((g, i) => ({ g, i }))
        .sort((a, b) => rank(a.g) - rank(b.g) || a.i - b.i)
        .map((e) => e.g)
        .filter((g) => g.cls && g.rep && !forbidden.includes(g.cls));

    let cum = 0;
    const rows = ordered.map((g, index) => {
        const len = labelText(g, settings).length;
        const row = { group: g, len, cumBefore: cum, index, total: 0 };
        cum += len + 1; // + the 1-char separator between labels
        return row;
    });
    const total = Math.max(0, cum - 1); // no separator after the last label
    for (const r of rows) r.total = total;
    return rows;
}

export interface LabelMatch {
    /** flat frame index + class (the switcher's click) */
    frame?: string;
    cls?: string;
    /** or a representative wid (the other click actions) */
    wid?: string;
}

/**
 * Pixel x-offset of the matched group's label from the BAR's center
 * (the center module centers the whole rendered line). Resolves 0 when
 * nothing matches (fail soft → the menu just centers).
 */
export async function labelOffsetPx(match: LabelMatch): Promise<number> {
    const clients = await getClients();
    const activeWid = "";
    const groups = await groupClients(clients, activeWid);
    const rows = orderedLabelChars(groups);
    const hit = rows.find(({ group }) =>
        match.wid !== undefined ? group.rep === match.wid
            : match.frame !== undefined && match.cls !== undefined
                ? group.frame === match.frame && group.cls === match.cls
                : false,
    );
    if (!hit) {
        ui("barlabel: no matching group for %j -> centered", match);
        return 0;
    }
    const charPx = charPixelWidth();
    const dx = Math.round(((hit.cumBefore + hit.len / 2) - hit.total / 2) * charPx);
    ui("barlabel: label %d/%d chars=%d/%d -> dx=%dpx",
        hit.index + 1, rows.length, hit.len, hit.total, dx);
    return dx;
}
