// tests/fit.test.ts — pins for the fitWithinRect constraint math
// (hc_fit_to → polyframes fit: monitor (default) and frame targets):
// shrink oversized windows, nudge off-screen ones, leave fitting ones
// untouched — deco margins included.
import { describe, expect, test } from "bun:test";

import { fitWithinRect, type Rect } from "../src/lib/center";

// Monitor work area: 1552x1392 at (4,4), as hlwm reports it.
const MON: Rect = { x: 4, y: 4, width: 1552, height: 1392 };
// Decoration outline: 6 left, 35 top, 6 right, 6 bottom (typical hlwm float).
const DECO = { L: 6, T: 35, R: 6, B: 6 };

describe("fitWithinRect", () => {
    test("a fitting window is untouched (idempotent)", () => {
        const r = fitWithinRect(
            MON,
            { x: 200, y: 200, width: 640, height: 480 },
            DECO,
        );
        expect(r.resized).toBe(false);
        expect(r.nudged).toBe(false);
    });

    test("shrinks windows bigger than the work area (deco-aware)", () => {
        const r = fitWithinRect(
            MON,
            { x: 4, y: 4, width: 1700, height: 1500 }, // exceeds the monitor
            DECO,
        );
        expect(r.width).toBe(1552 - 6 - 6);   // 1540
        expect(r.height).toBe(1392 - 35 - 6); // 1351
        expect(r.resized).toBe(true);
    });

    test("nudges partially off-screen windows back inside (right/bottom)", () => {
        const r = fitWithinRect(
            MON,
            { x: 1200, y: 1000, width: 800, height: 600 }, // hangs off right+bottom
            DECO,
        );
        expect(r.x).toBe(4 + 1552 - 6 - 800 + 6 > 0 ? MON.x + MON.width - DECO.R - 800 : 0);
        expect(r.x).toBe(MON.x + MON.width - DECO.R - 800); // 752
        expect(r.y).toBe(MON.y + MON.height - DECO.B - 600); // 831
        // bounds kept: window bottom and right inside the monitor
        expect(r.x + r.width).toBeLessThanOrEqual(MON.x + MON.width - DECO.R);
        expect(r.y + r.height).toBeLessThanOrEqual(MON.y + MON.height - DECO.B);
        expect(r.nudged).toBe(true);
        expect(r.resized).toBe(false);
    });

    test("nudges windows dragged past the left/top edge", () => {
        const r = fitWithinRect(
            MON,
            { x: -300, y: -80, width: 500, height: 400 },
            DECO,
        );
        expect(r.x).toBe(MON.x + DECO.L); // 10
        expect(r.y).toBe(MON.y + DECO.T); // 39
    });

    test("resize + nudge compose (huge window dragged off-screen)", () => {
        const r = fitWithinRect(
            MON,
            { x: -500, y: -300, width: 2200, height: 1600 },
            DECO,
        );
        expect(r.width).toBe(MON.width - DECO.L - DECO.R);
        expect(r.height).toBe(MON.height - DECO.T - DECO.B);
        expect(r.x).toBe(MON.x + DECO.L);
        expect(r.y).toBe(MON.y + DECO.T);
        expect(r.resized).toBe(true);
        expect(r.nudged).toBe(true);
    });

    test("content respects the decoration outline (full outline on screen)", () => {
        // A window pinned exactly at the top-left content edge: with
        // deco margins the outline starts at the monitor edge exactly.
        const r = fitWithinRect(MON, { x: 10, y: 39, width: 640, height: 480 }, DECO);
        expect(r.x).toBe(10);
        expect(r.y).toBe(39);
        expect(r.resized).toBe(false);
        expect(r.nudged).toBe(false);
    });
});
