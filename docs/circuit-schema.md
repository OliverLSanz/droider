# YAML schema for DROID circuits

> Contract for the format that describes **each circuit** from chapter 16 of the
> manual. These files live in `circuits/<name>.yaml` (one per circuit) and are
> meant to be loaded directly by the linter / VSCode extension code.
>
> Goal: with this data the extension can offer autocompletion of circuits and
> their inputs/outputs (long and abbreviated form), documentation on *hover* and
> validation (non-existent parameter, value out of range, register direction,
> etc.).
>
> See `docs/reference.md` for the language specification itself.

---

## 1. Conventions

- **One file per circuit.** The file name is `<name>.yaml`, where `<name>`
  matches exactly the `name` field and the circuit name as written in the
  patch's `[name]` header.
- **Encoding:** UTF-8.
- **Markdown:** the `description` fields accept Markdown (rendered in the hover).
  Use `|` blocks for multi-line text.
- **Absent values:** a missing optional field is equivalent to `null`. Do not
  write `default: null` unless you want to explicitly mark "no default value /
  feature disabled if not patched".

---

## 2. Top-level structure

```yaml
name:        # string  (required) circuit id = [name] header = file name
title:       # string  (required) short title from the manual
manual_page: # int     (optional) page of the blue-7 PDF where the circuit starts
obsolete:    # bool    (optional, def. false) true if the manual marks it (OBSOLETE)
category:    # string  (optional) free grouping for the UI (e.g. "modulation")
memory_bytes:# int     (optional) approximate RAM usage, if the manual states it
description: # markdown (required) long description for the circuit hover
inputs:      # list of Input  (may be empty)
outputs:     # list of Output (may be empty)
examples:    # list of Example (optional)
```

---

## 3. `Input`

Each element of `inputs`:

```yaml
- name:        # string  (required) long parameter name
  abbr:        # string  (optional) official abbreviation; null if the manual gives none
  valuetype:   # enum    (required) see §5
  default:     # scalar  (optional) default value if not patched; null = feature off
  min:         # number  (optional) valid minimum for fixed-number validation
  max:         # number  (optional) valid maximum for fixed-number validation
  unit:        # enum    (optional) see §6
  array:       # int     (optional) if it is an array of jacks: maximum index (name1..nameN)
  description: # markdown (required) description for the input hover
```

Notes:

- **`abbr`**: the extension must accept both `name` and `abbr` in the patch and
  treat them as equivalent (see §10 of `reference.md`). If the manual states
  there is no abbreviation, use `abbr: null`.
- **`array`**: if present, `name1`…`name{array}` are valid and also `name` ≡
  `name1` (see §8 of `reference.md`). Hover/autocompletion must expand the array.
- **`min`/`max`**: limits for validation. They are **optional**; many inputs
  accept any number. Remember that `on`≡`1.0` and `off`≡`0.0` are always
  syntactically acceptable even if the range is wider.
- **`default`**: use it exactly as it appears in the manual's *Default* column.

---

## 4. `Output`

Each element of `outputs`:

```yaml
- name:        # string  (required) long output name
  abbr:        # string  (optional) official abbreviation; null if none
  valuetype:   # enum    (optional) see §5 (informs the hover; outputs are not range-validated)
  array:       # int     (optional) if it is an array: maximum index (name1..nameN)
  description: # markdown (required) description for the output hover
```

> Outputs carry no `default`, `min`, `max` or `unit`: they only produce values.

---

## 5. `valuetype` enum

Describes the value's semantics. Mainly used for the hover and to decide which
validations to apply. Allowed values:

| valuetype  | Meaning | Notes for the linter |
|------------|---------|----------------------|
| `cv`       | Generic continuous control value (number). | No range restriction except `min`/`max`. |
| `gate`     | Boolean on/off (0 or 1). | Accepts `on`/`off`. Implies `min: 0`, `max: 1` unless overridden. |
| `trigger`  | Rising-edge sensitive (one-shot trigger). | Like gate for range purposes. |
| `clock`    | Clock signal (regular pulses). | — |
| `pitch`    | Pitch CV at 1 V/octave. | No fixed range (can be negative). |
| `integer`  | Integer selector/counter. | Warn if the fixed number is not an integer (where applicable). |
| `fraction` | Unipolar normalized value 0…1. | Implies `min: 0`, `max: 1` unless overridden. |
| `bipolar`  | Bipolar normalized value -1…1. | Implies `min: -1`, `max: 1` unless overridden. |
| `text`     | Literal text string between quotes. | See §4.4 of `reference.md`. |

> When an input accepts mixed semantics (e.g. `waveform`, which takes integers
> 0–6 but also fractions for *morphing*), use the most general `valuetype`
> (`cv`) and bound it with `min`/`max`, explaining the nuance in `description`.

---

## 6. `unit` enum (optional)

Unit hint for the hover; not strict for the linter:

| unit       | Meaning |
|------------|---------|
| `hz`       | Frequency in hertz. |
| `volt`     | Voltage (remember the `V` suffix = ÷10). |
| `octave`   | Octaves (1 V/oct). |
| `semitone` | Semitones. |
| `second`   | Time in seconds. |
| `percent`  | Percentage (`%` suffix = ÷100). |
| `beat`     | Clock pulses/beats. |

---

## 7. `Example` (optional)

Usage examples taken from the manual; useful for the circuit hover and for
documentation.

```yaml
- title: # string   (required) short description of the example
  code:  # markdown (required) patch snippet, usually an ```ini block
```

---

## 8. Full example

See `circuits/lfo.yaml` as the canonical reference for the format.
