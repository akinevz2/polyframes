// tests/integration.test.ts — live-WM integration tests (bun:test port
// of the dotfiles JS original).
//
// Each test creates a fresh hlwm tag, spawns real windows (Alacritty as
// window class 1, Byobu as window class 2 — via
// `alacritty --class Byobu -e byobu` since byobu itself is not a window
// manager client), arranges the requested frame layout, and exercises
// the polyframes submodules (clients, frames, groups, render) against
// the live WM. No interactivity: rofi is never invoked; actions are
// tested only through their pure/grouping building blocks.
//
// GATED behind the POLYFRAMES_LIVE_TESTS env var so plain `bun test`
// never touches the running session:
//   POLYFRAMES_LIVE_TESTS=1 bun test tests/integration.test.ts
//
// Layout permutations covered:
//   1. default max root split (single unsplit root frame, max layout)
//   2. default grid root split (single unsplit root frame, grid layout)
//   3. 2-frame split, both frames showing the same window class
//   4. 2-frame split, frames showing different window classes
//   5. 4-frame split (nested), flat indices and per-frame selection
//   6. 3-frame split with two windows in one frame (grouped label)
import { describe, expect, test, beforeAll, afterAll } from "bun:test";

import * as hc from "../src/lib/hc";
import { getClients, type Client } from "../src/lib/clients";
import { frameSelection, flatToDotted } from "../src/lib/frames";
import { groupClients, type Group } from "../src/lib/groups";
import { render } from "../src/lib/render";

const LIVE = !!process.env.POLYFRAMES_LIVE_TESTS;
const d = LIVE ? describe : describe.skip;

const TAG = "pf_integration_test";
const CLASS1 = "Alacritty";
const CLASS2 = "Byobu";

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

/** Create a fresh empty tag and switch to it. */
async function makeTag(): Promise<void> {
    await hc.cmd("add", TAG);
    await hc.cmd("use", TAG);
    const clients = await hc.listClients({ tag: TAG });
    expect(clients.length).toBe(0);
}

async function teardown(): Promise<void> {
    // Kill every window on the test tag, then merge it away.
    await hc.cmd("use", "work");
    const wids = await hc.listClients({ tag: TAG });
    for (const wid of wids) {
        await hc.cmd("close", wid);
    }
    await sleep(300);
    await hc.cmd("merge_tag", TAG);
}

/** Spawn a window of the given class on the focused (test) tag. */
async function spawnWindow(cls: string): Promise<string> {
    const before = new Set(await hc.listClients({ tag: TAG }));
    if (cls === CLASS1) {
        await hc.cmd("spawn", "alacritty");
    } else if (cls === CLASS2) {
        await hc.cmd("spawn", "alacritty", "--class", CLASS2, "-e", "byobu");
    } else {
        throw new Error(`unknown class ${cls}`);
    }
    // Wait until exactly one new client appears on the tag.
    for (let i = 0; i < 40; i += 1) {
        await sleep(250);
        const now = await hc.listClients({ tag: TAG });
        const fresh = now.filter((w) => !before.has(w));
        if (fresh.length === 1) {
            const c = await getClients();
            const row = c.find((x) => x.wid === fresh[0]);
            if (row && row.cls === cls) return fresh[0];
        }
    }
    throw new Error(`spawn ${cls}: no window appeared on ${TAG}`);
}

/** Kill a window and wait for it to disappear. */
async function killWindow(wid: string): Promise<void> {
    await hc.cmd("close", wid);
    for (let i = 0; i < 20; i += 1) {
        await sleep(200);
        const now = await hc.listClients({ tag: TAG });
        if (!now.includes(wid)) return;
    }
    throw new Error(`window ${wid} did not close`);
}

const setLayout = (name: string) => hc.cmd("set_layout", name);
const split = (dir: string, fraction = 0.5) => hc.cmd("split", dir, String(fraction));
const focusDir = (dir: string) => hc.cmd("focus", dir);

/** The flat parent_frame.index of a window. */
async function frameOf(wid: string): Promise<string> {
    const idx = await hc.attr(`clients.${wid}.parent_frame.index`);
    return idx === null ? "-1" : idx;
}

/**
 * Split the focused frame and move `wid` into the new (second) child
 * via hlwm `bring` — the reliable way to distribute windows across
 * frames (a bare `split` keeps all clients in the first child).
 */
async function splitOff(dir: string, wid: string, fraction = 0.5): Promise<string> {
    await split(dir, fraction);
    await focusDir(dir === "horizontal" ? "right" : "down");
    await hc.cmd("bring", wid);
    return frameOf(wid);
}

const focusWindow = (wid: string) => hc.cmd("jumpto", wid);

const groupCls = (active: string): Promise<Group[]> =>
    getClients().then((cs) => groupClients(cs, active));

d("live-WM integration", () => {
    beforeAll(async () => {
        // WM reachable?
        const focus = await hc.attr("tags.focus.name");
        if (focus === null) throw new Error("live WM required (herbstclient connection failed)");
    });

    test("default max root split (unsplit root, max layout)", async () => {
        await makeTag();
        try {
            const w1 = await spawnWindow(CLASS1);
            const w2 = await spawnWindow(CLASS2);
            await setLayout("max");

            // Layout: single root frame, both windows in it.
            const dump = (await hc.dump()) ?? "";
            expect(dump).toMatch(/^\(clients max:/);

            // clients: unsplit root -> every window frame "-1"
            const clients = await getClients();
            expect(clients.map((c) => c.frame).every((f) => f === "-1")).toBe(true);

            // grouping: one solo label per window (accessibility contract).
            const active = (await hc.attr("clients.focus.winid")) ?? "";
            const groups = await groupClients(clients, active);
            expect(groups.length).toBe(2);
            expect(groups.every((g) => g.frame === "-1" && g.count === 1)).toBe(true);

            // frames: no-arg selection tracks the root frame's selection.
            const sel = await frameSelection();
            expect([w1, w2].includes(sel!)).toBe(true);
            await focusWindow(w2);
            expect(await frameSelection()).toBe(w2);
            // Flat index "0" must NOT be normalized to "" — with an
            // unsplit root there is no frame 0, so the lookup must fail
            // softly.
            expect(await frameSelection("0")).toBe(null);
        } finally {
            await teardown();
        }
    });

    test("default grid root split (unsplit root, grid layout)", async () => {
        await makeTag();
        try {
            const w1 = await spawnWindow(CLASS1);
            const w2 = await spawnWindow(CLASS2);
            await setLayout("grid");

            const dump = await hc.dump();
            expect(dump).toMatch(/^\(clients grid:/);

            const clients = await getClients();
            expect(clients.every((c) => c.frame === "-1")).toBe(true);

            await focusWindow(w2);
            expect(await frameSelection()).toBe(w2);
            await focusWindow(w1);
            expect(await frameSelection()).toBe(w1);
        } finally {
            await teardown();
        }
    });

    test("2-frame split, both frames showing the same window class", async () => {
        await makeTag();
        try {
            const w1 = await spawnWindow(CLASS1);
            const w2 = await spawnWindow(CLASS1);
            await setLayout("max");
            await splitOff("horizontal", w2);

            const f1 = await frameOf(w1);
            const f2 = await frameOf(w2);
            expect(f1).not.toBe(f2);
            expect([f1, f2].sort()).toEqual(["0", "1"]);

            const clients = await getClients();
            expect(clients.map((c) => c.frame).sort()).toEqual(["0", "1"]);

            const active = (await hc.attr("clients.focus.winid")) ?? "";
            const groups = await groupClients(clients, active);
            expect(groups.length).toBe(2);
            expect(groups.every((g) => g.cls === CLASS1 && g.count === 1)).toBe(true);

            expect(await frameSelection(f1)).toBe(w1);
            expect(await frameSelection(f2)).toBe(w2);

            await focusWindow(w2);
            expect(await frameSelection(f2)).toBe(w2);
            expect(await frameSelection(f1)).toBe(w1);
        } finally {
            await teardown();
        }
    });

    test("2-frame split, frames showing different window classes", async () => {
        await makeTag();
        try {
            const w1 = await spawnWindow(CLASS1);
            const w2 = await spawnWindow(CLASS2);
            await setLayout("max");
            await splitOff("horizontal", w2);

            const f1 = await frameOf(w1);
            const f2 = await frameOf(w2);
            expect(f1).not.toBe(f2);

            const active = (await hc.attr("clients.focus.winid")) ?? "";
            const groups = await groupCls(active);

            expect(groups.length).toBe(2);
            const byCls = Object.fromEntries(groups.map((g) => [g.cls, g]));
            expect(byCls[CLASS1] && byCls[CLASS2]).toBeTruthy();
            expect(byCls[CLASS1].count).toBe(1);
            expect(byCls[CLASS2].count).toBe(1);

            expect(await frameSelection(byCls[CLASS1].frame)).toBe(byCls[CLASS1].rep);
            expect(await frameSelection(byCls[CLASS2].frame)).toBe(byCls[CLASS2].rep);

            const bar = render(groups, "polyframes");
            expect((bar.match(/%{A1:polyframes toggle-focus --wid 0x[0-9a-f]+:}/g))
                ?.length).toBe(2);
            expect((bar.match(/%{A4:polyframes scroll --wid 0x[0-9a-f]+ --dir up:}/g))
                ?.length).toBe(2);
        } finally {
            await teardown();
        }
    });

    test("4-frame split (nested), flat indices and per-frame selection", async () => {
        await makeTag();
        try {
            const w1 = await spawnWindow(CLASS1);
            const w2 = await spawnWindow(CLASS2);
            const w3 = await spawnWindow(CLASS1);
            const w4 = await spawnWindow(CLASS2);
            await setLayout("max");

            await splitOff("horizontal", w2);          // frames: 0(w1) 1(w2)
            await focusDir("left");                    // focus frame 0
            await splitOff("vertical", w3);            // 0.0(w1) 0.1(w3) 1(w2)
            await focusDir("right");                   // focus frame 1 (w2)
            await splitOff("vertical", w4);            // 0.0 0.1 1.0(w2) 1.1(w4)

            const dump = (await hc.dump()) ?? "";
            // 4 leaf frames = 3 split nodes.
            expect((dump.match(/split /g) || []).length).toBe(3);

            const clients = await getClients();
            expect(clients.length).toBe(4);
            for (const c of clients) {
                expect(c.frame).not.toBe("-1");
                expect(c.frame).toMatch(/^[01]+$/);
            }

            // flatToDotted: "00" -> "0.0" etc. (verified hlwm semantics).
            expect(flatToDotted("00")).toBe("0.0");
            expect(flatToDotted("11")).toBe("1.1");
            expect(flatToDotted("0")).toBe("0");

            for (const c of clients) {
                const sel = await frameSelection(c.frame);
                expect(sel).toBeTruthy();
                expect(await frameOf(sel!)).toBe(c.frame);
            }

            const active = (await hc.attr("clients.focus.winid")) ?? "";
            const groups = await groupClients(clients, active);
            expect(groups.length).toBe(4);
            expect(groups.every((g) => g.count === 1)).toBe(true);

            for (const wid of [w1, w2, w3, w4]) {
                await focusWindow(wid);
                const f = await frameOf(wid);
                expect(await frameSelection(f)).toBe(wid);
            }
        } finally {
            await teardown();
        }
    });

    test("3-frame split with two windows in one frame (grouped label)", async () => {
        await makeTag();
        try {
            const w1 = await spawnWindow(CLASS1);
            const w2 = await spawnWindow(CLASS1);
            const w3 = await spawnWindow(CLASS2);
            await setLayout("max");
            await splitOff("horizontal", w3); // frame 0: w1,w2 | frame 1: w3

            const active = (await hc.attr("clients.focus.winid")) ?? "";
            const groups = await groupCls(active);

            expect(groups.length).toBe(2);
            const grouped = groups.find((g) => g.count === 2)!;
            const solo = groups.find((g) => g.count === 1)!;
            expect(grouped).toBeTruthy();
            expect(solo).toBeTruthy();
            expect(grouped.cls).toBe(CLASS1);
            expect(solo.cls).toBe(CLASS2);

            const f0 = await frameOf(w1);
            expect(grouped.frame).toBe(f0);
            expect(await frameSelection(f0)).toBe(grouped.rep);
            expect([w1, w2].includes(grouped.rep)).toBe(true);

            const bar = render(groups, "polyframes");
            expect(bar).toMatch(new RegExp(`%{A1:polyframes switcher ${f0} "${CLASS1}":}`));
        } finally {
            await teardown();
        }
    });
});
