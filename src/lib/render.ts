// src/lib/render.ts — polybar formatting (port of generate_window_list).
// Pure function: groups + settings in, bar line out.

import { format as dbg, dir } from "./debug";
import type { Group } from "./groups";

export interface RenderSettings {
    visible_text_color: string;
    focused_text_color: string;
    floating_text_color: string;
    hidden_text_color: string;
    focused_underline: string;
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
 * @param groups WM order
 * @param onClick command prefix, e.g. "/usr/local/bin/polyframes"
 * @param settings partial overrides of the defaults
 * @returns the polybar module output line (no trailing \n)
 */
export function render(
    groups: Group[],
    onClick: string,
    settings: Partial<RenderSettings> = {},
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

        let name = g.title || g.cls;
        if (s.char_case === "lower") name = name.toLowerCase();
        else if (s.char_case === "upper") name = name.toUpperCase();
        if (name.length > s.char_limit) {
            name = `${name.slice(0, s.char_limit - 1)}…`;
        }
        if (s.add_spaces) name = ` ${name} `;

        // Color by state: focused (gold underline) / floating / visible /
        // minimized (dark gray). A group whose class is not the frame's
        // selected client's class is not shown on screen — dim it like
        // minimized windows. This is per-frame (via isVisible), so it
        // stays correct when focus moves between frames.
        let color = s.visible_text_color;
        let underline = "";
        if (g.isActive === 1 && g.state !== "min") {
            color = s.focused_text_color;
            underline = s.focused_underline;
        } else if (g.state === "flt") {
            color = s.floating_text_color;
            underline = s.floating_underline;
        } else if (g.state === "min") {
            color = s.hidden_text_color;
        } else if (g.state === "tiling" && !g.isVisible) {
            color = s.hidden_text_color;
        }
        let left = `%{F${color}}`;
        let right = "%{F-}";
        if (underline) {
            left += "%{+u}%{u" + underline + "}";
            right = "%{-u}" + right;
        }
        name = `${left}${name}${right}`;

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
        out += name;
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
