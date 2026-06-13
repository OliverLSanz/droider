# Hardware YAML schema: registers and controllers

> Contract for the `registers.yaml` and `controllers.yaml` files, which describe
> the **registers** (jacks, LEDs, pots, buttons, switches…) available depending
> on the hardware. The linter / extension loads them to:
>
> - autocomplete physical register names (`I1`, `O3`, `G2.4`…) and controller
>   element names (`P1.2`, `B3.8`, `S1.1`…),
> - validate that a register exists and respect its **direction** (do not write
>   to an input-only register; see §3.4 of `reference.md`),
> - know which registers each controller declared in the patch contributes.
>
> See `docs/reference.md` §3 for the narrative description and
> `docs/circuit-schema.md` for the `valuetype` enum, which is reused here.

---

## 1. `registers.yaml` — fixed registers of the master and expanders

These are the registers that do **not** depend on controllers: the master's
inputs/outputs, the matrix LEDs and the G8 / X7 expander jacks.

### 1.1 Structure

```yaml
masters:           # registers that depend on the master type
  master:          # MASTER
    title: MASTER
    registers: [ RegisterFamily, ... ]
  master18:        # MASTER18
    title: MASTER18
    registers: [ RegisterFamily, ... ]
```

### 1.2 `RegisterFamily`

```yaml
- prefix:      # string  (required) register letter(s): I, O, N, G, R, X
  shape:       # enum    (required) "indexed" | "dotted" | "single"
  direction:   # enum    (required) "input" | "output" | "inout"
  valuetype:   # enum    (optional) value semantics (see circuit-schema §5)
  requires:    # enum    (optional) extra hardware required: null | "g8" | "x7"
  default:     # scalar  (optional) default value (e.g. normalization N = 0.0)
  description: # markdown (required)
  # Depending on shape:
  index:       # {min,max}  for shape "indexed" or "single": number range (I1..I8)
  group:       # {min,max}  for shape "dotted": range of the first number (G2..G4)
  element:     # {min,max}  for shape "dotted": range of the second number (.1..8)
```

**Shapes:**

| shape     | Name form               | Fields            | Example            |
|-----------|-------------------------|-------------------|--------------------|
| `indexed` | `<prefix><n>`           | `index`           | `I1`…`I8`          |
| `single`  | `<prefix><n>` (range 1) | `index`           | `X1`               |
| `dotted`  | `<prefix><a>.<b>`       | `group`,`element` | `G2.1`…`G4.8`      |

> The same `prefix` can appear in **several** families with different ranges and
> `requires` (e.g. `R1`…`R16` on the master, `R17`…`R48` on the G8s). The linter
> must merge all families of a prefix when validating.
>
> **About `requires`:** the G8/X7 expanders are not declared in the patch text,
> so `requires` is mostly informational. The linter can accept those registers
> by default and, optionally, warn if it is configured that there is no expander.

---

## 2. `controllers.yaml` — controller types

Controllers are declared at the top of the patch with `[type]` (see §2.1 of
`reference.md`) and occupy a position in the chain: the **controller number** `N`
is its declaration order, starting at 1. Its elements are addressed as
`<prefix><N>.<element>` (e.g. `P3.2` = 2nd pot of the 3rd controller).

### 2.1 Structure

```yaml
controllers:
  - Controller
  - ...
```

### 2.2 `Controller`

```yaml
- type:        # string  (required) id = [type] header
  title:       # string  (required)
  manual_page: # int     (optional)
  obsolete:    # bool    (optional, def. false)
  description: # markdown (required)
  elements: [ ControllerElement, ... ]
```

### 2.3 `ControllerElement`

```yaml
- register:    # string  (required) register prefix: P, B, L, S, E, R
  kind:        # enum    (required) "pot" | "button" | "led" | "switch" | "encoder" | "fader"
  direction:   # enum    (required) "input" | "output" | "special"
  valuetype:   # enum    (optional) see circuit-schema §5
  description: # markdown (required)
  # Range of the element within the controller, in one of these two forms:
  count:       # int     elements numbered 1..count  (the usual form)
  index:       # {min,max}  explicit range (for subgroups with different semantics)
  min:         # number  (optional) value minimum (validation)
  max:         # number  (optional) value maximum (validation)
```

Notes:

- Use **`count`** for the normal case (`count: 8` ⇒ `.1`…`.8`). Use **`index`**
  when the same register has subranges with different semantics (e.g. the `S10`,
  whose switches 1–2 are 8-position rotary and 3–10 are 3-position).
- **`direction: special`** for the `E` encoders, which are not read directly as a
  register but only through the `encoder`, `encoderbank` and `encoquencer`
  circuits.
- The linter generates the valid registers by combining the declared controllers
  (in order) with their `elements`.
