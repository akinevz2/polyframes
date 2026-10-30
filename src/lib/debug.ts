// src/lib/debug.ts — layered verbose logging for the polyframes modules.
//
// Logging is organized into four independent LAYERS, each toggleable on
// its own:
//
//   ui      — user interaction: bar rendering, click/scroll dispatch,
//             rofi menus, everything the user directly triggers
//   clients — client operations: enumeration, per-client attribute
//             reads, frame attribution
//   frames  — frame operations: selection lookups, flat/dotted index
//             conversion, frame tree queries
//   format  — formatting operations: grouping decisions, polybar string
//             assembly, truncation, colors
//
// Enabling layers (any combination):
//   POLYFRAMES_VERBOSE=ui,frames   only those layers
//   POLYFRAMES_VERBOSE=1           all layers
//   -v / --verbose                 all layers (bare daemon/`--once` input)
//
// Output goes to /tmp/polyframes.log (append) with a layer tag:
//
//   [polyframes:ui] ...
//   [polyframes:clients] ...
//   [polyframes:frames] ...
//   [polyframes:format] ...
//
// Why a file: polybar's custom/script module captures the child's
// STDOUT as the bar line, and stderr from the herbst.service unit is
// hard to correlate with click events. A dedicated log file is always
// available and never corrupts the bar:
//
//   tail -f /tmp/polyframes.log

import { createWriteStream, type WriteStream } from "node:fs";

export const LAYERS = ["ui", "clients", "frames", "format"] as const;
export type Layer = (typeof LAYERS)[number];

// Layer enablement: the env var selects individual layers
// (comma-separated), "1"/"all"/"true" enables everything.
let layerSet: Set<Layer> | null = null;
{
    const raw = process.env.POLYFRAMES_VERBOSE;
    if (raw === "1" || raw === "all" || raw === "true") {
        layerSet = new Set(LAYERS);
    } else if (raw) {
        layerSet = new Set(
            raw.split(/[,\s]+/).filter((l): l is Layer => (LAYERS as readonly string[]).includes(l)),
        );
    }
}

/** Enable exactly the named layers programmatically (used by tests). */
export function setLayers(...names: Layer[]): void {
    layerSet = new Set(names.filter((n) => (LAYERS as readonly string[]).includes(n)));
}

/** Enable/disable everything at once (used by tests). */
export function setVerbose(on: boolean): void {
    layerSet = on ? new Set(LAYERS) : new Set();
}

export function isVerbose(layer?: Layer): boolean {
    if (!layerSet || layerSet.size === 0) return false;
    return layer === undefined ? true : layerSet.has(layer);
}

/** The single debug log file (append mode). Opened lazily and kept open
 *  for the process lifetime. Falls back to stderr if the file cannot
 *  be opened. */
const LOG_PATH = "/tmp/polyframes.log";
let logStream: WriteStream | null = null;
let fellBack = false;
function logStreamFor(): WriteStream {
    if (fellBack) return process.stderr as unknown as WriteStream;
    if (!logStream) {
        try {
            logStream = createWriteStream(LOG_PATH, { flags: "a" });
            logStream.on("error", () => {
                fellBack = true; // carve to stderr permanently
                logStream = null;
            });
        } catch {
            fellBack = true;
            return process.stderr as unknown as WriteStream;
        }
    }
    return logStream ?? (process.stderr as unknown as WriteStream);
}

/** printf-style formatting via Node's util.format (Bun implements it). */
import { format as printf } from "node:util";

/** Emit one line for a layer if that layer is enabled. Goes to the
 *  debug log file (never stdout — polybar reads stdout as the bar). */
function emit(layer: Layer, fmt: string, args: unknown[]): void {
    if (!layerSet || !layerSet.has(layer)) return;
    logStreamFor().write(`[polyframes:${layer}] ${printf(fmt, ...args)}\n`);
}

/** printf-style debug on the "ui" layer. */
export const ui = (fmt: string, ...args: unknown[]) => emit("ui", fmt, args);
/** printf-style debug on the "clients" layer. */
export const clients = (fmt: string, ...args: unknown[]) => emit("clients", fmt, args);
/** printf-style debug on the "frames" layer. */
export const frames = (fmt: string, ...args: unknown[]) => emit("frames", fmt, args);
/** printf-style debug on the "format" layer. */
export const formatLayer = (fmt: string, ...args: unknown[]) => emit("format", fmt, args);
/** Alias matching the JS original's module shape. */
export const format = formatLayer;

/** Un-gated error line — always written to the debug log regardless
 *  of the layer selection (detached processes' failure paths must
 *  never be silent). */
export function always(msg: string): void {
    logStreamFor().write(`[polyframes:error] ${msg}\n`);
}

/** Dump a value (Bun deep-inspect semantics, unlimited depth) if
 *  enabled. Written to the debug log file, never to stdout (polybar
 *  reads stdout as the bar line). */
export function dir(layer: Layer, label: string, value: unknown): void {
    if (!layerSet || !layerSet.has(layer)) return;
    let text: string;
    try {
        text = Bun.inspect(value, { depth: Infinity });
    } catch {
        text = `[uninspectable value for ${label}]`;
    }
    logStreamFor().write(`[polyframes:${layer}] ${label}:\n${text}\n`);
}
