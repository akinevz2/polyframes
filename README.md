# polyframes

[![CI](https://img.shields.io/github/actions/workflow/status/akinevz2/polyframes/ci.yml?branch=main&label=CI&style=flat&pretty=deferred)](https://github.com/akinevz2/polyframes/actions/workflows/ci.yml)

Polybar window-list renderer for herbstluftwm — a bunli CLI written
in TypeScript for Bun, compiled to a standalone native binary
(`~/.local/bin/polyframes`). It renders the window/frame-group label
line for `[module/polyframes]`, handles the bar's click and scroll
actions, and hosts the rofi switcher menus. Port of the dotfiles-era
JS implementation (`dots/polybar/.config/polybar/polyframes`),
which itself ported `polywins.sh` plus the `hc_get-*` /
`polyframes-*` shell helpers.

## Why compiled

The JS original required Node via nvm plus a bash shim, because
polybar's module environment does not include the nvm node bin dir
on its PATH. The standalone binary keeps the Bun runtime inside
itself and can therefore execute ITSELF in polybar `%{A1}` click
action strings — no shim, no PATH juggling, no Node.

The binary is a `bun build --compile` artifact (~120 MB — it embeds
the Bun runtime plus all code; zero runtime dependencies). Click
actions re-exec the binary itself: the click strings embed its
absolute path (`realpath(process.execPath)`), overridable with
`POLYFRAMES_SELF`.

## Install

```sh
git clone https://github.com/akinevz2/polyframes \
    ./path/to/my/personal/install/directory
cd ./path/to/my/personal/install/directory
bun install
make install      # build (glibc target) + install
                  # to ~/.local/bin/polyframes
```

The clone location is arbitrary — the binary self-locates. What IS
location-bound is the install prefix: `make install PREFIX=/opt`
puts the binary in `/opt/bin/polyframes`; the dots config references
`~/.local/bin/polyframes`, so keep the default prefix unless you
also update `[module/polyframes]`. `make install` also re-applies
the hlwm theme (`reload_theme -f`).

The binary is also deployed through the doftiles `depends`
submodule, so dots-managed machines get it without a manual build.

Runtime paths are all $HOME-relative, none repo-relative:
`$HOME/.config/rofi` (the menu themes), `$HOME/.local/bin` (the
dots helper shims), `/tmp/polyframes.log` (the debug log).

## Bar daemon and subcommands

Bare invocation is polybar's contract —
`exec = ~/.local/bin/polyframes` in `~/.config/polybar/config.ini`
starts the bar daemon: print the label line, then re-render on hlwm
hooks (`herbstclient --idle`) plus a 1 s frame-layout poll (hashed
`dump`, covering split/remove/resize, which emit no hook in hlwm
0.9.5).

```
polyframes bar        # one-shot bar line, exit
polyframes windows    # rofi window switcher across tags
polyframes tags       # rofi tag switcher
polyframes hidden     # minimized-windows picker (exits non-zero
                      # when none, for shell chaining)
polyframes launch     # rofi drun/run app launcher
polyframes tile       # nearest empty frame (or split auto) gets
                      # the window (former hc_tile)
polyframes center     # center the focused float in its frame or
                      # the workspace (former hc_center)
polyframes resize     # float resize: pixel deltas, frame-fill or
                      # an explicit content rect (former hc_resize)
polyframes fit        # shrink + nudge a float into bounds,
                      # deco-aware (monitor or frame target)
polyframes switcher <frame> <class>
                      # rofi dmenu of one (frame, class) group;
                      # re-clicking an open menu dismisses it and
                      # focuses (or minimizes) the group's window
polyframes toggle-focus --wid <wid>
                      # left-click state machine
polyframes toggle --wid <wid>
                      # alt state machine: float / minimize /
                      # unminimize-into-frame, with re-centering
polyframes dismiss --wid <wid>
                      # minimize without floating; prunes the
                      # frame when it empties; restores + re-centers
polyframes close --wid <wid>
polyframes menu --wid <wid>
                      # hc_menu window-operations menu
polyframes spawn ...  # typed one-shot `herbstclient rule once`
                      # spawns (--class/--instance/--title +
                      # --float/--switchtag/--tag/--focus/--center)
```

Debug logging never touches stdout (polybar owns that); it goes to
`/tmp/polyframes.log` — `tail -f` it. Layers: `ui`, `clients`,
`frames`, `format`. Enable with `-v` (all layers) or
`POLYFRAMES_VERBOSE=ui,format` (any combination).

## Click and scroll model

Every label is a click/scroll target. Group membership and styling
state (minimized grey, focused group's gold underline, ...) are
resolved live at click time from the SAME grouping source the
renderer used, so what you see and what a click does can never
drift apart. Click actions re-exec the binary itself.

- Left click runs a one-step state machine (`toggle-focus`):
  unminimize / focus / float / re-tile — one step per click.
- Scroll over the FOCUSED group's label:
  - multi-window groups cycle focus within the group (wraparound,
    including minimized members);
  - single-window groups ride the escalation ladder — scroll UP:
    tiled -> float + center -> maximized -> minimized; scroll DOWN
    reverses (maximized -> unmaximize, floating -> plain unfloat,
    tiled -> minimize keeping the frame).
- Scroll over an UNFOCUSED group: scroll UP focuses it (solo
  groups are raised + jumpto'd); scroll DOWN opens the tag
  switcher without focusing anything.
- A minimized group: scroll UP unminimizes + focuses it; DOWN
  opens the tag switcher.

## Dependencies

- **herbstutil** — the pure parse/attr layer; `parseAttr()` is
  imported directly and bundled into the binary. One
  `herbstclient attr clients.<wid>.` call returns the whole object
  tree with typed coercion (booleans as booleans, geometries as
  `{x,y,width,height}`) — the per-client attribute walk of the
  shell era (4-6 spawns per window) collapses into a single round
  trip. Any parse failure degrades to plain per-attribute
  `herbstclient attr` reads. Declared as a sibling `file:` dep
  (`herbstutil ^0.2.0`, npm publish pending).
- **herbctl** — the imperative layer split out of herbstutil; the
  scroll wheel reuses its `floatCenterFrame` /
  `minimizeKeepFrame` imperatives.
- External commands at runtime: `rofi`, `herbstclient`, `pgrep`,
  plus the dots helpers `hc_maximize` / `hc_unmaximize` (the
  window menu delegates Maximize to them; tile / center / resize /
  fit are managed here, including the ported `hc_deco_margins`
  geometry measurement).
- The old X-side dependency `xprop` is GONE — window enumeration
  is pure hlwm (`attr clients` children).

## Build

```sh
make build         # glibc standalone -> dist/polyframes
make build-static  # musl artifact -> dist/polyframes-musl
```

`build-static` targets musl distros and is NOT runnable on glibc
hosts (bun's musl compile still links libc.musl + libstdc++); on
this WSL2 Ubuntu host only the glibc build runs.

## Layout

```
src/
├── index.ts        entrypoint: bare/--once handled
│                   before bunli parsing
├── lib/
│   ├── bar.ts      printBar + hook listener + layout
│   │               poll (daemon core)
│   ├── hc.ts       herbstclient wrapper (missing attrs
│   │               → null, never throw)
│   ├── clients.ts  focused-tag clients, WM order, frame attribution
│   ├── frames.ts   flat-index → dotted attr path
│   │               conversions, selections
│   ├── groups.ts   pure grouping: minflt|wid /
│   │               unframed|wid / frame|f|cls
│   ├── render.ts   pure polybar bar-line formatting
│   ├── clickmap.ts fluent ClickMap:
│   │               click→slot→command bindings;
│   │               render() walks it to emit %{A}
│   ├── actions.ts  click handlers (switcher/scroll/
│   │               toggle*/dismiss/menu/close)
│   ├── debug.ts    layered verbose logging to /tmp/polyframes.log
│   └── self.ts     absolute self path for embedded click actions
└── commands/       bunli command definitions (one file each)
    └── spawn.ts    typed one-shot `herbstclient rule once` spawns
                    (`--center` floats + focuses and then
                    decor-AWARE centers the client post-attach;
                    use `--cmd '<string>'` for commands with
                    dash-flags — bunli's arg parser cannot be
                    fully shielded with `--`)

tests/
├── render.test.ts       pure renderer/grouping spec (bun test)
└── integration.test.ts  live-WM suite — spawns real windows on
                          a scratch tag and switches the focused
                          tag during the run; via test:live
```

## What changed vs the JS original

- Full TypeScript/ESM port; bunli command tree with typed zod-
  validated flags instead of raw positional dispatch. Action names
  were cleaned up in the embedded click strings (`toggle_focus` ->
  `toggle-focus`, `scroll_focus` -> `scroll`); the empty-desktop
  scroll actions follow the pinned test contract (they disagreed
  in the JS original).
- `scrollFocus` minimized branch: the original called
  `hc.attr(path, false)`, which READS instead of writes (Node
  ignores the extra argument) — now a real `setAttr` before the
  jump.
- Behavior, grouping semantics, colors, truncation, overflow
  marker and all WM interactions are otherwise 1:1 ports.

## Test

```sh
bun install
bun run test       # pure renderer/grouping spec
bun run test:live  # live-WM integration (spawns windows,
                   # switches tag)
```
