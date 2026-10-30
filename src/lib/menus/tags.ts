// src/lib/menus/tags.ts — rofi over all hlwm tags (port of
// herbst/.local/bin/rofi_tags).
//
// Runs as the rofi script-mode backend and as its own launcher:
//   - without $ROFI_RETV: exec rofi pointing at this binary
//   - with $ROFI_RETV:    answer rofi's callbacks:
//     - scroll up/down    switch to previous/next tag (use_index -1/+1)
//     - Enter/left click  switch to the highlighted tag
//     - typed input       an index number or a name fragment
// All accepted cases output no rows, so rofi quits right away.

import * as hc from "../hc";
import { ui } from "../debug";
import { row, menuOpt, ROFI_RETV, launchRofi, modeSpec } from "./rofi";

const THEME = `${process.env.HOME}/.config/rofi/tags.rasi`;

interface TagRow { num: number; name: string }

/** tag_status lists every tag in index order as "<marker><name>". */
async function tagList(): Promise<TagRow[]> {
    const r = await hc.cmd("tag_status");
    if (r === null) return [];
    const rows: TagRow[] = [];
    let idx = 0;
    for (const entry of r.stdout.split(/\s+/)) {
        if (!entry) continue;
        // First char is hlwm's status marker (. ! + : #); strip it.
        const name = /^[\.\!\+\:\#]/.test(entry[0]) ? entry.slice(1) : entry;
        if (name === "") continue;
        rows.push({ num: idx + 1, name });
        idx += 1;
    }
    ui("tags: tag_status -> %d tags", rows.length);
    return rows;
}

async function emitRows(): Promise<void> {
    const current = await hc.attr("tags.focus.name");
    process.stdout.write(menuOpt("use-hot-keys", "true"));
    process.stdout.write(menuOpt("prompt", "tag"));
    for (const t of await tagList()) {
        if (t.name === current) {
            process.stdout.write(row(`${t.num}  ${t.name}`, "info", t.name, "selected", "true"));
        } else {
            process.stdout.write(row(`${t.num}  ${t.name}`, "info", t.name));
        }
    }
}

export async function tagsMenu(args: string[]): Promise<void> {
    const rev = ROFI_RETV();
    if (rev === undefined) {
        // Launcher. Vertical scroll events are unhooked from row
        // navigation and rebound as custom hot-keys 1/2, so a scroll
        // confirms immediately instead of merely moving the highlight.
        const currentIdx = (await hc.attr("tags.focus.index")) ?? "0";
        launchRofi([
            "-show", "tags",
            "-modi", modeSpec("tags", ["tags"]),
            "-theme", THEME,
            "-kb-custom-1", "ScrollUp",
            "-kb-custom-2", "ScrollDown",
            "-ml-row-up", "",
            "-ml-row-down", "",
            "-selected-row", currentIdx,
        ], ["tags"]);
    }

    switch (rev) {
        case "0": // initial call: emit the tag rows
            await emitRows();
            break;
        case "1": { // accepted a listed row: jump to the selected tag
            const info = process.env.ROFI_INFO ?? "";
            ui("tags: use %s", info);
            await hc.cmd("use", info);
            break;
        }
        case "2": { // custom typed input: index number or name-prefix match
            const typed = args[0] ?? "";
            const num = typed.match(/^\d+/)?.[0] ?? "";
            if (num !== "" && Number(num) >= 1) {
                await hc.cmd("use_index", String(Number(num) - 1));
            } else {
                for (const t of await tagList()) {
                    if (t.name.startsWith(typed)) {
                        await hc.cmd("use_index", String(t.num - 1));
                        break;
                    }
                }
            }
            break;
        }
        case "10": // scroll up: confirm with the previous tag
            await hc.cmd("use_index", "-1");
            break;
        case "11": // scroll down: confirm with the next tag
            await hc.cmd("use_index", "+1");
            break;
    }

    // All handled cases output no rows, so rofi quits.
    ui("tags: done (retv %s)", rev);
}
