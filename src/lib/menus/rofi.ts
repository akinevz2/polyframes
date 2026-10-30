// src/lib/menus/rofi.ts — infrastructure shared by the rofi menus that
// moved into this binary (ports of dots herbst/.local/bin rofi_tags,
// rofi_hidden, rofi_windows, rofi_launch, hc_switcher, hc_menu).
//
// Two invocation modes live in every ported menu:
//   1. launcher — no $ROFI_RETV: exec rofi in script mode, pointing it
//      at this binary through the mode command (rofi runs the command
//      via the shell, so paths are quoted).
//   2. backend  — $ROFI_RETV set: rofi re-invoked us with the response
//      code; emit rows / perform actions per the script-mode protocol.

import { spawnSync } from "node:child_process";
import { selfCommand } from "../self";
import { ui } from "../debug";
import * as hc from "../hc";
import type { Rect } from "../center";

/** US (0x1f) separates meta fields inside one row; NUL (0x0) separates
 *  the display text from its meta fields; rows are NEWLINE-terminated
 *  (rofi splits the emitted lines on \n — see rofi-script(5)). */
export const US = "\x1f";
export const NUL = "\x00";

/**
 * Build one script-mode row: `display\0icon\x1f<icon>\x1finfo\x1f<v>\n`.
 * The varargs are the flat meta sequence (name, value, name, value, …),
 * joined by US. Ends with NEWLINE, never NUL.
 */
export function row(display: string, ...meta: (string | number)[]): string {
    if (meta.length === 0) return `${display}\n`;
    return `${display}${NUL}${meta.join(US)}\n`;
}

/** A menu configuration line: "\0<name><US><value>\n". */
export function menuOpt(name: string, value: string): string {
    return `\x00${name}${US}${value}\n`;
}

/**
 * The X11 env every menu runs under — parity with the shell originals:
 * strip WSLg's WAYLAND_DISPLAY (dual-backend rofi would auto-pick
 * Wayland and abort with "requires the layer shell protocol") and
 * default DISPLAY to localhost:0.0 (WSL2 convention).
 */
export function wmEnv(): NodeJS.ProcessEnv {
    const { WAYLAND_DISPLAY, ...rest } = process.env;
    return { ...rest, DISPLAY: process.env.DISPLAY || "localhost:0.0" };
}

/** Shell-quote one argv element for the rofi mode command (rofi spawns
 *  the script-mode helper with the shell). */
function shQuote(s: string): string {
    return `'${s.replace(/'/g, String.raw`\x27`)}'`;
}

/** Build a rofi `-modi` value: "name:<shell-quoted self command>". */
export function modeSpec(name: string, args: string[]): string {
    const cmd = [selfCommand(), ...args].map(shQuote).join(" ");
    return `${name}:${cmd}`;
}

export const ROFI_RETV = () => process.env.ROFI_RETV;

/** hlwm geometry string ("WxH+X+Y") → rect, or null. */
function parseHlwmRect(s: string | null | undefined): Rect | null {
    const m = s?.match(/^(\d+)x(\d+)([+-]\d+)([+-]\d+)$/);
    return m
        ? { x: Number(m[3]), y: Number(m[4]), width: Number(m[1]), height: Number(m[2]) }
        : null;
}

/**
 * Menu positioning per the bar: the menu anchors at the BAR's edge
 * (below a top bar, above a bottom one — read from the pad bands:
 * monitor geometry vs the work area) and shifts horizontally by the
 * CLICKED LABEL's offset from the bar's center — computed from the
 * rendered label character arithmetic (see lib/barlabel.ts; 0 = the
 * centered default for keybind-opened menus).
 *
 * Rofi theme offsets don't need the menu's own size: `anchor` picks the
 * edge (south = bottom-anchored, north = top-anchored) and the offsets
 * are relative to that anchor point. Stacks with the width-only
 * `-theme-str` fragments the menus already pass.
 */
export async function menuPositionArgs(xOffsetPx = 0): Promise<string[]> {
    const mon = parseHlwmRect(await hc.attr("monitors.focus.geometry"));
    const work = parseHlwmRect(await hc.attr("tags.focus.tiling.root.content_geometry"));
    if (!mon || !work) return [];

    const padTop = work.y - mon.y;
    const padBottom = (mon.y + mon.height) - (work.y + work.height);
    const gap = 4;

    // Horizontal: the clicked label's offset from the bar's center.
    const dx = Math.round(xOffsetPx);

    if (padBottom >= padTop && padBottom > 0) {
        // Bottom bar: bottom-anchor the menu just above it.
        return ["-theme-str", `window { anchor: south; x-offset: ${dx}px; y-offset: -${padBottom + gap}px; }`];
    }
    if (padTop > 0) {
        // Top bar: top-anchor the menu just below it.
        return ["-theme-str", `window { anchor: north; x-offset: ${dx}px; y-offset: ${padTop + gap}px; }`];
    }
    // No pads: keep the label's displacement, vertical center.
    return ["-theme-str", `window { anchor: center; x-offset: ${dx}px; }`];
}

/**
 * Launcher mode: run rofi synchronously (its UI), pointed at
 * `<self> <subArgs...>` as the mode's backend. stdio is inherited,
 * like the shell originals' exec. Never returns.
 */
export async function launchRofi(rofiArgs: string[], backendArgs: string[] = [], xOffsetPx = 0): Promise<never> {
    const modeCmd = [selfCommand(), ...backendArgs].map(shQuote).join(" ");
    const pos = await menuPositionArgs(xOffsetPx);
    ui("launchRofi: rofi %j (backend: %j)", rofiArgs, modeCmd);
    const r = spawnSync("rofi", [...rofiArgs, ...pos], { env: wmEnv(), stdio: "inherit" });
    process.exit(r.status ?? 1);
}

/**
 * Backend mode: run rofi as a plain dmenu/dialog synchronously with
 * input pre-fed (guaranteed EOF — same reason hc_switcher used a temp
 * file: a never-EOFing stdin pipe leaves rofi windowless while holding
 * the keyboard grab), then return its stdout + exit code.
 */
export async function runRofiDmenu(
    rofiArgs: string[],
    input: string,
    xOffsetPx = 0,
): Promise<{ stdout: string; status: number | null }> {
    // dmenu dialogs position with the same bar anchor + label offset.
    const pos = await menuPositionArgs(xOffsetPx);
    const r = spawnSync("rofi", [...rofiArgs, ...pos], {
        env: wmEnv(),
        input,
        encoding: "utf8",
    });
    return { stdout: r.stdout?.toString() ?? "", status: r.status };
}

/** hlwm attr value. Strings print bare; the only quote-stripping parity
 *  needed is hc_tile's own `${wtag//\"/}` defense, which lives there. */
import { attr } from "../hc";
export async function attrRaw(path: string): Promise<string | null> {
    return attr(path);
}
