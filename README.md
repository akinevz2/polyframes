# polyframes

Polybar window-list renderer for herbstluftwm — a bunli CLI written
    in
TypeScript for Bun, compiled to a standalone native executable with
`bun build --compile` (bunli's build toolchain). Port of the
dotfiles-era JS implementation
    (`dots/polybar/.config/polybar/polyframes`)
which itself ported `polywins.sh` + the `hc_get-*` / `polyframes-*`
shell helpers.

## Why compiled

The JS original required Node via nvm plus a bash shim, because
polybar's module environment does not include the nvm node bin dir
    on
its PATH. The standalone binary keeps the Bun runtime inside itself
    and
can therefore execute ITSELF in polybar `%{A1}` click action strings
    — no
shim, no PATH juggling, no Node.

The binary is a `bun build --compile` artifact (~120 MB, embeds
the Bun runtime + all code; zero runtime dependencies). `make
build-static` produces a musl artifact for portable/musl distros —
note that on this WSL2 Ubuntu host only the glibc build runs.

## Install

```sh
git clone <repo> ~/development/personal/polyframes
cd ~/development/personal/polyframes
bun install
make install      # build (glibc target) + install
                  # to ~/.local/bin/polyframes
```

## CLI

Bare invocation is polybar's contract — `exec =
    ~/.local/bin/polyframes`
starts the bar daemon: print the bar line, then re-render on hlwm
    hooks
(`herbstclient --idle`) plus a 1 s frame-layout poll (hashed `dump`,
covers split/remove/resize which emit no hook in hlwm 0.9.5).

```
polyframes              # bar daemon (polybar module entrypoint)
polyframes bar          # one-shot bar line, exit
polyframes switcher <frame> <class>
# rofi dmenu of one (frame, class) group; re-clicking an
# open menu dismisses it and focuses (or minimizes) the
# group's visible window
polyframes scroll --wid <wid> --dir <up|down>
# scroll cycling within the window's group
polyframes toggle-focus --wid <wid>
# left-click state machine: unminimize / focus /
# float / re-tile, one step at a time
polyframes toggle --wid <wid>
# alt state machine: float / minimize /
# unminimize-into-frame (with re-centering)
polyframes dismiss --wid <wid>
# minimize without floating; prunes the frame
# when it empties; restores + re-centers
polyframes close --wid <wid>
polyframes menu --wid <wid>
                        # hc_menu rofi window-operations menu
```

Debug logging (never touches stdout — polybar owns that; goes to
`/tmp/polyframes.log`, `tail -f` it): layers `ui`, `clients`,
    `frames`,
`format`. Enable with `-v` (all layers) or
`POLYFRAMES_VERBOSE=ui,format` (any combination).

Self-reference: click-action strings embed the binary's absolute
    path
(`realpath(process.execPath)`), overridable with `POLYFRAMES_SELF`.

## Dependencies

- **herbstutil** (npm, `github.com/akinevz2/herbstutil`, installed
    from
  the registry) — NOT the CLI: its `parseAttr()` is imported
        directly
  from `src/commands/parse.js` and bundled into the binary. One
  `herbstclient attr clients.<wid>.` call returns the whole object
        tree,
  with herbstutil doing the typed coercion (booleans as booleans,
  geometries as `{x,y,width,height}`) — the per-client
  `class/minimized/title/tag/…` attribute walk (4–6 spawns per
        window
  in the shell era) collapses into a single round trip. Any
  parse failure degrades to plain per-attribute `herbstclient attr`
  reads.
- External commands used at runtime: `rofi`, `herbstclient`,
    `pgrep`,
  plus the dots helpers `hc_maximize`/`hc_unmaximize` (the window-
        menu
  delegates Maximize/Tile flows to them; everything else moved OUT
        of
  dots and is managed in this repo: tags/hidden/windows/launch
        menus,
  switcher menu, window menu, tile, center — hc's decoration-
        geometry
  measurement (`hc_deco_margins`) was ported into `center.ts`).
- The old X-side dependency `xprop` is GONE — window enumeration is
  pure hlwm (`attr clients` children).

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
                    (`--class/--instance/--title` match criteria +
                    `--float/--switchtag/--tag/--focus/--center`);
                    `--center` floats+focuses and then decor-AWARE
                    centers the client post-attach
                    (hlwm 0.9.5 has no floating=center
                    consequence). Use `--cmd '<string>'`
                    for commands with dash-flags (bunli's arg parser
                    cannot be fully shielded with `--`).

tests/
├── render.test.ts       pure renderer/grouping spec (bun test)
└── integration.test.ts  live-WM suite — spawns real
    windows on a scratch tag and switches the
    focused tag during the run; via test:live
```

## What changed vs the JS original

- Full TypeScript/ESM port; bunli command tree with typed zod-
    validated
  flags instead of raw positional dispatch. Action names were
        cleaned
  up in the embedded click strings (`toggle_focus` → `toggle-focus`,
  `scroll_focus` → `scroll`); the empty-desktop scroll actions
        follow
  the pinned test contract (they disagreed in the JS original).
- `scrollFocus` minimized branch: the original called
  `hc.attr(path, false)`, which READS instead of writes (Node
        ignores
  the extra argument) — now a real `setAttr` before the jump.
- Behavior, grouping semantics, colors, truncation, overflow marker
    and
  all WM interactions are otherwise 1:1 ports.

## Test

```sh
bun install
bun run test          # pure renderer/grouping spec
bun run test:live     # live-WM integration (spawns
                      windows, switches tag)
```
