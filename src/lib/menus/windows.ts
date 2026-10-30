// src/lib/menus/windows.ts — rofi script-mode window switcher for hlwm
// (port of herbst/.local/bin/rofi_windows).
//
// Without $ROFI_RETV it execs rofi pointing at this binary (listing
// windows of the given WM_CLASS, else all windows, across all tags);
// rofi calls back into this module for the rows and every action. The
// window-switcher.rasi styling tells the states apart:
//   default - visible: on the focused tag, not minimized
//   active  - unminimized: running on another tag
//   urgent  - minimized: hidden
// Enter/left click jumps to the window, right click toggles its
// minimized state; every action quits rofi.
//
// Back-compat: $PROMPT / $WIDTH_EM (shell-era envs) override the mode
// name and window width, and $POLYWINS_WRAP=1 turns row acceptance into
// "write the wid to $POLYWINS_SEL" (polywins integration contract).

import * as hc from "../hc";
import { ui } from "../debug";
import { row, menuOpt, ROFI_RETV, launchRofi, modeSpec } from "./rofi";
import { clientFields, windowOrder } from "./clients";

const SWITCHER_THEME = `${process.env.HOME}/.config/rofi/window-switcher.rasi`;

async function windowRows(
    filterCls: string,
    filterFrame: string,
    excludeFocused = false,
): Promise<string> {
    // MRU first (X stacking top-down). Frame filtering keeps the
    // switcher scoped to one frame + class group.
    const currentTag = await hc.attr("tags.focus.name");
    if (currentTag === null) return "";
    let out = "";
    const focusedWid = excludeFocused
        ? ((await hc.attr("clients.focus.winid")) ?? "")
        : "";
    for (const wid of await windowOrder()) {
        const f = await clientFields(wid);
        if (!f) continue;
        if (focusedWid && f.wid === focusedWid) continue;
        if (filterCls && f.cls !== filterCls) continue;
        // frame filter: normalize hlwm's empty root index to 0
        let frame = (await hc.attr(`clients.${f.wid}.parent_frame.index`)) ?? "";
        if (frame === "") frame = "0";
        if (filterFrame && frame !== filterFrame) continue;
        const disp = f.ttl || f.cls;
        // No icon fields: rofi 2.0 loads row icons even with
        // element-icon size 0, tripping the GDK pixbuf width assertion.
        if (f.min) {
            // minimized: hidden
            out += row(disp, "urgent", "true", "info", f.wid);
        } else if (f.tg !== currentTag) {
            // unminimized on another tag
            out += row(disp, "active", "true", "info", f.wid);
        } else {
            // visible on the focused tag
            out += row(disp, "info", f.wid);
        }
    }
    return out;
}

export async function windowsMenu(
    args: string[],
    opts?: { excludeFocused?: boolean },
): Promise<void> {
    const [cls = "", frame = ""] = args;
    const rev = ROFI_RETV();

    if (rev === undefined) {
        // Launcher: the class to filter by travels along in the mode
        // command. PROMPT/widthEm (shell-era env overrides, optional in
        // that order) override the mode name and window width.
        const prompt = process.env.PROMPT || "windows";
        const width = process.env.WIDTH_EM || "40";
        launchRofi([
            "-show", prompt,
            "-modi", modeSpec(prompt, ["windows", cls, frame]),
            "-theme", SWITCHER_THEME,
            "-theme-str", `window { width: ${width}em; }`,
            "-auto-select",
            "-kb-custom-1", "MouseSecondary",
        ], ["windows", cls, frame]);
    }

    switch (rev) {
        case "0": // initial call: emit the window rows
            process.stdout.write(menuOpt("use-hot-keys", "true"));
            process.stdout.write(menuOpt("prompt", "windows"));
            process.stdout.write(menuOpt("no-custom", "true"));
            process.stdout.write(await windowRows(cls, frame));
            break;
        case "1": { // accepted a row: left click state machine
            const info = process.env.ROFI_INFO ?? "";
            if (process.env.POLYWINS_WRAP === "1") {
                const { writeFile } = await import("node:fs/promises");
                await writeFile(process.env.POLYWINS_SEL || "/tmp/polywins-sel", `${info}\n`);
                return;
            }
            const [minimized, floating, currentTag, windowTag] = await Promise.all([
                hc.attr(`clients.${info}.minimized`),
                hc.attr(`clients.${info}.floating`),
                hc.attr(`tags.focus.name`),
                hc.attr(`clients.${info}.tag`),
            ]);
            if (minimized === "true") {
                // Minimized: always jumpto (unminimize + focus)
                await hc.cmd("jumpto", info);
            } else if (windowTag !== currentTag) {
                // Not minimized and on different tag → jumpto
                await hc.cmd("jumpto", info);
            } else if (
                (await hc.cmd("compare", `clients.${info}.tag`, "=", "tags.focus.name")) === null
            ) {
                // On same tag but not currently focused → focus
                // (compare fails when the two attrs differ)
                await hc.cmd("jumpto", info);
            } else if (floating !== "true") {
                // On same tag and focused, not floating → float
                await hc.cmd("set_attr", `clients.${info}.floating`, "true");
            } else {
                // On same tag and focused + floating → minimize
                await hc.cmd("set_attr", `clients.${info}.minimized`, "true");
            }
            break;
        }
        case "10": { // right click state machine
            const info = process.env.ROFI_INFO ?? "";
            const [currentTag, minimized, windowTag, focused] = await Promise.all([
                hc.attr("tags.focus.name"),
                hc.attr(`clients.${info}.minimized`),
                hc.attr(`clients.${info}.tag`),
                hc.attr("clients.focus.winid"),
            ]);
            if (windowTag !== currentTag) {
                // On another tag → bring (don't switch tags)
                await hc.cmd("bring", info);
            } else if (info === focused) {
                // On focused tag and already focused → minimize
                await hc.cmd("set_attr", `clients.${info}.minimized`, "true");
            } else {
                // On focused tag but not focused → focus + float
                await hc.cmd("jumpto", info);
                await hc.cmd("set_attr", `clients.${info}.floating`, "true");
                // If already minimized, unminimize
                if (minimized === "true") {
                    await hc.cmd("set_attr", `clients.${info}.minimized`, "false");
                }
            }
            break;
        }
    }
    // Actions print no rows, so rofi quits
}
