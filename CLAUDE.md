# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## What this is

A VSCode extension (**Droider**, Marketplace ID `oliverlsanz.droider`) that provides editing support — error
detection, autocompletion, hover docs, semantic highlighting, cable decoration,
hardware/graph views, and SD-card writing — for **DROID** Eurorack patch files.
A patch is a list of **circuits** (`[name]` headers with `parameter = value`
lines) wired together with **registers** (physical/controller I/O like `I1`,
`O3`, `P1.2`) and **internal cables** (names starting with `_`).

Three languages/file types are served:
- `.ini` (`droid`) — plain patch, ready for the card. No syntactic sugar.
- `.droider` (`droider`) — sugar allowed; megacircuits used like normal circuits.
- `.blueprint` (`droid-blueprint`) — a *megacircuit* definition (reusable sub-patch).

## Commands

```sh
npm run compile        # tsc -p ./  -> builds out/ from src/
npm run watch          # tsc -watch, use while iterating
node out/cli.js <patch.ini> [...]          # lint a patch (human-readable)
node out/cli.js --json <patch.ini>         # lint, JSON output (for tools/agents)
npm run lint -- <patch.ini>                # compile + lint in one step
```

CLI exit codes: **0** = no errors, **1** = ≥1 error, **2** = misuse/unreadable.
Warnings alone do not fail. Mode is inferred from the file extension.

Run the extension itself with VSCode's **Run Extension** launch config (F5);
build task is `npm: compile`.

Circuit YAML validation (separate Python gate, not part of the TS build):
```sh
python3 scripts/validate_circuits.py [circuits/<name>.yaml]   # all files if no arg
```

## Architecture

The code is split into a **pure, VSCode-free core** and a thin VSCode layer, so
the exact same logic powers the editor, the CLI, and any tests.

- `src/data.ts` — `DroidData` loads the YAML data model (`circuits/*.yaml`,
  `controllers.yaml`, `registers.yaml`) and resolves parameters/abbreviations/
  arrays and valid registers given the declared controller chain. **No VSCode.**
- `src/linter.ts` — `lint(text, data, {mode, blueprints})` returns `Problem[]`
  (line/col/severity). Mode-aware (`ini` / `droider` / `blueprint`). **No VSCode.**
- `src/blueprints.ts` — megacircuit parsing and `expandToIni()`: rewrites a
  `.droider` patch into plain `.ini`, inlining each blueprint body and renaming
  private cables to unique `__<name>_<n>_<CABLE>` so instances never collide.
  Recursive (a blueprint may use other blueprints). **No VSCode.**
- `src/extension.ts` — the **only** entry point that touches VSCode. Loads data,
  wires up providers, turns `Problem`s into `vscode.Diagnostic`s, and implements
  the commands (write/eject to card, build `.droider`→`dist/*.ini`, hardware view,
  circuit graph).
- `src/cli.ts` — terminal linter; imports the same `lint`/`DroidData`. No
  duplicated logic.

VSCode-facing providers (each consumes the pure core): `completion.ts`,
`hover.ts`, `semantic.ts`, `cables.ts` (rainbow cable decoration),
`hardwareView.ts`, `circuitGraph.ts`, `droidCard.ts` (SD-card detection/write),
`blueprintRegistry.ts` (scans/watches `**/*.blueprint`), `labels.ts`, `context.ts`.

**Invariant:** keep linting/expansion logic in the pure modules. The CLI and the
editor must stay behaviorally identical — never fork validation logic into the
VSCode layer.

### Data model (the YAML)

- `circuits/<name>.yaml` — one per circuit; lists `inputs`/`outputs` with
  `valuetype`, `default`, `min`/`max`, `unit`, `array`, `abbr`. Schema in
  `docs/circuit-schema.md`. This is the source of truth for autocompletion/hover/
  validation. **Not every circuit is extracted yet** (see `CIRCUIT_EXTRACTION.md`);
  unknown circuits are treated as unverified and only partially validated.
- `registers.yaml` / `controllers.yaml` — fixed master registers and controller
  types (pots/buttons/LEDs/etc.). Schema in `docs/hardware-schema.md`.
- Circuit YAML is generated from `extracted_text/<name>.txt` (clean per-circuit
  text split from the official DROID manual, blue-7; the PDF itself is not in the
  repository). **Work from the extracted text.** See `CIRCUIT_EXTRACTION.md` for the extraction playbook and remaining
  TODO, and `extracted_text/AGENT_INSTRUCTIONS.md` for the authoring rules.

## Website, video and releases

The repository is public. `README.md` is its front page for users (website link,
features, install); put developer detail in `docs/development.md`, not the README.

- `site/` is the static website and guide, deployed with `./scripts/deploy-site.sh`
  to https://oliverlsanz.com/droider/. Keep the guide (`site/docs/index.html`) in
  step with user-facing changes. Screenshots are real captures of `examples/`.
  Regenerate `site/assets/droid-data.js` with `node scripts/site-data.js` after
  changing `circuits/`.
- `video/` is the Remotion promo video (see `video/README.md`).
- Releases: bump `version` and `CHANGELOG.md`, `npm run package`, then
  `npx @vscode/vsce publish` and a GitHub release with the `.vsix`
  (`docs/development.md`, Releasing). Only publish when Óliver asks.
- `.vscodeignore` decides what ships in the `.vsix`; never ship the manual PDF,
  `extracted_text/`, tests or agent files.

## Authoring patches

When writing/editing/reviewing an actual `.ini`/`.droider`/`.blueprint` patch (as
opposed to extension code), follow the **`write-droid-patch`** skill. Key rules:
read `docs/reference.md` first (the canonical language spec), group circuits into
commented functional sections in signal-flow order, give cables descriptive names
(`_CLOCK`, not `_X`), and **lint every patch before considering it done** — treat
all errors as blocking, including internal-cable wiring faults (a cable with no
input, no output, or more than one output).
