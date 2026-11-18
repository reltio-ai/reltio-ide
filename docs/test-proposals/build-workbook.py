#!/usr/bin/env python3
"""Build the regression-test proposal workbook from per-area JSON files.

Dev-only documentation tool. Not part of CI, the gate or the VSIX.
Usage: python docs/test-proposals/build-workbook.py [--dir DIR] [--out FILE] [--allow-missing]
"""
import argparse
import json
import re
import sys
from pathlib import Path

from openpyxl import Workbook
from openpyxl.styles import Alignment, Font, PatternFill
from openpyxl.utils import get_column_letter
from openpyxl.worksheet.datavalidation import DataValidation

REPO_ROOT = Path(__file__).resolve().parents[2]
CONFIG_PATH = REPO_ROOT / "scripts" / "module-coverage.config.json"
BASELINE_PATH = REPO_ROOT / "docs" / "test-proposals" / "coverage-baseline.json"

# (area name, json file, id prefix)
AREAS = [
    ("Setup & Authentication", "setup-authentication.json", "SETUP"),
    ("Business Configuration", "business-configuration.json", "BIZCFG"),
    ("Tenant Explorer & UX", "tenant-explorer-ux.json", "TREE"),
    ("Git Integration", "git-integration.json", "GIT"),
    ("Workflows", "workflows.json", "WF"),
    ("LCA", "lca.json", "LCA"),
    ("Common Utils", "common-utils.json", "UTIL"),
    ("Extension Activation", "extension-activation.json", "ACT"),
    ("RDM", "rdm.json", "RDM"),
]

# Areas that are not in the coverage config yet: Summary shows the text and n/a for coverage columns.
EXTRA_AREAS = {
    "RDM": "Not on main yet. Source: branch origin/RP-205759-031126 "
           "(rdm/**, tree/rdmSubtree.ts, workspace/rdmRelocation.ts)",
}

KEYS = ["id", "module", "source", "title", "category", "subtype", "scenario",
        "expected", "priority", "existing_coverage", "target_script", "status"]
SUBTYPES = {
    "Technical": ["Unit", "Contract", "Integration"],
    "Functional": ["Feature", "Workflow", "Error handling"],
    "Non-functional": ["Performance", "Security", "Reliability", "Compatibility", "Scalability"],
}
CATEGORIES = list(SUBTYPES)
ALL_SUBTYPES = [s for c in CATEGORIES for s in SUBTYPES[c]]
PRIORITIES = ["P1", "P2", "P3"]
COVERAGE = ["None", "Partial", "Covered"]
STATUSES = ["Proposed", "Approved", "Rejected", "Implemented"]

# (header, row key or None, width)
COLUMNS = [
    ("ID", "id", 12), ("Area", "module", 22), ("Source", "source", 38),
    ("Test title", "title", 36), ("Category", "category", 15), ("Subtype", "subtype", 15),
    ("Scenario", "scenario", 50), ("Expected result", "expected", 50),
    ("Priority", "priority", 9), ("Existing coverage", "existing_coverage", 14),
    ("Target script", "target_script", 30), ("Status", "status", 12),
    ("Reviewer comments", None, 30), ("Dev notes", None, 30),
]
MAX_ROW = 500
ID_RE = re.compile(r"([A-Z]+)-(\d{3})")


def fail(msg):
    print("ERROR: " + msg, file=sys.stderr)
    sys.exit(1)


def load_json(path, what):
    if not path.is_file():
        fail("%s not found: %s" % (what, path))
    try:
        with open(path, encoding="utf-8") as f:
            return json.load(f)
    except ValueError as e:
        fail("%s is not valid JSON (%s): %s" % (what, path, e))


def read_config():
    cfg = load_json(CONFIG_PATH, "coverage config")
    if "target" not in cfg or not isinstance(cfg.get("areas"), list):
        fail("coverage config %s needs 'target' and 'areas'" % CONFIG_PATH)
    by_name = {a.get("name"): a for a in cfg["areas"]}
    base = load_json(BASELINE_PATH, "coverage baseline").get("areas", {})
    info = {}
    for name, _, _ in AREAS:
        if name in EXTRA_AREAS:
            info[name] = {"patterns": [EXTRA_AREAS[name]], "floor": "n/a", "baseline": "n/a", "target": "n/a"}
            continue
        if name not in by_name:
            fail("area '%s' missing from %s" % (name, CONFIG_PATH))
        if name not in base:
            fail("area '%s' missing from %s" % (name, BASELINE_PATH))
        a = by_name[name]
        if "patterns" not in a or "floor" not in a:
            fail("area '%s' in config needs 'patterns' and 'floor'" % name)
        info[name] = {"patterns": a["patterns"], "floor": a["floor"], "baseline": base[name]}
    return cfg["target"], info


def split_area_file(data, label, errors):
    """Return (rows, not_applicable) from the array or object form."""
    if isinstance(data, list):
        return data, {}
    if isinstance(data, dict):
        rows = data.get("rows")
        na = data.get("not_applicable", {})
        if not isinstance(rows, list):
            errors.append("%s: object form needs a 'rows' array" % label)
            return [], {}
        if not isinstance(na, dict):
            errors.append("%s: 'not_applicable' must be an object" % label)
            na = {}
        for cat, reason in na.items():
            if cat not in CATEGORIES:
                errors.append("%s: not_applicable category '%s' not in %s" % (label, cat, CATEGORIES))
            if not isinstance(reason, str) or not reason.strip():
                errors.append("%s: not_applicable reason for '%s' must be a non-empty string" % (label, cat))
        return rows, na
    errors.append("%s: top level must be an array or an object with 'rows'" % label)
    return [], {}


def validate_row(row, idx, area, prefix, fname, seen, errors):
    where = "%s row %d" % (fname, idx)
    if not isinstance(row, dict):
        errors.append("%s: row is not an object" % where)
        return
    if isinstance(row.get("id"), str) and row["id"]:
        where += " (%s)" % row["id"]
    missing = [k for k in KEYS if k not in row]
    extra = [k for k in row if k not in KEYS]
    if missing:
        errors.append("%s: missing key(s) %s" % (where, ", ".join(missing)))
    if extra:
        errors.append("%s: unexpected key(s) %s" % (where, ", ".join(extra)))
    for k in KEYS:
        if k in row and (not isinstance(row[k], str) or not row[k].strip()):
            errors.append("%s: '%s' must be a non-empty string" % (where, k))
    rid = row.get("id")
    if isinstance(rid, str) and rid:
        m = ID_RE.fullmatch(rid)
        if not m:
            errors.append("%s: id '%s' must look like %s-NNN" % (where, rid, prefix))
        elif m.group(1) != prefix:
            errors.append("%s: id prefix '%s' does not match area '%s' (expected %s)" % (where, m.group(1), area, prefix))
        if rid in seen:
            errors.append("%s: duplicate id '%s' (also in %s)" % (where, rid, seen[rid]))
        else:
            seen[rid] = where
    if isinstance(row.get("module"), str) and row["module"] and row["module"] != area:
        errors.append("%s: module '%s' must equal area '%s'" % (where, row["module"], area))
    enums = [("category", CATEGORIES), ("priority", PRIORITIES),
             ("existing_coverage", COVERAGE), ("status", STATUSES)]
    for k, allowed in enums:
        if isinstance(row.get(k), str) and row[k] and row[k] not in allowed:
            errors.append("%s: %s '%s' not in %s" % (where, k, row[k], allowed))
    cat, sub = row.get("category"), row.get("subtype")
    cat_ok = isinstance(cat, str) and cat in SUBTYPES
    if isinstance(sub, str) and sub and cat_ok and sub not in SUBTYPES[cat]:
        errors.append("%s: subtype '%s' does not belong to category '%s' (allowed: %s)"
                      % (where, sub, cat, SUBTYPES[cat]))
    elif isinstance(sub, str) and sub and not cat_ok and sub not in ALL_SUBTYPES:
        errors.append("%s: subtype '%s' not in %s" % (where, sub, ALL_SUBTYPES))


def load_areas(src_dir, allow_missing):
    errors, data, seen = [], {}, {}
    for area, fname, prefix in AREAS:
        path = src_dir / fname
        if not path.is_file():
            if allow_missing:
                print("skip (missing, --allow-missing): %s" % fname)
            else:
                errors.append("%s: file not found (%s)" % (fname, path))
            continue
        try:
            with open(path, encoding="utf-8") as f:
                raw = json.load(f)
        except ValueError as e:
            errors.append("%s: invalid JSON: %s" % (fname, e))
            continue
        rows, na = split_area_file(raw, fname, errors)
        for i, row in enumerate(rows, start=1):
            validate_row(row, i, area, prefix, fname, seen, errors)
        if not allow_missing:
            present = {r.get("category") for r in rows
                       if isinstance(r, dict) and isinstance(r.get("category"), str)}
            for cat in CATEGORIES:
                if cat not in present and cat not in na:
                    errors.append("%s: no %s row (add one or declare not_applicable with a reason)" % (fname, cat))
        data[area] = [r for r in rows if isinstance(r, dict)]
    return data, errors


def q(sheet):
    return "'" + sheet.replace("'", "''") + "'"


def style_header(ws, ncols):
    fill = PatternFill("solid", fgColor="D9E1F2")
    for c in range(1, ncols + 1):
        cell = ws.cell(row=1, column=c)
        cell.font = Font(bold=True)
        cell.fill = fill
        cell.alignment = Alignment(wrap_text=True, vertical="top")


def add_readme(wb):
    ws = wb.active
    ws.title = "README"
    lines = [
        ("Regression test proposals", True),
        ("Purpose: proposed regression tests per product area, for developer review. This workbook is later converted into tests in the framework; stable IDs are the key.", False),
        ("", False),
        ("How to edit", True),
        ("- Add new rows at the bottom of an area sheet. Keep existing IDs stable (never renumber or reuse an ID).", False),
        ("- Change Status (Proposed / Approved / Rejected / Implemented) to record decisions.", False),
        ("- Use 'Reviewer comments' and 'Dev notes' for discussion. Dropdowns cover rows 2 to %d." % MAX_ROW, False),
        ("", False),
        ("Columns", True),
        ("ID: <PREFIX>-NNN, unique across all sheets. Area: product area. Source: src/ file(s) and function or behaviour.", False),
        ("Test title / Scenario / Expected result: what is tested, how, and the pass condition.", False),
        ("Target script: proposed scripts/test-<name>.cjs. Status: review state. Reviewer comments / Dev notes: free text.", False),
        ("", False),
        ("Category", True),
        ("Technical: tests code-level contracts and internals (units, module contracts, integration between modules).", False),
        ("Functional: tests behaviour as a user or caller sees it (features, workflows, error handling).", False),
        ("Non-functional: tests qualities such as speed, safety and resilience.", False),
        ("", False),
        ("Subtype", True),
        ("Unit: one function or class in isolation.", False),
        ("Contract: shape or behaviour promised between modules or to an external API.", False),
        ("Integration: several real modules working together.", False),
        ("Feature: a single user-visible capability.", False),
        ("Workflow: a multi-step user journey.", False),
        ("Error handling: failure, invalid input and recovery paths.", False),
        ("Performance: time or resource use within limits.", False),
        ("Security: secrets, tokens, permissions, injection and similar.", False),
        ("Reliability: stays correct under retries, partial failure and restarts.", False),
        ("Compatibility: works across versions, platforms or data formats.", False),
        ("Scalability: behaves with large inputs or many items.", False),
        ("", False),
        ("Priority", True),
        ("P1: guards behaviour users depend on, or a known coverage gap. P2: important. P3: nice to have.", False),
        ("", False),
        ("Existing coverage", True),
        ("None: no current test. Partial: some aspects tested, gaps remain. Covered: already tested adequately.", False),
    ]
    for r, (text, bold) in enumerate(lines, start=1):
        c = ws.cell(row=r, column=1, value=text)
        c.font = Font(bold=bold, size=14 if r == 1 else 11)
        c.alignment = Alignment(wrap_text=True, vertical="top")
    ws.column_dimensions["A"].width = 120


def add_summary(wb, areas_present, target, info):
    ws = wb.create_sheet("Summary")
    headers = ["Area", "Source patterns", "Baseline line coverage %", "Floor", "Target",
               "Technical", "Functional", "Non-functional", "Total"]
    ws.append(headers)
    style_header(ws, len(headers))
    first = 2
    for area, _, _ in AREAS:
        r = ws.max_row + 1
        i = info[area]
        ws.cell(row=r, column=1, value=area)
        ws.cell(row=r, column=2, value="\n".join(i["patterns"]))
        ws.cell(row=r, column=3, value=i["baseline"])
        ws.cell(row=r, column=4, value=i["floor"])
        ws.cell(row=r, column=5, value=i.get("target", target))
        if area in areas_present:
            sh = q(area)
            for col, cat in ((6, "Technical"), (7, "Functional"), (8, "Non-functional")):
                ws.cell(row=r, column=col, value="=COUNTIFS(%s!$E:$E,\"%s\")" % (sh, cat))
        else:
            for col in (6, 7, 8):
                ws.cell(row=r, column=col, value=0)
        ws.cell(row=r, column=9, value="=SUM(F%d:H%d)" % (r, r))
        for col in range(1, 10):
            ws.cell(row=r, column=col).alignment = Alignment(wrap_text=True, vertical="top")
    last = ws.max_row
    t = last + 1
    ws.cell(row=t, column=1, value="Total").font = Font(bold=True)
    for col in range(6, 10):
        L = get_column_letter(col)
        c = ws.cell(row=t, column=col, value="=SUM(%s%d:%s%d)" % (L, first, L, last))
        c.font = Font(bold=True)
    for i, w in enumerate([26, 50, 16, 8, 8, 12, 12, 16, 8], start=1):
        ws.column_dimensions[get_column_letter(i)].width = w
    ws.freeze_panes = "A2"


def add_area_sheet(wb, area, rows, lists_ref):
    ws = wb.create_sheet(area)
    ws.append([h for h, _, _ in COLUMNS])
    style_header(ws, len(COLUMNS))
    for row in rows:
        ws.append([row[k] if k else None for _, k, _ in COLUMNS])
    for r in range(2, ws.max_row + 1):
        for c in range(1, len(COLUMNS) + 1):
            ws.cell(row=r, column=c).alignment = Alignment(wrap_text=True, vertical="top")
    for i, (_, _, w) in enumerate(COLUMNS, start=1):
        ws.column_dimensions[get_column_letter(i)].width = w
    ws.freeze_panes = "A2"
    ws.auto_filter.ref = "A1:%s%d" % (get_column_letter(len(COLUMNS)), max(ws.max_row, 2))
    for col_letter, ref in (("E", lists_ref["category"]), ("F", lists_ref["subtype"]),
                            ("I", lists_ref["priority"]), ("J", lists_ref["coverage"]),
                            ("L", lists_ref["status"])):
        dv = DataValidation(type="list", formula1=ref, allow_blank=True,
                            showErrorMessage=True, errorStyle="stop",
                            errorTitle="Invalid value", error="Pick a value from the dropdown list.")
        dv.add("%s2:%s%d" % (col_letter, col_letter, MAX_ROW))
        ws.add_data_validation(dv)


def add_lists(wb):
    ws = wb.create_sheet("Lists")
    cols = [("category", CATEGORIES), ("subtype", ALL_SUBTYPES), ("priority", PRIORITIES),
            ("coverage", COVERAGE), ("status", STATUSES)]
    refs = {}
    for ci, (name, values) in enumerate(cols, start=1):
        L = get_column_letter(ci)
        for ri, v in enumerate(values, start=1):
            ws.cell(row=ri, column=ci, value=v)
        refs[name] = "=Lists!$%s$1:$%s$%d" % (L, L, len(values))
    ws.sheet_state = "hidden"
    return refs


def build(data, target, info, out):
    wb = Workbook()
    add_readme(wb)
    add_summary(wb, set(data), target, info)
    # Lists sheet must exist for refs; create it last so it sits at the end.
    refs = {"category": "=Lists!$A$1:$A$%d" % len(CATEGORIES),
            "subtype": "=Lists!$B$1:$B$%d" % len(ALL_SUBTYPES),
            "priority": "=Lists!$C$1:$C$%d" % len(PRIORITIES),
            "coverage": "=Lists!$D$1:$D$%d" % len(COVERAGE),
            "status": "=Lists!$E$1:$E$%d" % len(STATUSES)}
    for area, _, _ in AREAS:
        if area in data:
            add_area_sheet(wb, area, data[area], refs)
    built = add_lists(wb)
    assert built == refs, "Lists layout drifted from validation references"
    out.parent.mkdir(parents=True, exist_ok=True)
    wb.save(str(out))


def print_counts(data):
    print("%-26s %9s %10s %15s %6s" % ("Area", "Technical", "Functional", "Non-functional", "Total"))
    totals = [0, 0, 0]
    for area, _, _ in AREAS:
        if area not in data:
            continue
        counts = [sum(1 for r in data[area] if r["category"] == c) for c in CATEGORIES]
        totals = [a + b for a, b in zip(totals, counts)]
        print("%-26s %9d %10d %15d %6d" % (area, counts[0], counts[1], counts[2], sum(counts)))
    print("%-26s %9d %10d %15d %6d" % ("Total", totals[0], totals[1], totals[2], sum(totals)))


def resolve(p, default):
    if p is None:
        return default
    path = Path(p)
    return path if path.is_absolute() else Path.cwd() / path


def main():
    ap = argparse.ArgumentParser(description="Build the regression test proposal workbook.")
    ap.add_argument("--dir", help="folder with the per-area JSON files (default docs/test-proposals)")
    ap.add_argument("--out", help="output xlsx (default docs/test-proposals/ide-regression-test-proposals.xlsx)")
    ap.add_argument("--allow-missing", action="store_true", help="skip missing area files")
    args = ap.parse_args()
    src_dir = resolve(args.dir, REPO_ROOT / "docs" / "test-proposals")
    out = resolve(args.out, REPO_ROOT / "docs" / "test-proposals" / "ide-regression-test-proposals.xlsx")

    target, info = read_config()
    data, errors = load_areas(src_dir, args.allow_missing)
    if errors:
        print("Validation failed with %d violation(s):" % len(errors), file=sys.stderr)
        for e in errors:
            print("  - " + e, file=sys.stderr)
        print("No workbook written.", file=sys.stderr)
        sys.exit(1)
    if not data:
        fail("no area files found in %s" % src_dir)
    build(data, target, info, out)
    print_counts(data)
    print("Wrote %s" % out)


if __name__ == "__main__":
    main()
