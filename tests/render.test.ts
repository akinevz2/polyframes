// tests/render.test.ts — top-down behaviour spec for the polyframes bar
// renderer (bun:test port of the node:test suite in the dotfiles JS
// original). The first test is the user-facing contract, stated
// declaratively; the following tests pin down the concrete pieces that
// contract is built from.
import { describe, expect, test } from "bun:test";

import { render } from "../src/lib/render";
import { groupClients, keyOf } from "../src/lib/groups";
import type { Client } from "../src/lib/clients";

// Deterministic fixture: two frames, each with two tiled windows of the
// same class, plus one floating and one minimized window.
const CLIENTS: Client[] = [
    { wid: "0xa1", cls: "code", min: false, ttl: "editor", flt: false, frame: "0" },
    { wid: "0xa2", cls: "code", min: false, ttl: "diff", flt: false, frame: "0" },
    { wid: "0xb1", cls: "Alacritty", min: false, ttl: "shell", flt: false, frame: "1" },
    { wid: "0xb2", cls: "Alacritty", min: false, ttl: "logs", flt: false, frame: "1" },
    { wid: "0xf1", cls: "pavucontrol", min: false, ttl: "volume", flt: true, frame: "-1" },
    { wid: "0xm1", cls: "Alacritty", min: true, ttl: "hidden", flt: false, frame: "1" },
];

// Frame selection lookup stub: frame 0 shows 0xa2, frame 1 shows 0xb1.
const selFn = async (flat: string) =>
    flat === "0" ? "0xa2" : flat === "1" ? "0xb1" : null;

const ONCLICK = "polyframes";

describe("renderer contract", () => {
    test("outputs labels grouped by frame and window class with click and scroll handlers", async () => {
        const groups = await groupClients(CLIENTS, "0xa2", selFn);
        const bar = render(groups, ONCLICK);

        // One label per group: frame 0 (code), frame 1 (Alacritty),
        // floating pavucontrol, minimized Alacritty — first-wins dedup
        // in WM order.
        const labels = bar.split("%{F#888888}·%{F-}").map((s) => s.trim());
        expect(labels.length).toBe(4); // one label per <frame, class>

        // Each label carries all five action slots — plus their
        // matching %{A} closers (the redesigned CLI surface).
        for (const label of labels) {
            expect(label).toContain("%{A1:"); // left (or scroll) click
            expect(label).toContain("%{A2:"); // right click
            expect(label).toContain("%{A3:"); // middle click
            expect(label).toMatch(/%{A4:.*up:}/); // scroll up
            expect(label).toMatch(/%{A5:.*down:}/); // scroll down
            expect((label.match(/%{A}/g) ?? []).length).toBe(5);
        }
        // Every action references the CLI by its absolute self path.
        expect(bar).not.toContain("node ");
        expect(bar).not.toContain("index.js");
    });

    test("click routing: inactive groups focus their titular window; the FOCUSED group opens the switcher", async () => {
        // No active window: every group is inactive -> A1 = toggle-focus
        // on the group's REPRESENTATIVE (focus-first navigation).
        const groups = await groupClients(CLIENTS, "", selFn);
        const bar = render(groups, ONCLICK);

        expect(bar).toMatch(new RegExp(`%{A1:${ONCLICK} toggle-focus --wid 0xm1:}`));
        expect(bar).toMatch(new RegExp(`%{A1:${ONCLICK} toggle-focus --wid 0xa2:}`));
        expect(bar).toMatch(new RegExp(`%{A1:${ONCLICK} toggle-focus --wid 0xb1:}`));
        expect(bar).not.toContain(`switcher 0`);

        // The focused group (frame 0's code group, rep 0xa2) -> the
        // switcher; the OTHER groups stay focus-first.
        const focused = await groupClients(CLIENTS, "0xa2", selFn);
        const bar2 = render(focused, ONCLICK);
        expect(bar2).toMatch(new RegExp(`%{A1:${ONCLICK} switcher 0 "code":}`));
        expect(bar2).toMatch(new RegExp(`%{A1:${ONCLICK} toggle-focus --wid 0xb1:}`));
    });

    test("right click dismisses; middle click opens the menu", async () => {
        const groups = await groupClients(CLIENTS, "", selFn);
        const bar = render(groups, ONCLICK);

        expect(bar).toMatch(new RegExp(`%{A2:${ONCLICK} dismiss --wid 0xa2:}`));
        expect(bar).toMatch(new RegExp(`%{A3:${ONCLICK} menu --wid 0xa2:}`));
    });

    test("scroll handlers carry the label's representative wid with explicit direction", async () => {
        const groups = await groupClients(CLIENTS, "", selFn);
        const bar = render(groups, ONCLICK);

        expect(bar).toMatch(new RegExp(`%{A4:${ONCLICK} scroll --wid 0xa2 --dir up:}`));
        expect(bar).toMatch(new RegExp(`%{A5:${ONCLICK} scroll --wid 0xa2 --dir down:}`));
        expect(bar).toMatch(new RegExp(`%{A4:${ONCLICK} scroll --wid 0xb1 --dir up:}`));
    });

    test("the globally focused window's label gets the focused underline", async () => {
        const groups = await groupClients(CLIENTS, "0xb1", selFn); // focus inside frame 1
        const bar = render(groups, ONCLICK); // no currentFrame: legacy call

        const labels = bar.split("%{F#888888}·%{F-}");
        const alacrittyTiling = labels.find((l) => l.includes("shell"))!;
        const codeLabel = labels.find((l) => l.includes("diff"))!;
        expect(alacrittyTiling).toContain("%{u#FEEF69}"); // focused: gold
        // The code group is a multi-window group: WHITE underline
        // (group indicator), white text (its windows are visible).
        expect(codeLabel).toContain("%{+u}");
        expect(codeLabel).toContain("%{u#ffffff}");
        expect(codeLabel).toContain("%{F#eeeeee}");
    });

    test("the CURRENT FRAME's multi-window group: gold underline + yellow text", async () => {
        const groups = await groupClients(CLIENTS, "", selFn); // focus elsewhere (a float)
        const bar = render(groups, ONCLICK, {}, "0"); // current frame = 0
        const codeLabel = bar.split("%{F#888888}·%{F-}").find((l) => l.includes("diff"))!;
        expect(codeLabel).toContain("%{u#FEEF69}");   // gold underline
        expect(codeLabel).toContain("%{F#FEEF69}");   // yellow text
        expect(codeLabel).not.toContain("%{F#eeeeee} ");
    });

    test("a NOT-VISIBLE multi-window group: grey text + white underline", async () => {
        // Frame 0's Alacritty group when frame 0's selection belongs to
        // another class: the group is grouped-but-hidden.
        const mixed: Client[] = [
            { wid: "0xa1", cls: "code", min: false, ttl: "editor", flt: false, frame: "0" },
            { wid: "0xa2", cls: "code", min: false, ttl: "diff", flt: false, frame: "0" },
            { wid: "0xc1", cls: "Acme", min: false, ttl: "acme", flt: false, frame: "0" },
        ];
        const groups = await groupClients(mixed, "", async () => "0xc1"); // Acme owns the selection
        const bar = render(groups, ONCLICK, {}, "0");
        const codeLabel = bar.split("%{F#888888}·%{F-}").find((l) => l.includes("editor"))!;
        // NOT-VISIBLE groups render grey with the white group
        // underline — the visibility dim outranks the current-frame
        // gold/yellow styling (user re-spec).
        expect(codeLabel).toContain("%{F#888888}");
        expect(codeLabel).toContain("%{u#ffffff}");
        expect(codeLabel).not.toContain("%{u#FEEF69}");
    });

    test("a solo VISIBLE (floating) window: white text, no underline", async () => {
        const solo: Client[] = [
            { wid: "0xa1", cls: "pavucontrol", min: false, ttl: "volume", flt: true, frame: "-1" },
        ];
        const groups = await groupClients(solo, "", async () => null);
        const bar = render(groups, ONCLICK, {}, "0");
        expect(bar).toContain("%{F#eeeeee}");
        expect(bar).not.toContain("%{+u}");
    });

    test("minimized labels render dimmed, without underline", async () => {
        const groups = await groupClients(CLIENTS, "", selFn);
        const bar = render(groups, ONCLICK);
        const labels = bar.split("%{F#888888}·%{F-}");
        const minLabel = labels.find((l) => l.includes("%{F#888888} hidden")) ?? bar;
        expect(minLabel).toContain("%{F#888888}");
        expect(minLabel).not.toContain("%{+u}");
    });

    test("forbidden classes are never rendered", async () => {
        const groups = await groupClients(
            [{ wid: "0xp", cls: "Polybar", min: false, ttl: "bar", flt: false, frame: "-1" }],
            "",
            selFn,
        );
        expect(render(groups, ONCLICK)).toBe("");
    });

    test("empty desktop: the static click map — five uniform actions", () => {
        const bar = render([], ONCLICK);
        const self = "polyframes";
        // left = hidden, right = launch, middle = launch,
        // scroll up = tags, scroll down = tags
        expect(bar).toBe(
            `%{A1:${self} hidden:}%{A2:${self} launch:}%{A3:${self} launch:}`
            + `%{A4:${self} tags:}%{A5:${self} tags:}`
            + `Desktop%{A}%{A}%{A}%{A}%{A}`,
        );
        // No dots helper names leak into the bar.
        expect(bar).not.toContain("rofi_");
    });

    test("titles are truncated to char_limit with an ellipsis", async () => {
        const groups = await groupClients(
            [{ wid: "0xl", cls: "X", min: false, ttl: "a".repeat(50), flt: false, frame: "-1" }],
            "",
            selFn,
        );
        const bar = render(groups, ONCLICK);
        expect(bar).toMatch(/a{19}…/);
    });

    test("more groups than max_windows renders a +N overflow indicator", async () => {
        const many: Client[] = Array.from({ length: 20 }, (_, i) => ({
            wid: `0x${i}`, cls: `c${i}`, min: false, ttl: `t${i}`, flt: false, frame: "-1",
        }));
        const groups = await groupClients(many, "", selFn);
        const bar = render(groups, ONCLICK);
        expect(bar).toMatch(/\+5$/); // 20 groups, 15 shown
    });

    test("labels are sorted: tiled and floating first, minimized last (stable WM order)", async () => {
        const groups = await groupClients(CLIENTS, "", selFn);
        const bar = render(groups, ONCLICK);
        const shown = bar.split("%{F#888888}·%{F-}").map((l) => l.replace(/%{[^}]*}/g, "").trim());
        // tiling/tiling/float.../...... }; the minimized "hidden" label is last.
        expect(shown[shown.length - 1]).toContain("hidden");
    });
});

describe("grouping contract", () => {
    test("one label per (frame, class); tiled representative is the frame's selected client", async () => {
        const groups = await groupClients(CLIENTS, "0xa2", selFn);
        const tiled = groups.filter((g) => g.state === "tiling");

        expect(tiled.map((g) => [g.frame, g.cls, g.rep, g.count])).toEqual([
            ["0", "code", "0xa2", 2], // frame 0's selection, not the first row
            ["1", "Alacritty", "0xb1", 2],
        ]);
    });

    test("minimized and floating windows are their own solo labels", async () => {
        const groups = await groupClients(CLIENTS, "", selFn);
        const solo = groups.filter((g) => g.state !== "tiling");

        expect(solo.map((g) => [g.state, g.rep, g.count])).toEqual([
            ["flt", "0xf1", 1],
            ["min", "0xm1", 1], // min window keeps its own wid
        ]);
    });

    test("unsplit root (frame -1) means every window is its own label", async () => {
        const unsplit = CLIENTS.map((c) => ({ ...c, frame: "-1" }));
        const groups = await groupClients(unsplit, "", selFn);
        expect(groups.length).toBe(unsplit.length);
        expect(groups.every((g) => g.frame === "-1" && g.count === 1)).toBe(true);
    });

    test("mixed-frame titles don't leak the selection's class title", async () => {
        // Frame 0 holds code + Acme; its selection is the Acme window.
        const mixed: Client[] = [
            { wid: "0xc1", cls: "code", min: false, ttl: "editor", flt: false, frame: "0" },
            { wid: "0c2", cls: "Acme", min: false, ttl: "acme", flt: false, frame: "0" },
        ];
        const groups = await groupClients(mixed, "", async () => "0c2");
        const codeGroup = groups.find((g) => g.cls === "code")!;
        expect(codeGroup.rep).toBe("0xc1"); // selection rejected: other class
        // Title comes from THE REP's own row (its own title here), never
        // from the frame selection's "acme".
        expect(codeGroup.title).toBe("editor");
        expect(codeGroup.isVisible).toBe(0);
    });

    test("group keys follow the minflt/unframed/frame taxonomy", () => {
        expect(keyOf(CLIENTS[0])).toBe("frame|0|code");
        expect(keyOf({ ...CLIENTS[0], frame: "-1" })).toBe("unframed|0xa1");
        expect(keyOf({ ...CLIENTS[0], min: true })).toBe("minflt|0xa1");
        expect(keyOf({ ...CLIENTS[0], flt: true })).toBe("minflt|0xa1");
    });
});
