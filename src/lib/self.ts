// src/lib/self.ts — how the binary refers to ITSELF in polybar click
// action strings.
//
// The shell-era implementation had to bounce through a bash shim
// (`~/.local/bin/polyframes.sh`) because polybar's environment does not
// include the nvm node bin dir. The compiled binary needs none of that:
// it IS its own interpreter. The action string is therefore just the
// absolute path of the executable, so `%{A1:...}` handlers keep working
// regardless of polybar's PATH.
//
// Resolution order:
//   1. $POLYFRAMES_SELF (explicit override, testing)
//   2. Compiled binary: realpath(process.execPath) — Bun fakes argv[0]
//      to the virtual `/$bunfs/root/...` bundle path, but execPath is
//      the real standalone executable.
//   3. Dev mode (`bun run src/index.ts`): a bun invocation; self is the
//      TS entry file.

import { realpathSync } from "node:fs";

let cached: string | null = null;

export function selfCommand(): string {
    if (process.env.POLYFRAMES_SELF) return process.env.POLYFRAMES_SELF;
    if (cached) return cached;

    const execPath = process.execPath ?? "";
    const argv0 = process.argv[0] ?? "";
    // Known Bun self-signatures: the bun runtime itself, or the virtual
    // fs mount Bun's compiled executables use for argv[0].
    const isBunRuntime = /(^|\/)bun(\.[a-z0-9]+)?$/.test(execPath)
        || argv0.startsWith("/$bunfs");

    if (isBunRuntime && !argv0.startsWith("/$bunfs")) {
        // Dev mode: run the TS entry through bun.
        cached = `bun run ${import.meta.path}`;
    } else {
        // Compiled binary: argv[0]/execPath is the executable (possibly
        // relative — resolve it so polybar can exec it from any cwd).
        try {
            cached = realpathSync(execPath || argv0);
        } catch {
            cached = execPath || argv0;
        }
    }
    return cached;
}
