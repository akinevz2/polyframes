// src/lib/clickmap.ts — the bar renderer's click-action pipeline as an
// object: a fluent ClickMap builder replaces the hand-written
// %{A<slot>:<command>:} fragments render() used to emit inline.
//
// Each association binds a click kind (typed constant), the polybar
// action-slot id it opens, the polyframes command NAME that slot runs
// (documentation/round-trip; the dispatch lives in actions.ts), and a
// FORMATTER that produces that click's command string for a group.
// render() only walks the installed map: one opener per binding, the
// styled label, then one %{A} closer per binding — the openers/closers
// always balance, and the default map's five bindings pin the byte
// output the render spec asserts.

import type { Group } from "./groups";

/** Typed click kinds (polybar button semantics; the map's key). */
export const lmbClick = "lmb"; // button1 — focus/switcher
export const rmbClick = "rmb"; // button3 — dismiss
export const mmbClick = "mmb"; // button2 — window menu
export const scrollUp = "scroll-up"; // button4
export const scrollDown = "scroll-down"; // button5

export type ClickKind =
    | typeof lmbClick
    | typeof rmbClick
    | typeof mmbClick
    | typeof scrollUp
    | typeof scrollDown;

/** Polybar action-slot fragment labels (`%{A1:...:}` .. `%{A5:...:}`). */
export type PolybarSlot = "A1" | "A2" | "A3" | "A4" | "A5";

/** Formats one click's action command for a group; `self` is the CLI prefix. */
export type ActionFormatter = (group: Group, self: string) => string;

export interface ClickBinding {
    readonly click: ClickKind;
    readonly slot: PolybarSlot;
    /** command name this slot runs (round-trips with src/lib/actions.ts) */
    readonly name: string;
    readonly format: ActionFormatter;
}

export class ClickMap {
    private readonly bindings: ClickBinding[] = [];

    /** Register one click -> slot binding; fluent. */
    associate(
        click: ClickKind,
        slot: PolybarSlot,
        name: string,
        format: ActionFormatter,
    ): this {
        this.bindings.push({ click, slot, name, format });
        return this;
    }

    /** Associations in registration (emission) order. */
    get actions(): readonly ClickBinding[] {
        return this.bindings;
    }

    /** The binding registered for a click kind, if any (round-trip). */
    forClick(click: ClickKind): ClickBinding | undefined {
        return this.bindings.find((b) => b.click === click);
    }

    /**
     * Install this map as the renderer's click pipeline (the fluent
     * chain's terminal step).
     */
    install(): this {
        installClickMap(this);
        return this;
    }

    /**
     * Emit one label's action block: an %{A<slot>:<command>:} opener per
     * binding (registration order), then the styled label, then the
     * matching %{A} closers — exactly one closer per opener, so a label
     * built from an N-binding map carries N of them (the default map: 5).
     */
    emit(group: Group, self: string, label: string): string {
        let out = "";
        for (const b of this.bindings) {
            out += `%{${b.slot}:${b.format(group, self)}:}`;
        }
        return out + label + "%{A}".repeat(this.bindings.length);
    }
}

// The installed pipeline. The default map's terminal .install() (below)
// seeds it at module load, so render() walks the stock five bindings
// unless installClickMap() replaces them.
let installed: ClickMap;

/** Replace the renderer's click pipeline (e.g. custom slot layouts). */
export function installClickMap(map: ClickMap): void {
    installed = map;
}

/** The click pipeline render() currently walks. */
export function clickMap(): ClickMap {
    return installed;
}

/**
 * The five stock associations. Slot A1 carries the ONLY conditional
 * command: an ALREADY-FOCUSED multi-window group opens the switcher (to
 * pick another window within it), every other group focus-first
 * navigates its titular (representative) window via the toggle-focus
 * state machine (jumpto+raise). Frame/class are quoted so polybar
 * passes them as separate argv items. Either way exactly one A1 opener
 * is emitted (pinned by the render spec's five %{A} closers).
 *
 * A2 (right): dismiss (minimize without floating; unminimize +
 * re-center when already minimized). A3 (middle): hc_menu rofi menu on
 * the representative window. The scroll actions carry the
 * representative WID, not frame+class — the handler re-resolves the
 * window's frame/class live at click time, so the group membership is
 * always current.
 */
export const defaultClickMap: ClickMap = new ClickMap()
    .associate(lmbClick, "A1", "toggle-focus", (g, self) =>
        g.count > 1 && g.isActive === 1
            ? `${self} switcher ${g.frame} "${g.cls}"`
            : `${self} toggle-focus --wid ${g.rep}`)
    .associate(rmbClick, "A2", "dismiss", (g, self) => `${self} dismiss --wid ${g.rep}`)
    .associate(mmbClick, "A3", "menu", (g, self) => `${self} menu --wid ${g.rep}`)
    .associate(scrollUp, "A4", "scroll", (g, self) => `${self} scroll --wid ${g.rep} --dir up`)
    .associate(scrollDown, "A5", "scroll", (g, self) =>
        `${self} scroll --wid ${g.rep} --dir down`)
    .install();
