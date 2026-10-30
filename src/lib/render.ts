// src/lib/render.ts — polybar formatting (port of generate_window_list).
// Pure function: groups + settings in, bar line out.

import { format as dbg, dir } from "./debug";
import type { Group } from "./groups";

export interface RenderSettings {
    visible_text_color: string;
    focused_text_color: string;
    floating_text_color: string;
    hidden_text_color: string;
    /** the focused window's group: gold underline + this (white) */
    focused_underline: string;
    /** the CURRENT FRAME's multi-window group: gold underline + this (yellow) */
    current_frame_text_color: string;
    /** any OTHER multi-window group: this underline, grey/white text */
    group_underline: string;
    floating_underline: string;
    separator: string;
    forbidden_classes: string;
    empty_desktop_message: string;
    char_limit: number;
    max_windows: number;
    char_case: "normal" | "upper" | "lower";
    add_spaces: boolean;
}

export const DEFAULTS: RenderSettings = {
    visible_text_color: "#eeeeee",
    focused_text_color: "#eeeeee",
    floating_text_color: "#eeeeee",
    hidden_text_color: "#888888",
    focused_underline: "#FEEF69",
    current_frame_text_color: "#FEEF69",
    group_underline: "#ffffff",
    floating_underline: "",
    separator: "·",
    forbidden_classes: "Polybar Conky Gmrun",
    empty_desktop_message: "Desktop",
    char_limit: 20,
    max_windows: 15,
    char_case: "normal",
    add_spaces: true,
};

/**
 * The label's VISIBLE text (post truncation/casing/spacing) — shared
 * by render() and the bar-label offset calculator (the menu anchoring
 * computes pixel positions from the same character counts).
 */
export function labelText(g: Group, s: RenderSettings): string {
    let name = g.title || g.cls;
    if (s.char_case === "lower") name = name.toLowerCase();
    else if (s.char_case === "upper") name = name.toUpperCase();
    if (name.length > s.char_limit) {
        name = `${name.slice(0, s.char_limit - 1)}…`;
    }
    return s.add_spaces ? ` ${name} ` : name;
}

/**
 * @param groups WM order
 * @param onClick command prefix, e.g. "/usr/local/bin/polyframes"
 * @param settings partial overrides of the defaults
 * @param currentFrame the focused frame's flat index ("" when none) —
 *   drives the current-frame group styling; omit for the legacy look
 * @returns the polybar module output line (no trailing \n)
 */
export function render(
    groups: Group[],
    onClick: string,
    settings: Partial<RenderSettings> = {},
    currentFrame?: string,
): string {
    const s = { ...DEFAULTS, ...settings };
    dbg("render: %d groups in, settings=%j", groups.length, s);
    const sep = `%{F${s.hidden_text_color}}${s.separator}%{F-}`;
    const forbidden = String(s.forbidden_classes).split(/\s+/).filter(Boolean);

    let out = "";
    let shown = 0; // groups actually rendered
    let total = 0; // all groups seen

    // Render order: WM order, but minimized groups are pushed to the
    // end, after the floating windows. Stable sort — relative order
    // within each bucket is preserved.
    const rank = (g: Group) => (g.state === "min" ? 1 : 0);
    const ordered = groups
        .map((g, i) => ({ g, i }))
        .sort((a, b) => rank(a.g) - rank(b.g) || a.i - b.i)
        .map((e) => e.g);

    for (const g of ordered) {
        total += 1;
        // Defensive: skip malformed rows (empty wid/cls would blank the bar).
        if (!g.cls || !g.rep) {
            dbg("render: skip malformed group %j", g);
            continue;
        }
        // Forbidden classes are hidden entirely.
        if (forbidden.includes(g.cls)) {
            dbg("render: skip forbidden class %s", g.cls);
            continue;
        }
        // Past max_windows: count only.
        if (shown >= s.max_windows) {
            dbg("render: group %s/%s past max_windows (%d), counting only",
                g.frame, g.cls);
            continue;
        }

        const name = labelText(g, s);

        // Styling decision matrix (per the label spec):
        //   1. minimized                     -> grey, no underline
        //   2. the group holds the FOCUSED window
        //                                    -> gold underline + white
        //   3. not visible (mixed frame)     -> grey (+ white underline
        //                                       when grouped)
        //   4. CURRENT FRAME's group, >1 window (visible)
        //                                    -> gold underline + yellow
        //   5. other multi-window group      -> white underline + white
        //   6. solo visible                  -> white, no underline
        let color = s.visible_text_color;
        let underline = "";
        if (g.state === "min") {
            color = s.hidden_text_color;
        } else if (g.isActive === 1) {
            color = s.focused_text_color;
            underline = s.focused_underline;
        } else if (g.state === "tiling" && !g.isVisible) {
            color = s.hidden_text_color;
            if (g.count > 1) underline = s.group_underline;
        } else if (currentFrame !== undefined && g.frame === currentFrame && g.count > 1) {
            color = s.current_frame_text_color;
            underline = s.focused_underline;
        } else if (g.state === "flt") {
            color = s.floating_text_color;
            underline = s.floating_underline;
        } else if (g.count > 1) {
            underline = s.group_underline;
        }
        // (solo visible falls through: white text, no underline)
        let left = `%{F${color}}`;
        let right = "%{F-}";
        if (underline) {
            left += "%{+u}%{u" + underline + "}";
            right = "%{-u}" + right;
        }
        const styled = `${left}${name}${right}`;

        if (shown !== 0) out += sep;

        // On-click actions. A1: lone window -> toggle-focus; group ->
        // switcher scoped to frame + class. Frame/class are quoted so
        // polybar passes them as separate argv items.
        // A2 (right): dismiss (minimize without floating; unminimize +
        // re-center when already minimized).
        // A3 (middle): hc_menu rofi menu on the representative window.
        if (g.count === 1) {
            out += `%{A1:${onClick} toggle-focus --wid ${g.rep}:}`;
        }
        if (g.count > 1) {
            out += `%{A1:${onClick} switcher ${g.frame} "${g.cls}":}`;
        }
        out += `%{A2:${onClick} dismiss --wid ${g.rep}:}`;
        out += `%{A3:${onClick} menu --wid ${g.rep}:}`;
        // Scroll actions carry the representative WID, not frame+class —
        // the handler re-resolves the window's frame/class live at
        // click time, so the group membership is always current.
        out += `%{A4:${onClick} scroll --wid ${g.rep} --dir up:}`;
        out += `%{A5:${onClick} scroll --wid ${g.rep} --dir down:}`;
        out += styled;
        out += "%{A}%{A}%{A}%{A}%{A}";

        shown += 1;
    }

    if (total > s.max_windows) out += `+${total - s.max_windows}`;
    if (total === 0) {
        // Empty desktop — consistent with single-window group handling.
        // All menus are subcommands of this binary (moved from dots
        // herbst helpers); polybar exec's the command string via the
        // shell, and the quoted absolute self path survives any cwd.
        // Contract (pinned by the render spec): left click -> hidden
        // windows picker, middle click -> window switcher, scroll up ->
        // tag switcher, scroll down -> app launcher.
        out += `%{A1:${onClick} hidden:}%{A3:${onClick} windows:}`
            + `%{A4:${onClick} tags:}%{A5:${onClick} launch:}`
            + `${s.empty_desktop_message}%{A}%{A}%{A}%{A}`;
    }
    dbg("render: shown=%d total=%d, bar length=%d", shown, total, out.length);
    dir("format", "bar", out);
    return out;
}
