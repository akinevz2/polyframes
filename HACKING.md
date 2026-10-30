# HACKING — customising/porting polyframes

Guide for adapting polyframes to a different window manager (the
  code targets herbstluftwm 0.9.5, running on polybar), a different
  bar binary (stock and forked **lemonbar** is used as the worked
  example), or a different packaging environment. Read the
  architecture first: most ports are confined to three layers.

```
┌──────────────────────────────────────────────────────────────────┐
│ src/lib/bar.ts      daemon core: printBar + hook listener +      │
│                     layout poll (WM hook stream + tree hashes)   │
│ src/lib/render.ts   bar-line FORMATTING        ← bar-specific    │
│ src/lib/clients.ts  client enumeration + fields ← WM-specific    │
│ src/lib/frames.ts   frame tree + selections     ← WM-specific    │
│ src/lib/hc.ts       herbstclient wrapper        ← WM-specific    │
│ src/lib/hlwmJson.ts herbstutil parseAttr (hlwm attr format)      │
│ src/lib/spawn.ts    rule-once spawning          ← WM-specific    │
│ src/lib/tile.ts     closest-empty-frame surgery (hlwm tree)      │
│ src/lib/center.ts   floating placement (pure geometry math —     │
│                     agnostic; only the rect readers are WM-y)    │
│ src/lib/menus/*     rofi menus (hlwm queries inside)             │
│ src/lib/actions.ts  click handlers (state machines; helper       │
│                     paths + rofi are the only environment bits)  │
│ src/lib/groups.ts   pure grouping — agnostic                     │
│ src/lib/self.ts     absolute self-path — agnostic                │
│ src/lib/debug.ts    layered log — agnostic                       │
└──────────────────────────────────────────────────────────────────┘
```

Everything in `groups.ts`, the label-assembly logic inside
  `render.ts`, the menu byte-protocol plumbing, the click state
  machines and the decoration-aware centering math is WM-agnostic —
  keep those and swap the plumbing.

## 1. Porting to another window manager

### 1.1 Where hlwm shows up

- **binary/CLI wrapper** — `herbstclient <cmd>` via
  execFile — `lib/hc.ts`
- **whole-object read** — `herbstclient attr
  clients.<wid>.` as JSON via herbstutil's `parseAttr` —
  `lib/hlwmJson.ts`
- **cheap scalar reads** — `attr <path>` — `lib/hc.ts`
- **clients per tag/frame** —
  `list_clients --tag=NAME --frame=FLATIDX` — `lib/hc.ts`
- **ALL clients** — `attr clients` children `0x…` —
  `lib/menus/clients.ts` `allClientWids()`
- **focused winid** — `attr clients.focus.winid` — many
  call sites
- **tag list + order** — `tag_status`
  (marker-prefixed) — `menus/tags.ts`,
  `menus/clients.ts`
- **frame tree signature** — `dump`, hashed, polled
  1s — `lib/bar.ts`
- **frame/selection math** — flat→dotted index +
  `tags.focus.tiling.root.*.selection` —
  `lib/frames.ts`, `lib/tile.ts`
- **one-off spawn rules** — `rule once class=X
  floating=on focus=on switchtag=on` — `lib/spawn.ts`
- **frame surgery** — `split auto`, selection
  writes, `bring`/`jumpto` — `lib/tile.ts`
- **WM hook stream** — `herbstclient --idle`
  (`quit_panel`, `reload`) — `lib/bar.ts`
- **window ops** — `jumpto`, `raise`, `close`,
  `remove`, `lock`/`unlock`, `chain` — `lib/hc.ts`
- **deco geometry** — `clients.<wid>.
  decoration_geometry` / `.content_geometry` /
  `.floating_geometry` — `lib/center.ts`

Everything NOT in this table (grouping, click state machines, menu
  protocols, self-path resolution, centering math) should port with
  you unchanged.

### 1.2 Suggested approach: a WM adapter facade

Introduce an interface shaped like the current `hc.ts` and swap the
  imports:

```ts
// src/lib/wm.ts (sketch)
export interface WmAdapter {
    attr(path: string): Promise<string | null>; // null = missing
    listClients(o: { tag?: string; frame?: string }):
        Promise<string[]>;
    allClientWids(): Promise<string[]>;
    tagStatus(): Promise<string[]>;     // ordered tags
    focusedWinid(): Promise<string | null>;
    treeSignature(): Promise<string | null>; // for the poll
    ruleOnce(o: {
        cls?: string; instance?: string; title?: string;
        floating?: "on" | "off"; focus?: boolean;
        switchtag?: boolean; tag?: string;
    }, cmd: string, args: string[]): Promise<void>;
    jumpTo(wid: string): Promise<void>;
    raise(wid: string): Promise<void>;
    close(wid: string): Promise<void>;
    frameGeometry(target: "frame" | "root"): Promise<string | null>;
}
```

Keep the **fail-soft contract**: every ordinary miss resolves to
  `null`/`[]` rather than throwing — that is load-bearing for
  robustness of clicks (a vanished window must never wedge the bar).

### 1.3 Per-WM notes

#### bspwm (bspc)

* layout tree JSON: `bspc query -T -d focused` — nodes → clients,
  `focusedClient`, flags including `hidden` (minimized equivalent).
* client fields (class/title) per node: `bspc query -T -n <id>` or
  `bspc node <id> -t` conventions.
* frame equivalent: the node itself; flat-index arithmetic in
  `lib/frames.ts` becomes node-ID bookkeeping.
* one-shot spawn rules: `bspc rule -a <class> -o` one-off rules
  exist — the `spawn --center` preset maps over cleanly.
* no lock primitive; drop hlwm's `lock/unlock` sequences (or no-op
  them) — the centering/geometry writes are read-modify-write
  anyway.

#### i3 (i3-msg)

* everything from `i3-msg -t get_tree`: the `"focused": true` node
  is the active client; the float layer is reachable via the tree's
  `floating_nodes` array, which maps naturally onto our
  floating/tiling split.
* per-window attrs (class/title/WM window id) come from the node's
  `window_properties`.
* minimize does NOT exist natively in i3 — approximate the "hidden"
  group with the scratchpad (`i3-msg move scratchpad`), noting that
  scratchpad windows are workspace-less, so the `minflt` grouping
  needs a scratchpad-aware count.
* one-shot spawn rules: i3 has none; emulate either with a scoped
  `for_window` criterion + permanent marker, or spawn without
  floating rules and float via a `floating enable` message AFTER the
  window appears (poll the tree).

#### river / hyprland / niri

* river: `riverctl` with its wayland-protocol-driven events;
  hyprland: `hyprctl clients -j` (JSON clients incl. class, title,
  minimized, workspace) — that JSON maps almost 1:1 onto what
  herbstutil's `parseAttr` gave us here; niri: `niri msg windows`
  similarly.
* Wayland compositors need NOWAYLAND_DISPLAY stripping removed (rofi
  and friends are Wayland-first there; our WSLg hack is a bug on
  those platforms — see §5).

### 1.4 Porting `hlwmJson`

`lib/hlwmJson.ts` delegates the parsing of **hlwm attr output** to
  the herbstutil npm package (`parseAttr`). That tool is hlwm-
  specific; on another WM the client snapshot in `lib/clients.ts`
  should call your WM's JSON dump (`bspc query -T`, `hyprctl clients
  -j`, `i3-msg -t get_tree`) instead and produce the same `{class,
  minimized, title, tag, floating, …}`-shaped rows. Keep the
  fallback chain to plain per-field reads for robustness either way.

### 1.5 Testing another WM port

Two suites must stay green unchanged: `tests/rofi-row.test.ts` (menu
  byte protocol, bar-agnostic) and — becoming your own bar's pins —
  `tests/render.test.ts` (bytes of the polybar line today). Add
  `tests/<wm>.integration.test.ts` shaped like the hlwm one
  (`tests/integration.test.ts`, gated behind
  `POLYFRAMES_LIVE_TESTS=1`) covering: enumeration order, one-shot
  spawn flags, and the center-no-shrink regression (compare
  `floating_geometry` before and after; the shrunk-window regression
  earlier in this repo was the `m[0]` destructure bug).

## 2. Porting the BAR: LemonBar example

### 2.1 What is bar-specific today

`lib/render.ts` emits a polybar line with the five mouse slots:

* `%{A1:<cmd>:}text%{A}` for left click,
* `%{A2..A5:<cmd>:}` for right/middle/scroll-up/scroll-down,
* `%{F#color}` / `%{F-}` colors, `%{+u}%{u#FEEF69}` underline.

### 2.2 LemonBar protocol

Stock lemonbar (and close forks):

* actions: `%{A:<cmd>:}text%{A}` — ONE action per clickable area;
  the fork space (e.g. lemonbar-extended releases and various distro
  builds) adds `%{A<#>:…}` per-button and extra alignment/offset
  extensions — check your fork's README and map A2..A5 individually
  when present.
* alignment: line-embedded `%{l} … %{c} … %{r}`.
* colors: `%{B#RRGGBB}` and `%{F#RRGGBB}`; a `-` value resets to the
  bar's default (`%{F-}` / `%{B-}`) — the same convention polybar
  uses, so color emission can stay identical.
* underline: same `%{+u}` / `%{u#hex}` / `%{-u}` verbs.
* offsets: `%{O<n>}` (pixels) if you want spacing around labels.
* lines: everything printed to lemonbar's stdin is rendered as ONE
  line per frame (the whole bar is re-rendered by the last line).

### 2.3 Worked example: rendering the same label for both

The label `lib/render.ts` emits today for a single-window group
  (code trimmed for readability):

```
%{A1:{self} toggle-focus --wid 0x280003:}%
%{A2:{self} dismiss --wid 0x280003:}%
%{A3:{self} menu --wid 0x280003:}%
%{A4:{self} scroll --wid 0x280003 --dir up:}%
%{A5:{self} scroll --wid 0x280003 --dir down:}%
%{F#eeeeee}  Title %{F-}%{A}%{A}%{A}%{A}%{A}
```

Stock-lemonbar equivalent (left click only):

```
%{l}%
%{A:{self} toggle-focus --wid 0x280003:}%
%{B#1c1d21}%{F#eeeeee} Title %{F-}%{B-}%{A}%
```

and an underline label (looking for focused state) becomes:

```
%{+u}%{u#FEEF69}%{B#1c1d21}%{F#eeeeee} Title %{F-}%{B-}%{-u}%{A}
```

Bar-side glue for lemonbar is one pipe:

```sh
~/.local/bin/polyframes bar \
  | lemonbar -B "#002b36" -F "#eeeeee" -f "Noto Sans Mono-10" -a 20
```

Because a bare invocation prints one line and then keeps it fresh on
  the hook stream, the daemon can feed a permanent lemonbar
  directly:

```sh
~/.local/bin/polyframes | lemonbar -p &
```

`lib/bar.ts` (`runDaemon`) needs NO changes for this — the daemon
  contract (print a line, then keep it fresh on hooks) is bar-
  agnostic.

### 2.4 Renderer switchboard (sketch)

Keep polybar as the default (the format is pinned by tests) and add
  a backend seam:

```ts
// src/lib/render.ts (sketch)
export type BarBackend = "polybar" | "lemonbar";
const backend: BarBackend =
    (process.env.POLYFRAMES_BAR as BarBackend) || "polybar";

const ACTION = (slot: number, cmd: string) => backend === "polybar"
    ? `%{A${slot}:${cmd}:}`
    : slot === 1 ? `%{A:${cmd}:}` : "";
const ACTION_CLOSE = () => "%{A}"; // same closer for both
const FG = (c: string | null) => backend === "polybar"
    ? c ? `%{F${c}}` : "%{F-}" : c ? `%{F${c}}` : "";
```

…and so on for the alignment head/tail. The `render()` function
  keeps its pure signature; only the escape-tile emission differs.
  Then thread `render(groups, selfCommand())` through a
  `chooseRenderer()` read and add `tests/lemonbar-render.test.ts`
  pinning the byte output per label (the rofi script-mode-deviated
  protocol incident taught us that these formats really do need
  bytes-level pins).

### 2.5 What lemonbar (stock) can't do

* ONE clickable area per row segment — the five-slot contract
  (click/dismiss/menu/scroll) cannot be fully reproduced; either put
  the extra actions behind the group `switcher`/`window-menu`, or
  use an extended fork with per-button `%{A#…}` support and keep the
  same action CLI.
* scroll-up/down as separate buttons — no equivalent; consider
  keybinds firing `polyframes scroll --wid … --dir up|down`.
* per-label colors are fine, but "reset to theme default" must be
  explicit values; keep the theme constants in one place and emit
  theme colors instead of relying on bar defaults.

## 3. The daemon contract (bar-agnostic)

* bare invocation → one line, then fresh lines on hooks + 1 s layout
  poll (`runDaemon()` — pipe it into any bar that re-renders on
  newline input).
* `polyframes bar` → print ONE line and exit (scripted environments,
  status frequency).
* click actions reference the binary ITSELF (see `lib/self.ts`,
  `realpath(process.execPath)`) — no shim, no PATH assumptions,
  regardless of what bar spawned the daemon.

## 4. Theming / configuration knobs

`lib/render.ts DEFAULTS` carries every styling knob (colors,
  underline, `separator`, `char_limit`, `max_windows`,
  `forbidden_classes`, `char_case`, `add_spaces`,
  `empty_desktop_message`). A theme is a `settings` override passed
  to `render()` — no change to the grouping or daemon needed.
  Bound the knobs you care about in your own launch glue (env-
  override of `DEFAULTS` is a fine first step and stays pure).

## 5. Environment assumptions worth unfixing when you port

* **DISPLAY default** `localhost:0.0` (WSL2 + VcXsrv convention) is
  hardcoded into `lib/hc.ts`, `spawn.ts` and the menus as the
  FALLBACK when DISPLAY is unset. On a native X or Wayland session
  the fallback never triggers, so it is harmless there.
* **WAYLAND_DISPLAY stripping** happens in every detached spawn
  (`actions.ts`, `spawn.ts`, menus) because WSLg's Wayland socket
  makes dual-backend apps (rofi, xmessage) abort. On a native
  Wayland session REMOVE the strip: it would break Wayland-native
  launchers.
* **herbstutil** parses hlwm attr output (see §1.4) — not optional
  unless you replace the reader with your WM's JSON dump.
* **rofi** script mode drives the menus; dmenu/fzf equivalents can
  take over by reusing the same row emission (`menus/rofi.ts`) with
  a different dmenu surface. `fzf` has no clickable protocol — the
  window-menus keep working (they are the only ones that CARE).

## 6. Porting checklist

1. Pick your action-set mapping (§2.5) and extend `render.ts` with a
  backend seam (sketch §2.4); pin byte-level output per backend in a
  test.
2. Build the `wm` adapter against the WM's own query CLI: focus-wid,
  enumeration, fields, tree, one-shot spawn rule equivalents.
3. Keep the pure suites green (`bun test`) — they do NOT depend on
  the WM or bar.
4. Port `tile.ts` LAST (most hlwm-shaped: frame-tree walking).
5. Port `spawn.ts` rule semantics (bspwm `-o` maps well; i3 needs
  the for_window emulation).
6. Point the menus at your adapter (they mostly consume
  `listClients`/`attr`).
7. Wire the daemon to your bar (§3) — either the bar module or a
  pipe.
8. Add your WM/Bar integration tests; then iterate on pixel details
  (truncation, ordering) against `render.test.ts` pins.

## 7. Origins

polyframes originated as a JS port of shell scripts inside the
  dotfiles repository, then this Bun/Bunli rewrite. The pure modules
  are deliberately kept decoupled so re-implementation for other
  stacks stays cheap; see `README.md` for install and the current
  surface.
