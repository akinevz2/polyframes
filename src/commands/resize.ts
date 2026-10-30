// src/commands/resize.ts — migrates the dots `hc_resize` helper into
// polyframes (dots `hc_resize` is now an exec-shim here).
//
// Legacy argv parity (what hc_zoom / the shim feed it):
//   hc_resize                -> deltas 0 0 on the FOCUSED float (canonicalize)
//   hc_resize [-10 | 40] ... -> --dx/--dy nudges ... wait: bunli cannot
//        safely take dash-prefixed positionals, so the shim translates:
//        hc_resize <dx> [dy]      -> --dx=… [--dy=…]
//        hc_resize <wid> frame    -> --wid=… --mode=frame
//        hc_resize <wid> <WxH+X+Y>-> --wid=… --mode=<WxH+X+Y>
//   This command therefore reads ONLY the --wid/--dx/--dy/--mode options.
import { defineCommand, option } from "@bunli/core";
import { z } from "zod";
import { attr } from "../lib/hc";
import { resizeDelta, resizeFill, resizeToRect } from "../lib/resize";

export default defineCommand({
    name: "resize" as const,
    description:
        "Resize a floating/pseudotiled client: delta nudges, frame-fill, or an explicit content rect (former hc_resize)",
    options: {
        wid: option(z.string().optional(), {
            description: "Target THIS window instead of the focused one", short: "w",
        }),
        dx: option(z.coerce.number().default(0), {
            description: "Width delta (pixels)", short: "x",
        }),
        dy: option(z.coerce.number().default(0), {
            description: "Height delta (pixels)", short: "y",
        }),
        mode: option(z.string().optional(), {
            description: "'frame' to fill the client's parent frame, or an explicit WxH+X+Y content rect",
        }),
    },
    handler: async ({ flags }) => {
        const wid = flags.wid || (await attr("clients.focus.winid"));
        if (!wid) {
            throw new Error("hc_resize: no focused client");
        }
        const mode = flags.mode ?? "";
        if (mode === "frame") {
            await resizeFill(wid, "frame");
            return;
        }
        if (mode === "root") {
            await resizeFill(wid, "root");
            return;
        }
        if (/^[0-9]+x[0-9]+[+-][0-9]+[+-][0-9]+$/.test(mode)) {
            await resizeToRect(wid, mode);
            return;
        }
        if (mode !== "") {
            throw new Error(`hc_resize: unknown mode '${mode}'`);
        }
        await resizeDelta(wid, flags.dx, flags.dy);
    },
});
