# DROID patch language reference

> Specification of the text language used in the `droid.ini` files of the
> **DROID** Eurorack module family.
>
> This reference is meant as the basis for building a VSCode extension that
> offers **autocompletion**, **hover documentation** and **error detection**.
> That is why, besides describing the syntax, each section explicitly points out
> the rules a *linter* can check and the data an autocompletion engine needs.
>
> Source: *DROID manual for blue-7*, especially chapter 5 ("Creating DROID
> patches with a text editor") and chapter 16 ("Reference of all circuits").

---

## 1. Overview

A DROID module is a programmable CV (control voltage) processor/generator. A
**patch** is a text file called `droid.ini` that is copied to a micro SD card.
The patch is a **list of circuits**.

- A **circuit** is a pre-programmed functionality (an LFO, an envelope, a
  quantizer, etc.). The module offers a long list of circuit types from which the
  user picks the ones they need.
- Each circuit takes **inputs** (input values), processes them and produces
  **outputs** (output values).
- Inputs and outputs are connected to:
  - **physical jacks** of the module (CV inputs/outputs, gates…),
  - **controller elements** (pots, buttons, faders, encoders, LEDs…),
  - **fixed values** (numbers, voltages, texts),
  - **internal virtual cables** (names starting with `_`) that connect circuits
    to each other without using real jacks.

The `droid.ini` file the Forge (the official graphical editor) edits is exactly
the same text format described here; the Forge is just a visual way to edit this
text.

### Loading procedure (context)

1. Create a plain text file called `droid.ini` (not a Word document).
2. Copy it to the root of a FAT-formatted micro SD card (no subdirectories).
3. Insert the card into the master and press the load button (or, with
   MASTER18/X7, use the USB switch).
4. If there is an error, the module blinks LEDs and generates a `DROIDERR.TXT`
   file with the line and reason of the error.

---

## 2. File structure

A patch is a sequence of **circuit declarations**. Each declaration has:

1. A **header**: the circuit type name between square brackets, on its own line:
   `[lfo]`.
2. Zero or more **parameter lines**: assignments of the form `name = value`, one
   per line. By convention they are indented for readability, but the indentation
   is optional.

Minimal example (two circuits):

```ini
[lfo]
hz = 0.5
triangle = _CABLE_1

[contour]
gate = I1
decay = _CABLE_1
sustain = P1.1
release = I2
output = O1
```

Here `[lfo]` and `[contour]` are the two circuits. Each carries a list of
parameters (inputs and outputs) assigned to jacks, fixed values or internal
cables.

### 2.1 Controller declaration

Controllers (P2B8, P10, etc.) **must be declared at the top of the patch**,
before the circuits, with one header per controller and in the same physical
order as the chain (starting with the one connected directly to the master).

```ini
[p2b8]
[p2b8]
[p10]
```

Valid controller header types:

| Header     | Controller                                   |
|------------|----------------------------------------------|
| `[p2b8]`   | P2B8 (2 pots + 8 buttons)                     |
| `[p4b2]`   | P4B2 (4 pots + 2 buttons)                     |
| `[p10]`    | P10 (10 pots)                                 |
| `[s10]`    | S10 (10 switches)                             |
| `[p8s8]`   | P8S8 (8 pots + 8 switches)                    |
| `[b32]`    | B32 (32 buttons)                              |
| `[m4]`     | M4 (4 motor faders)                           |
| `[e4]`     | E4 (4 encoders)                               |
| `[db8e]`   | DB8E (display + encoders)                     |

> **Rule (linter):** If a patch uses controller registers (`P`, `B`, `L`, `S`,
> `E`, etc.), the corresponding controller declaration must exist. The maximum
> number of declared controllers is **16** (exceeding it is a global error *Too
> many controllers*).
>
> **Note:** some of these controllers also appear as *circuits* in chapter 16
> with their own parameters (e.g. controller configuration). The header as a
> controller declaration and the header as a circuit share the name; the context
> (position at the top of the patch, with/without parameters) determines the use.
> The extension must handle these names carefully.

---

## 3. Registers (physical and controller inputs/outputs)

A **register** is anything that behaves like a value container: jacks, pots,
buttons, LEDs, switches… Each register has a name made of one or more letters
followed by a number (or `number.number` on controllers and expanders).

Registers are the main autocompletion material for the extension: it must offer
the master's physical registers, those of the declared expanders, and those of
the declared controllers.

### 3.1 MASTER registers

| Register                | Type            | Description |
|-------------------------|-----------------|-------------|
| `I1` … `I8`             | input           | The eight CV inputs. |
| `N1` … `N8`             | output          | Normalization of each input: value `Ix` takes when no cable is patched into that input. Defaults to `0.0`. |
| `O1` … `O8`             | output          | The eight CV outputs. |
| `G1` … `G8`             | input/output    | Jacks of the first G8 expander. Each can be an input or an output. `G1` is equivalent to `G1.1`. |
| `G2.1` … `G2.8`         | input/output    | Jacks of the second G8. Use `G3.x` and `G4.x` for the third and fourth G8. |
| `G9` … `G12`            | output          | The four gate jacks of the X7 expander (always outputs). |
| `R1` … `R8`             | output          | Colored LED squares of the first two rows (the input rows). |
| `R9` … `R16`            | output          | Colored LED squares of rows three and four (the output rows). |
| `R17` … `R48`           | output          | Colored LED squares of the G8 expanders (1st to 4th). |
| `R49` … `R56`           | output          | Colored LED squares of the X7 expander. |
| `X1`                    | output          | Special register for displaying a value encoded in the 4×4 LED matrix. |

### 3.2 MASTER18 registers

| Register                | Type            | Description |
|-------------------------|-----------------|-------------|
| `I1` `I2`               | input           | Gate/trigger inputs. |
| `O1` … `O8`             | output          | The eight CV outputs. |
| `G1` … `G4`             | output          | The four gate/trigger outputs. |
| `G2.1` … `G2.8`         | input/output    | Jacks of the first G8. Use `G3.x`, `G4.x`, `G5.x` for the 2nd, 3rd and 4th G8. |
| `G9` … `G12`            | output          | The four gate jacks of the X7 (always outputs). |
| `R1` … `R4`             | output          | Colored diagnostic LEDs on the back. |
| `R17` … `R48`           | output          | Colored LED squares of the G8 expanders. |
| `R49` … `R56`           | output          | Colored LED squares of the X7 expander. |

### 3.3 Controller registers

The name always has a dot separating two numbers: the first is the controller
number (per declaration order) and the second the number of the element within
that controller.

| Register          | Type     | Description |
|-------------------|----------|-------------|
| `Px.y`            | input    | Pots, sliders and faders. `P3.2` = 2nd pot of the 3rd controller. |
| `Ex.y`            | special  | Encoders of the E4 or DB8E. **Only** usable with the `encoder`, `encoderbank` and `encoquencer` circuits. |
| `Bx.y`            | input    | Buttons (push or touch). `B3.6` = 6th button of the 3rd controller. `1.0` while pressed, `0.0` at rest. |
| `Lx.y`            | output   | LED inside a button. `0.0` = off, `1.0` = full brightness; intermediate values give intermediate brightness; negatives are treated as positive. |
| `Sx.y`            | input    | Switches (S10 and P8S8). |
| `Rx.y`            | output   | Color of the LEDs in the touch buttons of the M4 controllers. |

> **Note on button LEDs:** as long as you do not actively write to an `L`
> register, the button LED lights up automatically when pressed.

> **Note on `R` register colors (LED matrix):** `0.0` turns the LED off; other
> values select a color at full brightness. Approximate table: `0.2` cyan, `0.4`
> green, `0.6` yellow, `0.73` orange, `0.8` red, `1.0` magenta, `1.1` violet,
> `1.2` blue. Intermediate values give intermediate colors.

### 3.4 Register rules (linter)

- **Unknown register** (error *Unknown register*, yellow): using a non-existent
  register name (e.g. `O9`, which does not exist: there is only `O1`…`O8`).
- **Input used as output** (yellow error): writing to an input register is not
  allowed. Wrong example: `led1 = B1.1` (should be `L1.1`). `I`, `P`, `B`, `S`
  are inputs and cannot appear as a circuit's destination/output.
- An **output can be used as an input** of another circuit (see §7.2).
- Expander registers (`G`, `R17+`, `R49+`, `X1`) and controller registers (`P`,
  `B`, `L`, `S`, `E`, `Rx.y`) are only valid if the corresponding hardware is
  present/declared.

---

## 4. Values: numbers, voltages, gates and texts

The right-hand side of an assignment (`parameter = value`) can be a fixed number,
a register, an internal cable or a text, possibly with attenuation and offset
(see §6).

### 4.1 Numbers

- They must be written in **"plain"** format: `0.01`, `12345.67`, `-5.0`.
- Scientific notation is **not** allowed (`3.4^-10`).
- Omitting the leading zero is **not** allowed: write `0.5`, not `.5`.

### 4.2 Suffixes `%` and `V`

Two suffixes can be appended to a number:

- `%` divides the number by 100: `45%` ≡ `0.45`.
- `V` divides the number by 10 (number→output-voltage conversion at a jack):
  `2V` ≡ `0.2`.

> **Watch the operation order of the `V` suffix:** the `V` applies only to the
> number itself. `1/12V` means `1 / (12V)` = `1 / 1.2` = `0.8333`, **not**
> `(1/12) V` = `0.008333`.

### 4.3 Gates: `on` / `off`

For inputs/outputs that behave like gates (only 0 or 1) there are two convenience
words:

- `off` ≡ `0.0`
- `on` ≡ `1.0`

```ini
[contour]
loop = on
output = O1
```

### 4.4 Texts

Some circuits accept texts as parameters (e.g. `header` in `display`, relevant
with a DB8E controller).

- They are written between **double quotes**: `header = "Voice allocation"`.
- Only printable ASCII characters are allowed (codes 32…126).
- A double quote **cannot** be placed inside the text; there is no escape
  character. If you need quotes, use single quotes inside the text.

Internally texts are not a new type: when the patch is loaded, each unique text is
replaced by an integer (the first by `1`, the second by `2`, etc.) and a text
table is built. That is why texts can pass through other circuits (such as
`switch`) that only see numbers, and they also support attenuation/offset:

```ini
[display]
text = "Button pressed" * B1.1
```

Here, while `B1.1` is `1`, the text is shown; when it is `0`, the result is `0`,
which is not a valid text and is treated as empty text.

---

## 5. Internal cables (virtual patch cables)

To connect circuits to each other without using physical jacks, use **internal
cables**: any name **starting with an underscore `_`**. It is written as an
output in one circuit and reused as an input in one or more others.

```ini
[lfo]
square = _TRIGGER

[contour]
trigger = _TRIGGER
output = O1
```

An internal cable is always a **multiple**: it can be read from several circuits
at once (several inputs), but it can only be written from one (a single output).

### 5.1 Internal cable rules (linter)

Green error *Internal patch cable misused* if one of these rules is broken:

1. **No input:** a cable is only used as an output (nobody reads it) → useless.
2. **No output:** a cable is only used as an input (nobody writes it).
3. **Double output:** a cable is used twice as an output → short circuit.

> For the extension, the cables in use are a key autocompletion source: it must
> suggest the `_...` names already defined in the patch.

---

## 6. Attenuation and offset (the `A * B + C` form)

Every circuit **input** (not the outputs!) has a built-in option to attenuate and
offset the value. The general allowed form is:

```
A * B + C
```

where:

- `A * B` is the **attenuation / amplification / multiplication** (a single
  multiplication).
- `+ C` is the **offset / sum** (a single addend).
- Each of `A`, `B`, `C` can be a fixed number, any register or an internal cable.
- Attenuation comes **first**, offset **last**.

Examples:

```ini
level = P1.1 * 0.5        # attenuate the pot to 50 %
level = I1 * P1.1         # P1.1 acts as an attenuator for I1's CV
level = P1.1 * 0.8 + 0.2  # scale and offset
rate  = 0.05 * P1.2 + P1.1 # P1.1 coarse, P1.2 fine (20× finer)
input = I1 + I2           # simple mix of two signals (offset with a register)
```

### 6.1 Allowed shorthands

These forms are shortcuts the module internally transforms into `A * B + C`:

- **Negation:** `-P1.1` ≡ `-1 * P1.1`.
  - That is why `-P1.1 * I1` is **not** valid: it would be `-1 * P1.1 * I1`, two
    multiplications.
- **Division by a fixed number:** `I1 / 12` ≡ `I1 * 0.0833333`.
  - You can only divide by a fixed number. `I1 / P1.1` is **not** valid (it would
    be a dynamic division).
- **Subtraction:** `P1.1 - 0.5` ≡ `P1.1 + -0.5`.
  - `I1 - I2` ≡ `-1 * I2 + I1`: the negation "uses up" the multiplication, so you
    could not also multiply.

### 6.2 Attenuation/offset rules (linter)

- Only **one** multiplication and **one** addition are allowed. Everything must
  be rewritable as `A * B + C`.
- The multiplication comes before the addition.
- **Not** allowed: parentheses, additional operations, division by a register,
  more than one multiplication, etc.
- For more complex operations use the `math` circuit.

> **Why so restrictive:** when the patch is loaded everything is converted to
> `A * B + C` (if there is no multiplication, `B = 1`; if there is no offset, `C
> = 0`). This makes the real-time computation trivial and low latency.

---

## 7. Special connections between circuits

### 7.1 Internal cables

See §5.

### 7.2 Using an output as an input

An **output** register can be used as an input to another circuit. Example: an
LFO writes a square wave to LED `R1` and then that same `R1` is read as the clock
of a Euclidean rhythm:

```ini
[lfo]
hz = 2
square = R1

[euklid]
clock = R1
length = 12
beats = 5
output = O1
```

### 7.3 Using an input as an output (not allowed)

Using an **input** register as an output is **not allowed** and makes no sense.
It produces a yellow error on the corresponding line (see §3.4).

---

## 8. Parameter arrays

Some circuits have arrays of similar jacks: `output1`, `output2`, `output3`… For
the first element you can **omit the digit `1`**: `output` is equivalent to
`output1`.

> **Rule (linter / autocompletion):** when validating/suggesting array
> parameters, `name` and `name1` are equivalent. The maximum number of array
> elements depends on each circuit.

---

## 9. Comments and spaces

- A `#` starts a comment: all text until the end of the line is ignored.
- Comments can be on their own line or at the end of a parameter line.
- Spaces and comments are removed automatically when the patch is loaded, so they
  don't count toward the size limit.

```ini
# Envelope for the foobar voice
[contour]
trigger = _TRIGGER   # wired to the sequencer
attack = 0.5         # another comment
release = 0.8
output = O2          # wired to the foobar trigger
```

---

## 10. Abbreviated parameter names

Since firmware blue-6, **every parameter has an abbreviation**. The two forms are
equivalent and can be mixed. Abbreviations reduce the patch size (64,000-byte
limit).

```ini
[algoquencer]      # long form
clock = I1
reset = I2
pattern = _PATTERN
button1 = B1.1
```

```ini
[algoquencer]      # equivalent abbreviated form
c = I1
r = I2
pt = _PATTERN
b1 = B1.1
```

> The full list of abbreviations is in the firmware ZIP
> (`droid-cheatsheet-...pdf`). In this reference, each parameter includes its
> abbreviation in parentheses (see §13). The extension must accept **both** forms
> in autocompletion and validation, and show them in the hover.

---

## 11. Multiple patches on the same card

You can store alternative patches with names `droidXY.ini`, where `X` is the
controller number and `Y` the button number. For example `droid14.ini` is loaded
by holding button 4 of the first controller while pressing the master's load
button.

> **Important:** each alternative patch file must contain its own controller
> declarations (`[p2b8]`, etc.); otherwise the buttons are not registered and you
> won't be able to switch patches.

Each patch's state is saved separately in a `DSTAXY.BIN` file.

---

## 12. Errors and validation

The master detects two kinds of error. This section is the basis for the
extension's **linter**. When there is an error, `DROIDERR.TXT` is generated with
a line like:

```
ERROR IN LINE 17: Invalid output 'O9'. Allowed is O1 ... O8
```

### 12.1 Global errors (all LEDs the same color)

They affect the patch as a whole:

| Color   | Error | Meaning |
|---------|-------|---------|
| yellow  | *Patch not found* | No `droid.ini`, or no patch was ever loaded, or a factory reset without reloading. |
| red     | *Too many controllers* | More than 16 controllers declared. |
| blue    | *Patch is too big* | `droid.ini` (without spaces or comments) exceeds 64,000 bytes. |
| cyan    | *Out of memory* | The circuits use too much RAM. Usage depends on the circuit type (the smallest, `bernoulli`, ~200 bytes; the largest, `midifileplayer` ~7,000 and `cvlooper` ~18,000; most 400–800). Total available ~110,000 bytes. |
| magenta | *Invalid firmware file* | The update `droid.fw` is invalid/corrupted. |
| white   | *No SD card found* | The card was not found. |

### 12.2 Local errors (only some LEDs; affect one line)

The color indicates the reason; the LEDs also encode the line number.

| Color   | Error | Meaning / linter check |
|---------|-------|------------------------|
| yellow  | *Unknown register* | Non-existent register name (`O9`, etc.). Also: input used as output. |
| orange  | *Unknown parameter name* | The circuit does not support that parameter. |
| red     | *Unknown circuit* | The circuit type does not exist (check spelling / firmware version). |
| blue    | *Line too long* | A line exceeds **63 characters**. |
| green   | *Internal patch cable misused* | Misused internal cable: no input, no output, or double output (see §5.1). |
| magenta | *Invalid header / parameter line / value* | (1) A `[` header was expected and something else was found. (2) Invalid parameter line: it must be `name = value`, starting with a letter followed by `=`. (3) Invalid parameter value (disallowed syntax/range). |

### 12.3 Summary of linter-checkable rules

1. **Headers:** a circuit header is `[` + existing circuit name + `]`.
2. **Parameter lines:** form `name = value`; the name starts with a letter.
3. **Valid parameter:** the name (long or abbreviated) must exist in that circuit.
4. **Valid register:** it must exist in the present/declared hardware.
5. **Register direction:** do not write to input-only registers; outputs can be
   read as inputs.
6. **Internal cables:** each `_cable` must have exactly one output and at least
   one input.
7. **Value syntax:** numbers in plain format; at most `A * B + C`; division only
   by a fixed number; no parentheses or extra operations.
8. **Line length:** ≤ 63 characters.
9. **Total size:** ≤ 64,000 bytes (not counting spaces/comments).
10. **Controllers:** ≤ 16; declared at the top and in chain order.

---

## 13. Circuit template: `lfo`

> This section is the **template** for documenting each circuit when all the
> information from chapter 16 is extracted. It reproduces the full structure of a
> circuit: description, examples, table of inputs (with abbreviation, range,
> default value and description) and table of outputs (with abbreviation and
> description).
>
> Table format per the manual:
> - **Input:** long name + `(abbreviation)`.
> - **Type:** allowed value range/type (when the manual states it; usually shown
>   as a range `min … max`, e.g. `0 … 1`, or empty if free).
> - **Default:** default value if the input is not patched.
> - **Description:** explanation.

### `lfo` — Low frequency oscillator (LFO)

Flexible low frequency oscillator with seven waveforms, phase modulation, sync
mechanisms, randomization (*randomize*), waveform *morphing* and other features.

It is not meant for audio rate: it works up to ~1000–1500 Hz but will sound
distorted and full of digital artifacts, especially on waveforms with steep edges
(square, ramp, sawtooth).

**Minimal example** (frequency in Hz, triangle output to `O1`):

```ini
[lfo]
hz = 4
triangle = O1
```

**Bipolar output, level and offset** (sine at 5 Hz swinging between 2 V and 3.5 V):

```ini
[lfo]
hz = 5
level = 1.5V
offset = 2V
sine = O4
```

**Frequency control.** There are three combinable ways:

- `hz`: sets the frequency directly in hertz. Cannot be used at the same time as
  `taptempo`.
- `rate`: 1 V/octave scheme; each volt doubles the frequency (base 1 Hz).
- `taptempo`: send a steady clock and the LFO follows its speed; it can then be
  modified with `rate` and `hz`.

```ini
[lfo]
taptempo = G1   # steady clock
rate = -1V      # runs at half the clock speed
sawtooth = O2
```

> **Hz vs BPM:** to use the LFO as a master clock at 16th notes (4 PPQN),
> `hz = BPM / 15`. So 120 BPM ⇒ `hz = 8`.

**Waveform selection and morphing** via the common output `output` and the
`waveform` input (0 = square … 6 = cosine). Non-integer values are allowed to mix
two adjacent shapes (e.g. `2.1` = 90% triangle + 10% ramp).

**Randomization** (`randomize`, experimental): each "hill" of the wave gets a
random height. With `bipolar` enabled, each half-cycle counts as a hill, so the
randomization works differently.

#### Inputs

| Input (abbr.)        | Type    | Default | Description |
|----------------------|---------|---------|-------------|
| `rate` (`ra`)        |         | `0.0`   | 1 V/oct frequency control. Base is 1 Hz; each volt doubles the frequency (`1V`/`0.1` → 2 Hz, `2V`/`0.2` → 4 Hz). Negative voltages reduce it (`-1V`/`-0.1` → 0.5 Hz). |
| `taptempo` (`tt`)    |         |         | Reference clock: the LFO runs at the speed of that clock, modifiable by `rate` and `hz`. |
| `hz` (—)             |         | `1.0`   | Sets the frequency in Hz directly. Do not use together with `taptempo`; both can be combined with `rate`. |
| `level` (`l`)        |         | `1.0`   | Maximum positive output level. `1.0` = swing 0 V…10 V (or -10 V…10 V with `bipolar`). |
| `randomize` (`r`)    | 0 … 1   | `0.0`   | Experimental randomization: each hill of the wave gets a random attenuation multiplied by the current level. |
| `offset` (`of`)      |         | `0.0`   | Shifts the LFO output by that voltage, right before the output (equivalent to adding a fixed voltage). |
| `bipolar` (`b`)      | gate    | `0`     | If `on`, the LFO swings from `-level` to `+level`; if `off`, from 0 V to `+level`. |
| `phase` (`p`)        | 0 … 1   | `0.0`   | Shifts the LFO phase. `0.5` = 180°, `1.0` = 360° (same as `0.0`). |
| `pulsewidth` (`pw`)  | 0 … 1   | `0.5`   | Pulse width of the square wave (only affects `square`). Exactly `0.0` or `1.0` sticks the output to the lower/upper level. |
| `skew` (`sk`)        | 0 … 1   | `0.5`   | Symmetry of the triangle wave (only affects `triangle`). `0.5` = symmetric; `0.0` = exact ramp; `1.0` = sawtooth. |
| `sync` (`sy`)        | trigger |         | A positive edge resets the LFO to the "start" of the wave (modifiable with `syncphase`). |
| `syncphase` (`sp`)   | 0 … 1   | `0.0`   | Changes the phase at which the wave restarts on a `sync` trigger. `0.5` restarts at the middle of the wave. |
| `waveform` (`w`)     |         | `0.0`   | Selects the waveform of the common `output`. Integer 0–6 picks one of the seven; intermediate values mix the two neighbors. Codes: 0 square, 1 sawtooth, 2 triangle, 3 ramp, 4 paraboloid, 5 sine, 6 cosine. |

#### Outputs

| Output (abbr.)       | Description |
|----------------------|-------------|
| `output` (`o`)       | Main LFO output (shape selected by `waveform`). |
| `square` (`q`)       | Square wave, modified by `pulsewidth`. |
| `sawtooth` (`st`)    | Sawtooth wave (rising ramp). |
| `triangle` (`t`)     | Triangle wave, modified by `skew`. |
| `ramp` (`rp`)        | Falling ramp (mirrored sawtooth). In bipolar mode it is the negation of `sawtooth`; in unipolar mode it is not (it is positive). |
| `paraboloid` (`pb`)  | Experimental shape similar to a sine, derived from a triangle by squaring the distance of each point to `level`. |
| `sine` (`si`)        | Sine wave. |
| `cosine` (`cs`)      | Sine wave shifted by 90° (for quadrature applications without needing two LFOs). |

---

## 14. Label legend (Droid Forge)

Droid Forge can show **labels** on the rack's jacks and controls. Those labels
are stored as a **block of comments at the top of the patch** with a specific
format the Forge reads. They are not part of the language the master runs (they
are comments), but it is worth validating them so the Forge interprets them
correctly.

### 14.1 Format

```ini
# LABELS: master=16
# INPUTS:
#  I1: [ENV TRIG] This is the full description
#  I4: [1VOCT]

# OUTPUTS:
#  O4: [VOCT COPY] Another full description
#  O8: [VCF-CO]

# CONTROLLER 1:
#  S1.1: [shrt] full for a pot

# CONTROLLER 4:
#  B4.1: [btn] button fancy
```

- The block goes **at the top of the file**, before any circuit or controller. It
  starts with the header `# LABELS: ...` (the content after the colon, e.g.
  `master=16`, is generated by the Forge; the linter does not validate it).
- Sections: `# INPUTS:`, `# OUTPUTS:` and `# CONTROLLER <n>:` (one per controller
  with labels; `<n>` is the controller number in the chain).
- Each entry has the form:

  ```
  #  <register>: [<short label>] <long description>
  ```

  - `<register>`: the labeled jack or control (`I1`, `O4`, `S1.1`, `B4.1`…).
  - `[<short label>]`: the short label shown on the rack. **Optional**.
  - `<long description>`: descriptive text. **Optional**.

  Both parts are optional, so `#  I4: [1VOCT]`,
  `#  I1: This is the full description` and `#  I1: [TRIG] description` are all
  valid.

### 14.2 Validation rules (linter)

- **Non-existent register** (error): the entry references a jack/control that
  does not exist on this hardware (including a piece that does not exist on the
  controller declared at that position, e.g. `B4.99` if controller 4 has only 8
  buttons).
- **Label too long** (warning): the `[short label]` exceeds **5 characters**. It
  is not an error (the Forge accepts it), but more than 5 does not display well.
- **Register in the wrong section** (warning):
  - under `# INPUTS:` master inputs are expected (`I1`…),
  - under `# OUTPUTS:` master outputs (`O1`…),
  - under `# CONTROLLER <n>:` registers of that controller (`X<n>.y`).

### 14.3 Editor helpers

- **Autocompletion:** when typing an entry inside a section, the appropriate
  registers are suggested (inputs under `INPUTS`, outputs under `OUTPUTS`, and the
  controls of controller `<n>` under `CONTROLLER <n>`).

---

## Appendix A. List of circuit types

Quick reference of all circuit types from chapter 16 (to be documented with the
§13 template). Useful for autocompleting `[...]` headers.

`adc`, `algoquencer`, `arpeggio`, `bernoulli`, `burst`, `button`,
`buttongroup`, `calibrator`, `case`, `chord`, `clockedtrigger`, `clocktool`,
`compare`, `contour`, `copy`, `crossfader`, `cvlooper`, `dac`, `delay`,
`detune`, `display`, `droid`, `encoderbank`, `encoder`, `encoquencer`,
`euklid`, `explin`, `faderbank`, `fadermatrix`, `firefacecontrol`, `flipflop`,
`fold`, `fourstatebutton` *(obsolete)*, `gatetool`, `ifequal`, `lfo`, `logic`,
`math`, `matrixmixer`, `midifileplayer`, `midiin`, `midiout`, `midithrough`,
`minifonion`, `mixer`, `motoquencer`, `motorfader`, `multicompare`,
`notchedpot` *(obsolete)*, `notebuttons`, `nudge`, `octave`, `once`,
`outputcalibrator`, `polytool`, `pot`, `quantizer`, `queue`, `random`,
`recorder`, `sample`, `select`, `sequencer`, `sinfonionlink`, `slew`, `spring`,
`superjust`, `switch`, `switchedpot` *(obsolete)*, `timing`,
`togglebutton` *(obsolete)*, `transient`, `triggerdelay`, `unusedfaders`,
`vcotuner`, `watch`.
