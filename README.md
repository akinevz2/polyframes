# polyframes

kine's polybar window frames for herbstluftwm — a native binary via
bunx. It renders the window/frame-group label line for
`[module/polyframes]`, handles the bar's click and scroll actions,
and hosts the rofi switcher menus.

Project page: [akinevz.com/polyframes](https://akinevz.com/polyframes)

## Install

The package's `bin` entry is a TypeScript source (`src/index.ts`).
Install and run it with bun:

```sh
bun install          # or: bun add polyframes
bunx polyframes      # runs src/index.ts through bun's runtime
```

> **Note:** use bun or bunx, not npx — npx does not handle the
> TypeScript `bin` sources correctly.

For a standalone binary (the form the dots deployment uses), build it
with bunli:

```sh
git clone https://github.com/akinevz2/polyframes ./polyframes
cd ./polyframes
bun install
make install         # build + install to ~/.local/bin/polyframes
```

`make install PREFIX=/opt` relocates the binary; the dots config
references `~/.local/bin/polyframes`, so keep the default prefix
unless you also update `[module/polyframes]`.

## What it does

- **Bar daemon** — bare invocation renders the label line in a loop
  for polybar's `[module/polyframes]`; re-renders on hlwm hooks
  (tag changes, focus, layout).
- **Click / scroll** — the label's `%{A}` action strings re-exec the
  binary itself (click-to-cycle, scroll-to-cycle focus, float
  state machines via `herbctl`).
- **Rofi menus** — the tag switcher, window switcher, launcher and
  window-operations menu are subcommands of the same binary.

See `polyframes --help` for the full subcommand list.

## Build

The compiled artifact is a `bun build --compile` product (~120 MB —
it embeds the Bun runtime and needs nothing else at runtime). Click
actions re-exec the binary itself; the path it uses is overridable
with `POLYFRAMES_SELF`.

```sh
bun install
make build           # bunli build -> dist/polyframes
```

## Dependencies

- [herbstutil](https://github.com/akinevz2/herbstutil) — the
  herbstclient attr compatibility layer (npm).
- [herbctl](https://github.com/akinevz2/herbctl) — the imperative
  state machines behind the click/scroll actions.

## Runtime paths

All runtime paths are `$HOME`-relative, none repo-relative:
`$HOME/.config/rofi` (menu themes), `$HOME/.local/bin` (dots helper
shims), `/tmp/polyframes.log` (debug log).

## Test

`bun test` covers the parser and menu plumbing against recorded hlwm
state — nothing needs a live WM to test.
