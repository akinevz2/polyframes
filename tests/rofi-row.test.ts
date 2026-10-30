// tests/rofi-row.test.ts — pin the rofi script-mode wire format
// (rofi-script(5)): rows are NEWLINE-separated; each row is
// `<display>\0<name>\x1f<value>\x1f<name>\x1f<value>`.
// A regression here garbles the menu rows (all meta bytes end up in
// the visible text).
import { describe, expect, test } from "bun:test";

import { row, menuOpt, modeSpec } from "../src/lib/menus/rofi";

describe("rofi script-mode protocol", () => {
    test("a meta-carrying row is newline-terminated with NUL before its meta pairs", () => {
        expect(row("window title", "icon", "alacritty", "urgent", "true", "info", "0x28")).toBe(
            "window title\x00icon\x1falacritty\x1furgent\x1ftrue\x1finfo\x1f0x28\n",
        );
    });

    test("a plain row is just the text and a newline", () => {
        expect(row("no meta")).toBe("no meta\n");
    });

    test("menu config lines start with NUL and are newline-terminated", () => {
        expect(menuOpt("use-hot-keys", "true")).toBe("\x00use-hot-keys\x1ftrue\n");
    });

    test("mode spec quotes the command for the rofi shell invocation", () => {
        process.env.POLYFRAMES_SELF = "/usr/bin/polyframes";
        expect(modeSpec("tags", ["tags"])).toBe("tags:'/usr/bin/polyframes' 'tags'");
        delete process.env.POLYFRAMES_SELF;
    });
});
