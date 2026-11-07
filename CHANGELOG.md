# Changelog

## 1.0.1

- The circuit graph now opens for megacircuit blueprints (`.blueprint`), with their inputs and outputs drawn as jacks.
- Pressing Enter twice inside a circuit ends it: the first suggestion after a new line is "end circuit", so the second Enter no longer inserts a parameter.

## 1.0.0 — first public release

- Live error checking for `.ini` patches, matching the errors the DROID master reports.
- Autocompletion and hover documentation for circuits, parameters, registers and cables.
- Semantic colours for inputs and outputs, and a unique "rainbow" colour per internal cable.
- Forge-compatible label legends, with validation and completion.
- Hardware view of your rack and an interactive circuit graph.
- `.droider` patches: megacircuits (`.blueprint`) and free-form arithmetic, compiled to plain `.ini`.
- Write to the DROID SD card and eject in one click, with verification.
- `droid-lint` command-line linter with JSON output.
