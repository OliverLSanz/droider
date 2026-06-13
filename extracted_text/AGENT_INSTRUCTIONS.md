# Task: convert extracted circuit text into `circuits/<name>.yaml`

You are converting DROID manual circuit descriptions into structured YAML for a
linter/autocompletion extension. Work ONLY from the plain-text files you are
assigned (`extracted_text/<name>.txt`). **Do NOT open the PDF.**

## Before you start (read once)
1. `docs/circuit-schema.md` — the authoritative schema contract.
2. `circuits/lfo.yaml` — canonical example for a complex circuit (inputs,
   outputs, arrays, examples, valuetypes).
3. `circuits/copy.yaml` — canonical example for a trivial circuit.

## Output
For each assigned circuit, write `circuits/<name>.yaml`. `name` MUST equal the
file name and the `[name]` header used in the manual.

## How the source text is laid out
- Header comment lines at top give: `# CIRCUIT:`, `# MANUAL PAGES`, `# TITLE`.
  Use the first page number as `manual_page`. Use the start page (the smaller).
- The manual lists parameters in two tables:
  - `Input  Type  Default  Description` — rows like `rate (ra)` then a default
    and a description. The text in **parentheses** is the official `abbr`.
  - `Output  Type  Description` — rows like `output (o)`.
- A row like `input1, input2 (i)` means an **array**: `name: input`, `abbr: i`,
  `array: 2`. Likewise `led1 … led8 (l)` → `name: led`, `abbr: l`, `array: 8`.
  Per schema, `name` ≡ `name1`.
- Ignore page-footer noise: `DROID manual for blue-7`, page numbers,
  `Table of contents at page 2`. Fix ligatures from extraction (ﬂ→fl, ﬁ→fi,
  ﬀ→ff) and stray line breaks inside words/sentences.

## Field rules (see schema for the full enums)
- `valuetype` (required for inputs): one of
  `cv gate trigger clock pitch integer fraction bipolar text`. Pick the closest;
  when an input is mixed (e.g. integer selector that also morphs), use `cv` and
  bound it with `min`/`max`, explaining in the description.
- `unit` (optional): one of `hz volt octave semitone second percent beat`.
- `default`: copy exactly from the manual's *Default* column. `on`≡1, `off`≡0.
  Omit if the manual gives none.
- `min`/`max`: only when the manual states a range. Many inputs accept any
  number — then omit. `gate`/`trigger` imply 0..1; `fraction` 0..1; `bipolar`
  -1..1 (no need to write those unless overriding).
- `abbr`: from the parentheses. If the manual gives none, `abbr: null`.
- Outputs need only `name`, `abbr`, `valuetype` (optional), `description`,
  and `array` if applicable. No default/min/max/unit on outputs.
- `obsolete: true` if the title contains `(OBSOLETE)`.
- `description` (required, top-level and per-param): faithful Markdown summary in
  **English**. Use `|` block scalars for multi-line. Keep useful detail but be
  concise; backtick parameter names and code (`rate`, `1V`, `O1`).
- `category`: a short free-form grouping (e.g. modulation, sequencer, utility,
  logic, midi, controller, quantizer, clock, random, envelope). Use judgement.
- `examples` (optional): include 1–3 short patch snippets if the manual shows
  them, each as `{title, code}` with a fenced ```ini block (see lfo.yaml).

## Self-check (MANDATORY)
After writing each file, run:
```
python3 scripts/validate_circuits.py circuits/<name>.yaml
```
Fix every error until it prints `OK`. Then validate ALL your files together
before finishing. Do not report done until the validator passes for all your
assigned circuits.

## Important
- Do not edit any file other than your assigned `circuits/<name>.yaml` files.
- Do not touch the 3 reference circuits (`contour`, `copy`, `lfo`).
- Keep YAML valid (watch indentation, quote strings containing `:` when needed).
