// src/lib/hc.ts — thin async wrapper around herbstclient.
// No side effects on import. Bun ESM, no deps. Missing objects resolve
// to null, never throw. Unreachable WM means empty results; callers
// fail soft.

import { execFile } from "node:child_process";
import { promisify } from "node:util";

const execFileP = promisify(execFile);

import { clients as dbg } from "./debug";

/** DISPLAY is localhost:0.0 on this WSL2 host (repo convention). */
function env(): NodeJS.ProcessEnv {
    return { ...process.env, DISPLAY: process.env.DISPLAY || "localhost:0.0" };
}

export interface HcResult {
    stdout: string;
}

/**
 * Run `herbstclient <args...>`. Resolves { stdout } on success.
 * herbstclient exits nonzero on missing objects / errors — treat as
 * soft failure: resolve null instead of throwing.
 */
export async function cmd(...args: string[]): Promise<HcResult | null> {
    const t0 = Date.now();
    try {
        const { stdout } = await execFileP("herbstclient", args, {
            env: env(),
            timeout: 5000,
        });
        dbg("cmd %j -> ok (%dms, %d bytes)", args, Date.now() - t0, stdout.length);
        if (stdout.length <= 200) dbg("  stdout: %j", stdout.trimEnd());
        return { stdout };
    } catch (err) {
        const e = err as NodeJS.ErrnoException & { code?: string | number };
        dbg("cmd %j -> FAIL (%dms): %s", args, Date.now() - t0,
            e.code !== undefined ? `exit ${e.code}` : err);
        return null;
    }
}

/**
 * Read an object attribute. Returns the trimmed string, or null when
 * the object/attribute does not exist (herbstclient nonzero exit).
 */
export async function attr(path: string): Promise<string | null> {
    const r = await cmd("attr", path);
    if (r === null) return null;
    const s = r.stdout.trim();
    return s === "" ? null : s;
}

/** Write an attribute: set_attr <path> <value> */
export async function setAttr(path: string, value: string | boolean | number): Promise<HcResult | null> {
    return cmd("set_attr", path, String(value));
}

/** Toggle an attribute: attr <path> toggle */
export async function toggleAttr(path: string): Promise<HcResult | null> {
    return cmd("attr", path, "toggle");
}

// list_clients options

export interface ListClientsOptions {
    /** tag NAME */
    tag?: string;
    /** FLAT frame index */
    frame?: string;
}

/**
 * list_clients. Options: { tag, frame } — tag is a tag NAME, frame is
 * the FLAT frame index (an object path is silently ignored by hlwm and
 * would return ALL tag clients — never pass dotted paths here).
 * Returns array of winid strings (WM order, never sorted).
 */
export async function listClients({ tag, frame }: ListClientsOptions = {}): Promise<string[]> {
    const args = ["list_clients"];
    if (tag !== undefined) args.push(`--tag=${tag}`);
    if (frame !== undefined) args.push(`--frame=${frame}`);
    const r = await cmd(...args);
    if (r === null) {
        dbg("listClients %j -> [] (wm failure)", { tag, frame });
        return [];
    }
    const wids = r.stdout.split("\n").map((s) => s.trim()).filter(Boolean);
    dbg("listClients %j -> %d wids: %j", { tag, frame }, wids.length, wids);
    return wids;
}

/** dump — the layout tree as a single string, or null on failure. */
export async function dump(): Promise<string | null> {
    const r = await cmd("dump");
    return r === null ? null : r.stdout;
}

// Convenience wrappers for the commands used by the actions.
export const jumpto = (wid: string) => cmd("jumpto", wid);
export const raise = (wid: string) => cmd("raise", wid);
export const close = (wid: string) => cmd("close", wid);
export const remove = () => cmd("remove");
export const lock = () => cmd("lock");
export const unlock = () => cmd("unlock");
