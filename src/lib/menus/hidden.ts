// src/lib/menus/hidden.ts — pick a hidden (minimized) client and jump
// to it (port of herbst/.local/bin/rofi_hidden).
//
// Styled exactly like the window switcher (windows menu): same theme,
// script-mode rows, MRU ordering and actions, but the list only
// contains minimized clients (rendered in the theme's urgent/hidden
// state). Returns non-zero when there are no hidden clients, so callers
// (the $Mod-g keybind's sh -c chain) can fall back.

import * as hc from "../hc";
import { ui } from "../debug";
import { row, menuOpt, ROFI_RETV, launchRofi, modeSpec } from "./rofi";
import { clientFields, windowOrder } from "./clients";
import { windowsMenu } from "./windows";

const SWITCHER_THEME = `${process.env.HOME}/.config/rofi/window-switcher.rasi`;

/** MRU first; only minimized clients; rows numbered 1..n. Exported so
 *  the `hidden` subcommand can decide its exit code for shell chaining. */
export async function hiddenRows(): Promise<string> {
    let i = 0;
    let out = "";
    for (const wid of await windowOrder()) {
        const f = await clientFields(wid);
        if (!f) continue;
        if (!f.min) continue;
        i += 1;
        const disp = `${String(i).padStart(2, " ")}. ${f.ttl || f.cls}`;
        // No icon metadata: the theme collapses element-icon to size 0
        // ("we have no icons"), and rofi still LOADED the class-name
        // icons when a field was present — tripping the GDK pixbuf
        // width assertion and a GObject unref assertion on cleanup.
        // Same urgent row markup as the windows menu (which emits no
        // icon fields either).
        out += row(disp, "urgent", "true", "info", f.wid);
    }
    ui("hidden: %d hidden rows", i);
    return out;
}

/**
 * Reveal ONE window directly (used when exactly one window is hidden —
 * no menu needed): bring + raise + unfloat, like the shell did via
 * herbstclient chain.
 */
async function revealWid(wid: string): Promise<void> {
    await hc.cmd("chain", ",", "bring", wid, ",", "raise", wid, ",",
        "attr", `clients.${wid}.floating`, "off");
}

export async function hiddenMenu(): Promise<void> {
    const rev = ROFI_RETV();
    if (rev === undefined) {
        // Launcher: no hidden clients -> nothing to offer — fall back to
        // the windows switcher (in-process chain now).
        const rows = await hiddenRows();
        if (!rows.trim()) {
            ui("hidden: no hidden clients -> windows fallback (focused excluded)");
            return windowsMenu([], { excludeFocused: true });
        }
        // Exactly one hidden window left: no menu needed, just reveal it.
        const rowCount = rows.split("\x00").filter(Boolean).length;
        if (rowCount === 1) {
            const minimized: string[] = [];
            for (const wid of await windowOrder()) {
                if ((await hc.attr(`clients.${wid}.minimized`)) === "true") {
                    minimized.push(wid);
                }
            }
            const wid = minimized[0];
            if (wid) {
                ui("hidden: single hidden client %s -> reveal", wid);
                await revealWid(wid);
                return;
            }
        }
        // narrower than the shared window-switcher theme default
        launchRofi([
            "-show", "hidden",
            "-modi", modeSpec("hidden", ["hidden"]),
            "-theme", SWITCHER_THEME,
            "-theme-str", "window { width: 35em; }",
            "-auto-select",
            "-kb-custom-1", "MouseSecondary",
        ], ["hidden"]);
    }

    switch (rev) {
        case "0": // initial call: emit the hidden window rows
            process.stdout.write(menuOpt("use-hot-keys", "true"));
            process.stdout.write(menuOpt("prompt", "hidden"));
            process.stdout.write(menuOpt("no-custom", "true"));
            process.stdout.write(await hiddenRows());
            break;
        case "1": // accepted a row: bring (follows the window to its tag)
            await hc.cmd("bring", process.env.ROFI_INFO ?? "");
            break;
        case "10": // right-click hot-key: jumpto (unminimize + focus)
            await hc.cmd("jumpto", process.env.ROFI_INFO ?? "");
            break;
    }
    // Actions print no rows, so rofi quits
}
