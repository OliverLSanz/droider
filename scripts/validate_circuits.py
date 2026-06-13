#!/usr/bin/env python3
"""Validate circuit YAML files against docs/circuit-schema.md.

Usage:
    python3 scripts/validate_circuits.py [circuits/foo.yaml ...]
With no args, validates every circuits/*.yaml.
Exit code 0 = all valid, 1 = at least one error.
"""
import sys, os, glob, yaml

VALUETYPES = {"cv","gate","trigger","clock","pitch","integer","fraction","bipolar","text"}
UNITS = {"hz","volt","octave","semitone","second","percent","beat"}

def err(errors, fname, msg):
    errors.append(f"{fname}: {msg}")

def check_param(errors, fname, p, role, idx):
    where = f"{role}[{idx}]"
    if not isinstance(p, dict):
        err(errors, fname, f"{where} is not a mapping"); return
    name = p.get("name")
    if not name or not isinstance(name, str):
        err(errors, fname, f"{where} missing/invalid 'name'")
    if "description" not in p or not p.get("description"):
        err(errors, fname, f"{where} ({name}) missing 'description'")
    vt = p.get("valuetype")
    if role == "input" and not vt:
        err(errors, fname, f"{where} ({name}) input missing 'valuetype'")
    if vt is not None and vt not in VALUETYPES:
        err(errors, fname, f"{where} ({name}) invalid valuetype '{vt}'")
    u = p.get("unit")
    if u is not None and u not in UNITS:
        err(errors, fname, f"{where} ({name}) invalid unit '{u}'")
    if "array" in p and not isinstance(p["array"], int):
        err(errors, fname, f"{where} ({name}) 'array' must be int")
    for k in ("min","max"):
        if k in p and p[k] is not None and not isinstance(p[k], (int,float)):
            err(errors, fname, f"{where} ({name}) '{k}' must be a number")
    # abbr must be string or null
    if "abbr" in p and p["abbr"] is not None and not isinstance(p["abbr"], str):
        err(errors, fname, f"{where} ({name}) 'abbr' must be string or null")
    allowed = {"name","abbr","valuetype","default","min","max","unit","array","description"}
    for k in p:
        if k not in allowed:
            err(errors, fname, f"{where} ({name}) unknown key '{k}'")
    return name, p.get("abbr")

def validate_file(path, errors):
    fname = os.path.basename(path)
    base = fname[:-5] if fname.endswith(".yaml") else fname
    try:
        with open(path) as f:
            data = yaml.safe_load(f)
    except Exception as e:
        err(errors, fname, f"YAML parse error: {e}"); return
    if not isinstance(data, dict):
        err(errors, fname, "top level is not a mapping"); return
    # required top-level
    for k in ("name","title","description"):
        if not data.get(k):
            err(errors, fname, f"missing required field '{k}'")
    if data.get("name") != base:
        err(errors, fname, f"name '{data.get('name')}' != filename '{base}'")
    allowed_top = {"name","title","manual_page","obsolete","category",
                   "memory_bytes","description","inputs","outputs","examples"}
    for k in data:
        if k not in allowed_top:
            err(errors, fname, f"unknown top-level key '{k}'")
    # Duplicate name/abbr is an error WITHIN a section (two inputs, two outputs).
    # Sharing a name/abbr across input<->output is allowed: the manual genuinely
    # reuses some (e.g. algoquencer `pitch`/`p` is both an input array and an
    # output; `length`/`led` share abbr `l`).
    for role in ("inputs","outputs"):
        lst = data.get(role)
        if lst is None:
            continue
        if not isinstance(lst, list):
            err(errors, fname, f"'{role}' must be a list"); continue
        seen = {}
        for i, p in enumerate(lst):
            r = check_param(errors, fname, p, role[:-1], i)
            if not r: continue
            nm, ab = r
            for key in filter(None, (nm, ab)):
                if key in seen:
                    err(errors, fname, f"duplicate name/abbr '{key}' within {role}")
                seen[key] = True

def main():
    args = sys.argv[1:]
    files = args if args else sorted(glob.glob(os.path.join(os.path.dirname(__file__),"..","circuits","*.yaml")))
    errors = []
    for path in files:
        validate_file(path, errors)
    if errors:
        print(f"FAIL: {len(errors)} error(s) across {len(files)} file(s):")
        for e in errors:
            print("  -", e)
        sys.exit(1)
    print(f"OK: {len(files)} file(s) valid.")

if __name__ == "__main__":
    main()
