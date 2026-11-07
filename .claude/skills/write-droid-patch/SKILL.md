---
name: write-droid-patch
description: Use when writing, editing or reviewing a DROID patch (a .ini patch file for the DROID Eurorack module family). Covers where the language/circuit documentation lives, the authoring conventions to follow, and the mandatory linter CLI that must validate every patch.
---

# Writing DROID patches

A DROID patch is a text file (usually `droid.ini`, here often `*.ini`) that
programs the DROID Eurorack module family. It is made of **circuits** (`[name]`
headers with `parameter = value` lines), **registers** (physical and controller
I/O like `I1`, `O3`, `P1.2`, `B2.4`) and **internal cables** (`_NAME`) that wire
outputs to inputs.

Follow this skill whenever you create or modify a patch in this repo.

## 1. Read the documentation first

The full language and data model is specified in the repo. Consult these before
writing anything non-trivial:

- **`docs/reference.md`** — the complete language specification: file structure,
  controller declaration, registers, value types (numbers, voltages, gates,
  texts), internal cables, attenuation/offset (`A * B + C`), parameter arrays,
  comments, abbreviated parameter names, multiple patches, and the validation
  rules. **This is the canonical reference; start here.**
- **`docs/circuit-schema.md`** — how each circuit is described in YAML.
- **`docs/hardware-schema.md`** — how registers and controllers are described.

The machine-readable data the linter and editor use (and your best source for
exact parameter names, abbreviations, defaults and ranges):

- **`circuits/<name>.yaml`** — one file per circuit (e.g. `circuits/lfo.yaml`).
  Each lists the circuit's `inputs` and `outputs` with their `valuetype`,
  `default`, `min`/`max`, `unit`, `array` and `abbr`.
- **`registers.yaml`** — fixed registers of the master / expanders.
- **`controllers.yaml`** — controller types and their pots/buttons/LEDs/etc.

> Not every circuit has been extracted to YAML yet. If a circuit you need is not
> in `circuits/`, the linter cannot fully validate it (its body is treated as
> unknown). Verify those circuits manually against the official DROID manual.

## 2. Authoring conventions (required)

Every patch must follow these rules so it stays readable and reviewable:

1. **Divide circuits into functional sections.** Group the circuits that
   together implement one feature (e.g. "Clock", "Envelope 1", "Voice mixer")
   into a clearly delimited section.
2. **Order circuits so the patch is easy to understand.** Lay sections out in a
   logical reading order (e.g. signal flow from source to output, or controllers
   first, then processing). The file should read top-to-bottom like an
   explanation of the patch, not a random pile of circuits.
3. **Accompany circuits with comments.** Use `#` comments to head each section
   and to explain what each circuit does and why. A reader should understand the
   intent without reverse-engineering the wiring.
4. **Use descriptive cable names.** Internal cables (`_NAME`) must have names
   that describe the signal they carry (e.g. `_CLOCK`, `_ENV1_GATE`,
   `_VOICE_PITCH`), never opaque names like `_X` or `_A1`. The same signal keeps
   the same name everywhere it appears.

## 3. Validate with the linter — mandatory

The repo ships a linter that uses **exactly the same logic** as the VSCode
extension. **Every patch must be validated with it before it is considered
done.** Do not hand off or commit a patch you have not linted.

Compile once (or use `npm run watch` while iterating), then run the CLI:

```sh
npm run compile                       # build out/ from src/ (tsc)
node out/cli.js path/to/patch.ini     # human-readable report
node out/cli.js --json path/to/patch.ini   # JSON output (for agents/tools)
```

`npm run lint -- path/to/patch.ini` compiles and lints in one step.

Exit codes: **0** = no errors, **1** = at least one error, **2** = misuse
(bad arguments or unreadable file). Warnings alone do not fail the run.

The linter reports problems as `line:column [severity] message`. Treat **all
errors as blocking** — in particular, internal-cable errors (a cable with no
input, no output, or more than one output) are real wiring faults and must be
fixed, not ignored. Resolve every error and review every warning before
finishing.
