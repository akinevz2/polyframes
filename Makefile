# polyframes — build the bunli CLI and install the standalone binary.

# Where the standalone binary goes on `make install`.
PREFIX ?= $(HOME)/.local
BIN    ?= $(PREFIX)/bin/polyframes

DIST := dist/index

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

install: build
	install -m 755 dist/polyframes $(BIN)

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

.PHONY: build build-static install test testlive clean
