# Development

How to build Droider from source, how it is organised, and how to release it.

## Build and run

Requires Node.js 18+ (22 recommended).

```sh
npm install
npm run compile        # tsc -p ./  -> builds out/ from src/
npm run watch          # recompile on change
npm test               # unit and integration tests (node --test)
```

Run the extension from VS Code with the **Run Extension** launch configuration (<kbd>F5</kbd>). It opens a second
window with your working copy loaded.

## Command-line linter

The same checks as the editor, for scripts, CI and AI assistants:

```sh
node out/cli.js path/to/patch.ini            # human-readable
node out/cli.js --json path/to/patch.ini     # JSON
npm run lint -- path/to/patch.ini            # compile + lint
```

Exit codes: `0` no errors, `1` at least one error, `2` misuse or unreadable file. Warnings alone do not fail. The mode
(`.ini`, `.droider`, `.blueprint`) comes from the file extension, and megacircuits are loaded from every `*.blueprint`
under the current directory.

## Architecture

The logic is a **pure, VS Code-free core** with a thin VS Code layer on top, so the editor, the CLI and the tests run
exactly the same code.

- `src/data.ts`: `DroidData` loads the data model (`circuits/*.yaml`, `controllers.yaml`, `registers.yaml`) and
  resolves parameters, abbreviations, arrays and the registers valid for the declared controllers.
- `src/linter.ts`: `lint(text, data, { mode, blueprints })` returns problems with line, column and severity.
- `src/blueprints.ts`: megacircuit parsing and `expandToIni()`, which rewrites a `.droider` patch into plain `.ini`
  and renames private cables to `__<name>_<n>_<CABLE>`. Recursive.
- `src/maths.ts`: free arithmetic in `.droider` files, split into the fewest `copy` circuits.
- `src/build.ts`, `src/cardFormat.ts`: build a patch for the card and keep lines within the DROID's limits.
- `src/extension.ts`: the only module that wires everything into VS Code (diagnostics, providers, commands).
- Providers: `completion.ts`, `hover.ts`, `semantic.ts`, `cables.ts` (rainbow cables), `hardwareView.ts`,
  `circuitGraph.ts`, `droidCard.ts` (SD-card detection, write, verify, eject), `blueprintRegistry.ts`, `labels.ts`.

Keep checking and expansion logic in the pure modules: the CLI and the editor must behave identically.

### The data model

`circuits/<name>.yaml` holds one circuit each: its inputs and outputs with type, default, range, unit, array size and
abbreviation (schema in [`circuit-schema.md`](circuit-schema.md)). `registers.yaml` and `controllers.yaml` describe
the master, expanders and controllers ([`hardware-schema.md`](hardware-schema.md)). The YAML was written from the
official DROID manual (blue-7); `extracted_text/` holds the per-circuit source text and
[`CIRCUIT_EXTRACTION.md`](../CIRCUIT_EXTRACTION.md) the process. Validate YAML changes with
`python3 scripts/validate_circuits.py`.

## Releasing

1. Update `version` in `package.json` and add the changes to `CHANGELOG.md`.
2. `npm test`, then `npm run package` to build `droider-<version>.vsix` (contents controlled by `.vscodeignore`).
   Inspect it with `npx @vscode/vsce ls`.
3. Publish: `npx @vscode/vsce publish` (needs the `oliverlsanz` publisher's Azure DevOps token with the
   *Marketplace › Manage* scope, given with `-p` or `VSCE_PAT`).
4. Tag and create a GitHub release with the `.vsix` attached:
   `gh release create v<version> droider-<version>.vsix --notes-file <notes>`.

## Website

`site/` is the static website and guide served at https://oliverlsanz.com/droider/. Preview it with
`python3 -m http.server 8765 --directory site` and publish it with `./scripts/deploy-site.sh`. Code samples are
highlighted in the browser by `site/assets/site.js` using the circuit outputs in `site/assets/droid-data.js`;
regenerate that file with `node scripts/site-data.js` after changing `circuits/`. Screenshots in
`site/assets/screens/` are real captures of the extension running the patches in `examples/`.

## Video

`video/` is the promo video, made in code with [Remotion](https://www.remotion.dev). See
[`video/README.md`](../video/README.md).
