# polyframes — build the bunli CLI and install the standalone binary.

# Where the standalone binary goes on `make install`.
# the 2026-11 doctrine: NOTHING here installs outside the stow package —
# placement belongs to the dots stow adapter
# (dots/polyframes/.local/state/depends/polyframes.Makefile: build ->
# dots/polyframes/.local/bin/polyframes -> stow). A manual copy to
# $PREFIX/bin double-claims the link the package owns.

#BIN    ?= $(PREFIX)/bin/polyframes

DIST := dist/index

# The theme applied by `make theme` / `make reload` — herbst_theme's
# file (deployed by the doftiles shell/agents stow), force-applied so
# the fresh-start guard doesn't skip it. OUT OF THE PATH problem: the
# file lives at dots/herbst (the stow package), not in $HOME before stow.
#THEME_CMD ?= $(HOME)/.local/bin/reload_theme -f

# Build targets:
#   make build        -> glibc standalone (runs on THIS host + typical Linux)
#   make build-static -> musl artifact (portable to musl distros; NOT runnable
#                        on glibc-only systems like this WSL Ubuntu host —
#                        bun's musl compile still links libc.musl + libstdc++)
build:
	bun x bunli build --targets linux-x64 --minify
	mv -f $(DIST) dist/polyframes
	rm -f dist/index.map

build-static:
	bun x bunli build --targets linux-x64-musl --minify
	mv -f $(DIST) dist/polyframes-musl
	rm -f dist/index.map

# Apply the theme (herbst_theme's file): hlwm decorations, borders,
# title strips — force-applied past the fresh-start guard.
# NOTE: the deploy flow applies the theme POST-STOW (the artifact must
# not touch $HOME before the stow package owns the path); run only from
# a deployed session.
theme:
	@echo "polyframes: theme deferred — applied post-stow by the deploy flow (reload_theme -f through herbst_theme); call it manually from a deployed session"

install: theme-binary
theme-binary:
	@echo "polyframes: placement belongs to the stow package adapter (dots/polyframes/.local/state/depends/polyframes.Makefile — the link rule into dots/polyframes/.local/bin); this upstream Makefile installs NOTHING to the home"

# "make reload" re-applies the theme — the hlwm decorations/borders/
# titles — without touching the running WM.
reload: theme

# Pure renderer/grouping spec — always safe to run.
test:
	bun test tests/render.test.ts

# Live-WM integration tests: spawn real alacritty/byobu windows on a
# scratch hlwm tag (`pf_integration_test`) and switch the focused tag
# during the run. Asks for confirmation FIRST (xmessage dialog, or a
# transient terminal with a press-any-key prompt when xmessage is
# unavailable) — be at the session that will be taken over.
testlive:
	bun run test:live

clean:
	rm -rf dist .bunli

.PHONY: build build-static theme install reload test testlive clean
