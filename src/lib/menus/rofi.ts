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

/**
 * Launcher mode: run rofi synchronously (its UI), pointed at
 * `<self> <subArgs...>` as the mode's backend. stdio is inherited,
 * like the shell originals' exec. Never returns.
 */
export function launchRofi(rofiArgs: string[], backendArgs: string[] = []): never {
    const modeCmd = [selfCommand(), ...backendArgs].map(shQuote).join(" ");
    ui("launchRofi: rofi %j (backend: %j)", rofiArgs, modeCmd);
    const r = spawnSync("rofi", rofiArgs, { env: wmEnv(), stdio: "inherit" });
    process.exit(r.status ?? 1);
}

/**
 * Backend mode: run rofi as a plain dmenu/dialog synchronously with
 * input pre-fed (guaranteed EOF — same reason hc_switcher used a temp
 * file: a never-EOFing stdin pipe leaves rofi windowless while holding
 * the keyboard grab), then return its stdout + exit code.
 */
export function runRofiDmenu(
    rofiArgs: string[],
    input: string,
): { stdout: string; status: number | null } {
    const r = spawnSync("rofi", rofiArgs, {
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
