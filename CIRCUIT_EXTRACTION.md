# Circuit extraction — playbook & TODO

Goal: produce one `circuits/<name>.yaml` per DROID circuit (chapter 16 of the
manual), conforming to `docs/circuit-schema.md`, so the linter/extension can do
autocompletion, hover docs and validation.

The single source of truth is the manual PDF, but **you do not read the PDF**.
It has already been split into clean per-circuit plain-text files under
`extracted_text/<name>.txt` (page ranges taken from the PDF table of contents).
Each file starts with a header comment giving `# CIRCUIT`, `# MANUAL PAGES` and
`# TITLE`.

## Resources an agent needs (all already in the repo)

| What | Path |
|------|------|
| Full authoring rules for agents | `extracted_text/AGENT_INSTRUCTIONS.md` |
| Schema contract | `docs/circuit-schema.md` |
| Language spec (registers, abbreviations, arrays…) | `docs/reference.md` |
| Canonical example — complex | `circuits/lfo.yaml` |
| Canonical example — trivial | `circuits/copy.yaml` |
| Per-circuit source text | `extracted_text/<name>.txt` |
| Schema validator (the gate) | `scripts/validate_circuits.py` |

## The mandatory gate

Every produced file MUST pass:

```bash
python3 scripts/validate_circuits.py circuits/<name>.yaml   # one file
python3 scripts/validate_circuits.py                        # all files
```

An agent is not done until the validator prints `OK` for its files.

### Known YAML gotchas (cause validator failures)
- An abbreviation that is a bare `no`/`yes`/`on`/`off`/`true`/`false` is parsed
  as a boolean. **Quote it**: `abbr: "no"`.
- A plain (unquoted) description containing `": "` (colon+space) breaks the
  parser. Quote it or use a `|` block scalar.
- A name/abbr may legitimately appear as **both** an input and an output (e.g.
  `algoquencer` has `pitch`/`p` as an input array *and* an output). That is
  allowed. Duplicates **within** inputs (or within outputs) are real errors.
- Arrays: `input1 … input8 (i)` → `name: input, abbr: i, array: 8`. Only use an
  array when indices are sequential `1..N`; non-sequential families (e.g.
  `select1/3/5/7/…`) are separate entries.

## How to spawn a worker agent

Use a Sonnet sub-agent per batch. Group small circuits together; give a very
large circuit (e.g. `motoquencer`, `encoquencer`) its own agent. Paste this
prompt, filling in the circuit list:

```
You convert DROID synth manual text into structured circuit YAML for a
linter/autocompletion extension.

STEP 1 — read and follow exactly: extracted_text/AGENT_INSTRUCTIONS.md. Then
skim docs/circuit-schema.md and the reference examples circuits/lfo.yaml
(complex) and circuits/copy.yaml (simple).

STEP 2 — Your assigned circuits (source text in extracted_text/<name>.txt; work
ONLY from those files, do NOT open the PDF):
- <name1>
- <name2>

Watch out for the YAML gotchas: quote abbreviations that are bare no/yes/on/off;
quote descriptions containing ": "; a name/abbr may be both an input and an
output. Mark obsolete: true if the title contains (OBSOLETE).

For each, write circuits/<name>.yaml. After each, run
  python3 scripts/validate_circuits.py circuits/<name>.yaml
and fix until it prints OK. Finally validate all your files together. Do not
modify any other file. Report the files written and the final validator output
(must be OK).
```

Tips learned from earlier runs:
- A whole batch of ~4–6 small circuits, or 1 very large circuit, is a good unit.
- Very large files (>1500 lines of source) can stall a single agent; if one
  hangs, retry it on its own and tell it to be efficient.

## TODO checklist

Recompute the live status anytime with:

```bash
comm -23 \
  <(printf '%s\n' adc algoquencer arpeggio bernoulli burst button buttongroup \
     calibrator case chord clockedtrigger clocktool compare contour copy \
     crossfader cvlooper dac delay detune display droid encoderbank encoder \
     encoquencer euklid explin faderbank fadermatrix firefacecontrol flipflop \
     fold fourstatebutton gatetool ifequal lfo logic math matrixmixer \
     midifileplayer midiin midiout midithrough minifonion mixer motoquencer \
     motorfader multicompare notchedpot notebuttons nudge octave once \
     outputcalibrator polytool pot quantizer queue random recorder sample \
     select sequencer sinfonionlink slew spring superjust switch switchedpot \
     timing togglebutton transient triggerdelay unusedfaders vcotuner watch \
     | sort) \
  <(ls circuits/*.yaml | sed 's#circuits/##;s#.yaml##' | sort)
```

Anything that list prints is still missing. Snapshot at last update
(53/76 done):

### Done ✅ (53)
adc · algoquencer · arpeggio · bernoulli · burst · button · buttongroup · case ·
chord · clockedtrigger · compare · contour · copy · crossfader · cvlooper · dac ·
delay · detune · display · encoder · euklid · explin · fadermatrix ·
firefacecontrol · flipflop · fold · gatetool · ifequal · lfo · math ·
matrixmixer · midiout · midithrough · minifonion · mixer · motorfader ·
multicompare · notebuttons · nudge · once · outputcalibrator · random ·
recorder · sample · select · slew · spring · switch · switchedpot · transient ·
triggerdelay · unusedfaders · watch

### Pending ⬜ (23) — some may be in-flight; re-check with the command above
- [ ] calibrator
- [ ] clocktool
- [ ] droid
- [ ] encoderbank
- [ ] encoquencer   (very large — own agent)
- [ ] faderbank
- [ ] fourstatebutton   (OBSOLETE)
- [ ] logic
- [ ] midifileplayer
- [ ] midiin
- [ ] motoquencer   (VERY large ~1900 lines — own agent; stalled once, retry solo)
- [ ] notchedpot   (OBSOLETE)
- [ ] octave
- [ ] polytool
- [ ] pot
- [ ] quantizer
- [ ] queue
- [ ] sequencer
- [ ] sinfonionlink
- [ ] superjust
- [ ] timing
- [ ] togglebutton   (OBSOLETE)
- [ ] vcotuner

### Suggested remaining batches
- `motoquencer` (solo)
- `encoquencer` (solo)
- `midiin · notchedpot · queue · quantizer`
- `pot · fourstatebutton · sinfonionlink · timing`
- `midifileplayer · octave · polytool · droid`
- `calibrator · sequencer · vcotuner`
- `encoderbank · faderbank · logic`
- `togglebutton · superjust · clocktool`

## Final acceptance
1. `python3 scripts/validate_circuits.py` prints `OK: 76 file(s) valid.`
2. Spot-check a few YAMLs against their `extracted_text/<name>.txt` for fidelity
   (abbreviations, defaults, ranges, arrays, examples).
