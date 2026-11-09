#!/usr/bin/env python3
"""Report every cross-repo agreement point and whether it holds right now.

The SOC Assistant spans three checkouts that must agree with each other:
the widget dev kit (this repo), the framework (fsr-playbook-framework, which
publishes `fsr_playbooks`) and the connector (connector-fsr-soc-assistant).
Nothing ran these comparisons together before; each drift was found by hand.

This script READS values from the three checkouts and compares them. It does
not run any test, touch a box, use the network or write anything. Each check
prints one of:

  HOLDS       the two sides agree
  DRIFT       they disagree (exit status 1 unless --report)
  INFO        a fact worth knowing that is not itself a disagreement
  UNVERIFIED  a checkout this check needs is not present

Locations (override with env vars; defaults assume the sibling layout):
  FSR_ALL_WIDGETS      this dev kit's widgets-src/ directory
  FSR_FRAMEWORK_REPO   the fsr-playbook-framework checkout
  FSR_CONNECTOR_REPO   the directory that CONTAINS connector-fsr-soc-assistant/

Usage:
  python3 scripts/cross_repo_agreement.py            # exit 1 on any DRIFT
  python3 scripts/cross_repo_agreement.py --report   # always exit 0
  python3 scripts/cross_repo_agreement.py --json
"""
from __future__ import annotations

import argparse
import ast
import hashlib
import json
import os
import re
import subprocess
import sys
from dataclasses import dataclass, field
from pathlib import Path

HARNESS = Path(__file__).resolve().parents[1]
WIDGETS = Path(os.environ.get("FSR_ALL_WIDGETS", HARNESS / "widgets-src"))
FRAMEWORK = Path(os.environ.get(
    "FSR_FRAMEWORK_REPO",
    Path.home() / "PycharmProjects" / "fsr-playbook-framework"))
CONN_PARENT = Path(os.environ.get(
    "FSR_CONNECTOR_REPO",
    Path.home() / "PycharmProjects" / "ConnectorsV2" / "conn_main"))
CONN = CONN_PARENT / "connector-fsr-soc-assistant"
LEGACY_CONN_CLONE = CONN_PARENT.parent / "fsr-playbook-builder"
ONBOARDING = HARNESS / "ONBOARDING.md"
MANIFEST = HARNESS / "widgets.manifest"
MONITOR = "socAssistantMonitor"
ASSISTANT = "fortiaiAgenticAssistant"


@dataclass
class Check:
    area: str
    name: str
    status: str  # HOLDS | DRIFT | INFO | UNVERIFIED
    detail: str
    sides: list[str] = field(default_factory=list)


RESULTS: list[Check] = []


def add(area: str, name: str, status: str, detail: str, sides=()):
    RESULTS.append(Check(area, name, status, detail, list(sides)))


def read_json(p: Path):
    return json.loads(p.read_text(encoding="utf-8"))


def vkey(v: str) -> tuple:
    return tuple(int(x) for x in re.findall(r"\d+", v or ""))


def git(repo: Path, *args: str) -> str:
    try:
        r = subprocess.run(["git", "-C", str(repo), *args], capture_output=True,
                           text=True, timeout=20)
        return r.stdout if r.returncode == 0 else ""
    except (OSError, subprocess.TimeoutExpired):
        return ""


def matrix_rows() -> list[dict]:
    lines = ONBOARDING.read_text(encoding="utf-8").splitlines()
    start = next((i for i, l in enumerate(lines)
                  if re.match(r"^\|\s*Widget\s*\|", l)), None)
    if start is None:
        return []
    rows = []
    for line in lines[start + 2:]:
        if not line.startswith("|"):
            break
        cells = [c.strip() for c in line.split("|")[1:-1]]
        m = re.search(r"`([^`]+)`", cells[0]) if cells else None
        if m and len(cells) >= 4:
            rows.append({"dir": m.group(1), "version": cells[1],
                         "connector": cells[2], "contract": cells[3]})
    return rows


def widget_info(dir_name: str) -> dict | None:
    for rel in ("widget/info.json", "info.json"):
        p = WIDGETS / dir_name / rel
        if p.is_file():
            return read_json(p)
    return None


# ----------------------------------------------------------------- checks

def check_matrix() -> None:
    conn_info = read_json(CONN / "info.json") if (CONN / "info.json").is_file() else None
    conn_ver = conn_info.get("version") if conn_info else None
    if not ONBOARDING.is_file():
        add("matrix", "ONBOARDING matrix present", "UNVERIFIED", "no ONBOARDING.md")
        return
    rows = matrix_rows()
    add("matrix", "compat rows parse", "HOLDS" if rows else "DRIFT",
        f"{len(rows)} rows parsed", ["ONBOARDING.md"])
    for r in rows:
        info = widget_info(r["dir"])
        if info is None:
            add("matrix", f"{r['dir']} version", "UNVERIFIED",
                "widget not cloned into widgets-src/", ["ONBOARDING.md", "widget info.json"])
        elif info.get("version") == r["version"]:
            add("matrix", f"{r['dir']} version", "HOLDS", r["version"],
                ["ONBOARDING.md", "widget info.json"])
        else:
            add("matrix", f"{r['dir']} version", "DRIFT",
                f"table {r['version']} vs info.json {info.get('version')}",
                ["ONBOARDING.md", "widget info.json"])
        cm = re.search(r"([0-9]+\.[0-9]+\.[0-9]+)", r["connector"])
        if cm and conn_ver:
            ok = cm.group(1) == conn_ver
            add("matrix", f"{r['dir']} connector column", "HOLDS" if ok else "DRIFT",
                f"table {cm.group(1)} vs connector info.json {conn_ver}"
                + ("" if ok else " (hand-stamped; no code reads this cell)"),
                ["ONBOARDING.md", "connector info.json"])
        elif not conn_ver:
            add("matrix", f"{r['dir']} connector column", "UNVERIFIED",
                "connector checkout not found", ["ONBOARDING.md"])

    ctrl = WIDGETS / ASSISTANT / "widget" / "view.controller.js"
    row = next((r for r in rows if r["dir"] == ASSISTANT), None)
    if ctrl.is_file() and row:
        m = re.search(r"WIDGET_CONTRACT_VERSION\s*=\s*['\"]([^'\"]+)['\"]",
                      ctrl.read_text(encoding="utf-8"))
        cv = m.group(1) if m else None
        ok = cv is not None and cv == row["contract"]
        add("matrix", "contract column vs WIDGET_CONTRACT_VERSION",
            "HOLDS" if ok else "DRIFT", f"table {row['contract']} vs controller {cv}",
            ["ONBOARDING.md", "view.controller.js"])
    else:
        add("matrix", "contract column vs WIDGET_CONTRACT_VERSION", "UNVERIFIED",
            "assistant widget not cloned", ["ONBOARDING.md"])

    prose = re.search(r"fsr-playbooks`?\)?\s*\(currently\s*`([0-9.]+)`",
                      ONBOARDING.read_text(encoding="utf-8"))
    pin = connector_pin()
    if prose and pin:
        ok = prose.group(1) == pin
        add("matrix", "ONBOARDING prose framework pin", "HOLDS" if ok else "DRIFT",
            f"prose says {prose.group(1)}, requirements.txt pins {pin}",
            ["ONBOARDING.md", "connector requirements.txt"])
    else:
        add("matrix", "ONBOARDING prose framework pin", "UNVERIFIED",
            "prose or requirements.txt not found")


def connector_pin() -> str | None:
    req = CONN / "requirements.txt"
    if not req.is_file():
        return None
    m = re.search(r"^fsr-playbooks==([0-9.]+)", req.read_text(encoding="utf-8"), re.M)
    return m.group(1) if m else None


def check_framework_pin() -> None:
    pin = connector_pin()
    if not pin:
        add("framework", "connector pin present", "UNVERIFIED", "no requirements.txt")
        return
    add("framework", "pin is an exact version", "HOLDS", f"fsr-playbooks=={pin}",
        ["connector requirements.txt"])
    if not git(FRAMEWORK, "rev-parse", "--git-dir"):
        add("framework", "pin has a framework tag", "UNVERIFIED", "framework checkout not found")
        return
    tags = [t[1:] for t in git(FRAMEWORK, "tag", "-l", "v*").split()]
    if f"v{pin}" in [f"v{t}" for t in tags]:
        add("framework", "pin has a framework tag", "HOLDS", f"v{pin} exists",
            ["connector requirements.txt", "framework git tags"])
    else:
        add("framework", "pin has a framework tag", "DRIFT", f"no tag v{pin}",
            ["connector requirements.txt", "framework git tags"])
    if tags:
        latest = max(tags, key=vkey)
        if vkey(latest) == vkey(pin):
            add("framework", "pin vs newest framework tag", "HOLDS", f"both {pin}")
        else:
            add("framework", "pin vs newest framework tag", "INFO",
                f"pin {pin} lags newest tag v{latest} (connector bump owed)",
                ["connector requirements.txt", "framework git tags"])


def check_connector_internal() -> None:
    if not (CONN / "info.json").is_file():
        add("connector", "info.json readable", "UNVERIFIED", "connector checkout not found")
        return
    info = read_json(CONN / "info.json")
    ver = info.get("version")
    notes = CONN / "release_notes.md"
    if notes.is_file():
        m = re.search(r"^## (\d+\.\d+\.\d+)", notes.read_text(encoding="utf-8"), re.M)
        ok = bool(m) and m.group(1) == ver
        add("connector", "release_notes.md top = info.json version",
            "HOLDS" if ok else "DRIFT", f"notes {m.group(1) if m else None} vs info {ver}",
            ["release_notes.md", "info.json"])
    wheels = sorted((CONN / "wheels").glob("fsr_playbooks-*.whl")) if (CONN / "wheels").is_dir() else []
    pin = connector_pin()
    if wheels and pin:
        wv = re.search(r"fsr_playbooks-([0-9.]+)-", wheels[0].name).group(1)
        add("connector", "bundled fsr_playbooks wheel = pin", "HOLDS" if wv == pin else "DRIFT",
            f"wheels/ {wv} vs pin {pin} (wheels/ is gitignored; a build product)",
            ["connector wheels/", "requirements.txt"])
    else:
        add("connector", "bundled fsr_playbooks wheel = pin", "UNVERIFIED",
            "no wheels/ built in this checkout")
    pyfsr_floor = re.search(r"^pyfsr>=([0-9.]+)", (CONN / "requirements.txt").read_text(), re.M)
    pyfsr_wheels = sorted((CONN / "wheels").glob("pyfsr-*.whl")) if (CONN / "wheels").is_dir() else []
    if pyfsr_floor and pyfsr_wheels:
        wv = re.search(r"pyfsr-([0-9.]+)-", pyfsr_wheels[0].name).group(1)
        ok = vkey(wv) >= vkey(pyfsr_floor.group(1))
        add("connector", "bundled pyfsr wheel satisfies floor", "HOLDS" if ok else "DRIFT",
            f"floor {pyfsr_floor.group(1)}, wheel {wv}", ["requirements.txt", "wheels/"])


def check_widget_connector_identity() -> None:
    svc = WIDGETS / ASSISTANT / "widget" / "widgetAssets" / "js" / "fsrPbAgent.service.js"
    if not CONN.is_dir() or not svc.is_file():
        add("identity", "widget CONNECTOR_NAME = connector name", "UNVERIFIED",
            "widget service or connector not found")
        return
    m = re.search(r"var CONNECTOR_NAME = '([^']+)'", svc.read_text(encoding="utf-8"))
    name = read_json(CONN / "info.json").get("name")
    add("identity", "widget CONNECTOR_NAME = connector name",
        "HOLDS" if m and m.group(1) == name else "DRIFT",
        f"widget {m.group(1) if m else None} vs info.json {name}",
        ["fsrPbAgent.service.js", "connector info.json"])

    mod = re.search(r"var TRIAGE_RECORD_MODULES = \[([^\]]*)\]", svc.read_text(encoding="utf-8"))
    src = (CONN / "fsr_soc_triage" / "triage_sources.py").read_text(encoding="utf-8")
    cm = re.search(r"TRIAGE_RECORD_MODULES[^=]*=\s*frozenset\(\{([^}]*)\}\)", src)
    if mod and cm:
        w = {s.strip().strip("'\"") for s in mod.group(1).split(",") if s.strip()}
        c = {s.strip().strip("'\"") for s in cm.group(1).split(",") if s.strip()}
        add("identity", "triage record modules (widget copy = connector)",
            "HOLDS" if w == c else "DRIFT", f"widget {sorted(w)} vs connector {sorted(c)}",
            ["fsrPbAgent.service.js", "triage_sources.py"])
    else:
        add("identity", "triage record modules (widget copy = connector)", "UNVERIFIED",
            "could not parse one side")


def check_vocab_copies() -> None:
    conn_copy = CONN / "fsr_soc_triage" / "verdict_vocabulary.json"
    harness_copy = HARNESS / "fortisoar-widget-harness" / "tests" / "live" / "lib" / "verdict-vocabulary.json"
    snap = CONN / "fsr_soc_triage" / "tests" / "fixtures" / "verdict-vocabulary.canonical.json"
    if conn_copy.is_file() and harness_copy.is_file():
        same = read_json(conn_copy) == read_json(harness_copy)
        add("copies", "verdict vocabulary: connector copy = harness copy",
            "HOLDS" if same else "DRIFT", "parsed JSON compared",
            ["connector verdict_vocabulary.json", "harness tests/live/lib"])
    else:
        add("copies", "verdict vocabulary: connector copy = harness copy", "UNVERIFIED",
            "one side missing")
    if conn_copy.is_file() and snap.is_file():
        same = read_json(conn_copy) == read_json(snap)
        add("copies", "verdict vocabulary: connector copy = committed snapshot",
            "HOLDS" if same else "DRIFT", "parsed JSON compared",
            ["connector verdict_vocabulary.json", "canonical snapshot"])
    else:
        add("copies", "verdict vocabulary: connector copy = committed snapshot",
            "UNVERIFIED", "snapshot or copy missing")

    fw_leak = FRAMEWORK / "scripts" / "check_infra_leaks.py"
    cn_leak = CONN_PARENT / "scripts" / "check_infra_leaks.py"
    if fw_leak.is_file() and cn_leak.is_file():
        def digest(p):
            return hashlib.sha256(p.read_bytes()).hexdigest()[:12]
        same = digest(fw_leak) == digest(cn_leak)
        add("copies", "check_infra_leaks.py: framework copy = connector copy",
            "HOLDS" if same else "DRIFT",
            "identical" if same else "two independently edited copies",
            ["framework scripts/", "conn_main scripts/"])
    else:
        add("copies", "check_infra_leaks.py: framework copy = connector copy",
            "UNVERIFIED", "one checkout missing")


def check_contract_fixtures() -> None:
    ctrl = WIDGETS / ASSISTANT / "widget" / "view.controller.js"
    fixdir = WIDGETS / ASSISTANT / "widget" / "widgetAssets" / "fixtures"
    if not ctrl.is_file() or not fixdir.is_dir():
        add("contract", "fixture contract_version = controller", "UNVERIFIED",
            "assistant widget not cloned")
        return
    m = re.search(r"WIDGET_CONTRACT_VERSION\s*=\s*['\"]([^'\"]+)['\"]",
                  ctrl.read_text(encoding="utf-8"))
    cv = m.group(1) if m else None
    stale, intentional = [], []
    for f in sorted(fixdir.glob("*.json")):
        found = set(re.findall(r'"contract_version"\s*:\s*"([^"]+)"', f.read_text(encoding="utf-8")))
        for v in found:
            if v != cv:
                (intentional if "drift" in f.name else stale).append(f"{f.name}={v}")
    add("contract", "fixture contract_version = controller",
        "HOLDS" if not stale else "DRIFT",
        f"{len(stale)} stale fixture stamps (controller {cv}); "
        f"{len(intentional)} intentional (contract_drift)",
        ["widgetAssets/fixtures", "view.controller.js"])


def check_manifest() -> None:
    if not MANIFEST.is_file():
        add("manifest", "widgets.manifest present", "UNVERIFIED", "missing")
        return
    names = []
    for line in MANIFEST.read_text(encoding="utf-8").splitlines():
        s = line.strip()
        if s and not s.startswith("#"):
            names.append(s.split()[0])
    missing = [n for n in names if not (WIDGETS / n).exists()]
    add("manifest", "manifest names have a widgets-src folder",
        "HOLDS" if not missing else "DRIFT",
        f"{len(names) - len(missing)}/{len(names)} present"
        + (f"; missing: {', '.join(missing)}" if missing else ""),
        ["widgets.manifest", "widgets-src/"])
    own_repos = [p.name for p in WIDGETS.iterdir() if (p / ".git").exists()] if WIDGETS.is_dir() else []
    unlisted = sorted(set(own_repos) - set(names))
    add("manifest", "widget git repos are all in the manifest",
        "HOLDS" if not unlisted else "DRIFT",
        f"{len(own_repos) - len(unlisted)}/{len(own_repos)} listed"
        + (f"; not listed: {', '.join(unlisted)}" if unlisted else ""),
        ["widgets.manifest", "widgets-src/*/.git"])


def check_legacy_paths() -> None:
    refs = []
    if FRAMEWORK.is_dir():
        for p in (FRAMEWORK / "fsr_playbooks").rglob("*.py"):
            if "fsr-playbook-builder" in p.read_text(encoding="utf-8", errors="ignore"):
                refs.append(str(p.relative_to(FRAMEWORK)))
        for p in (FRAMEWORK / "tooling").rglob("*.py"):
            if "fsr-playbook-builder" in p.read_text(encoding="utf-8", errors="ignore"):
                refs.append(str(p.relative_to(FRAMEWORK)))
    legacy = LEGACY_CONN_CLONE.is_dir()
    if refs:
        add("paths", "framework code names the pre-rename connector dir",
            "DRIFT" if legacy else "INFO",
            f"{len(refs)} files reference fsr-playbook-builder"
            + (" and a legacy clone still exists" if legacy else ""),
            refs[:3] + ["ConnectorsV2/fsr-playbook-builder"])
    else:
        add("paths", "framework code names the pre-rename connector dir", "HOLDS",
            "no references")


def check_import_surface() -> None:
    """Every name the connector imports from fsr_playbooks must exist in the framework."""
    if not (FRAMEWORK / "fsr_playbooks").is_dir() or not CONN.is_dir():
        add("surface", "connector imports resolve in the framework", "UNVERIFIED",
            "framework or connector checkout missing")
        return
    pkg = FRAMEWORK / "fsr_playbooks"
    imports: set[tuple[str, str]] = set()
    for p in CONN.rglob("*.py"):
        if any(part in {"__pycache__", "wheels", ".venv"} for part in p.parts):
            continue
        try:
            tree = ast.parse(p.read_text(encoding="utf-8", errors="ignore"))
        except SyntaxError:
            continue
        for node in ast.walk(tree):
            if isinstance(node, ast.ImportFrom) and node.module and node.module.split(".")[0] == "fsr_playbooks":
                for a in node.names:
                    imports.add((node.module, a.name))
    unresolved = []
    cache: dict[str, set[str] | None] = {}
    for mod, name in sorted(imports):
        if mod not in cache:
            rel = Path(*mod.split("."))
            f = FRAMEWORK / rel.with_suffix(".py")
            if not f.is_file():
                f = FRAMEWORK / rel / "__init__.py"
            cache[mod] = top_level_names(f) if f.is_file() else None
        names = cache[mod]
        if names is None:
            unresolved.append(f"{mod} (no module)")
        elif name != "*" and name not in names:
            # submodule import like `from fsr_playbooks.x import y` where y is a module
            sub = FRAMEWORK / Path(*mod.split(".")) / (name + ".py")
            if not sub.is_file() and not (FRAMEWORK / Path(*mod.split(".")) / name).is_dir():
                unresolved.append(f"{mod}.{name}")
    status = "HOLDS" if not unresolved else "DRIFT"
    add("surface", "connector imports resolve in the framework", status,
        f"{len(imports)} distinct imports; {len(unresolved)} unresolved"
        + (f": {', '.join(unresolved[:5])}" if unresolved else ""),
        ["connector *.py", "framework fsr_playbooks/"])


def top_level_names(path: Path) -> set[str]:
    try:
        tree = ast.parse(path.read_text(encoding="utf-8", errors="ignore"))
    except SyntaxError:
        return set()
    out: set[str] = set()
    for node in tree.body:
        if isinstance(node, (ast.FunctionDef, ast.AsyncFunctionDef, ast.ClassDef)):
            out.add(node.name)
        elif isinstance(node, ast.Assign):
            for t in node.targets:
                for n in ast.walk(t):
                    if isinstance(n, ast.Name):
                        out.add(n.id)
        elif isinstance(node, ast.AnnAssign) and isinstance(node.target, ast.Name):
            out.add(node.target.id)
        elif isinstance(node, (ast.Import, ast.ImportFrom)):
            for a in node.names:
                out.add((a.asname or a.name).split(".")[0])
        elif isinstance(node, ast.Try):
            for sub in ast.walk(node):
                if isinstance(sub, (ast.FunctionDef, ast.ClassDef)):
                    out.add(sub.name)
                elif isinstance(sub, ast.Name) and isinstance(sub.ctx, ast.Store):
                    out.add(sub.id)
    return out


def check_test_guards() -> None:
    """Parity tests that skip (not fail) when their checkout env var is unset."""
    t = CONN / "fsr_soc_triage" / "tests" / "test_triage_module_parity.py"
    if t.is_file():
        skip = "pytest.skip" in t.read_text(encoding="utf-8")
        env = bool(os.environ.get("FSR_ALL_WIDGETS") or os.environ.get("FSR_WIDGET_HARNESS"))
        add("guards", "triage parity test runs (not skipped)",
            "HOLDS" if env else "INFO",
            "env pointer set" if env else
            "skips when FSR_ALL_WIDGETS / FSR_WIDGET_HARNESS unset (this script compares directly)"
            if skip else "no skip path",
            ["test_triage_module_parity.py"])


def main(argv=None) -> int:
    ap = argparse.ArgumentParser(description=__doc__.split("\n\n")[0])
    ap.add_argument("--report", action="store_true", help="always exit 0")
    ap.add_argument("--json", action="store_true", help="emit JSON")
    args = ap.parse_args(argv)

    for fn in (check_matrix, check_framework_pin, check_connector_internal,
               check_widget_connector_identity, check_vocab_copies,
               check_contract_fixtures, check_manifest, check_legacy_paths,
               check_import_surface, check_test_guards):
        fn()

    counts: dict[str, int] = {}
    for r in RESULTS:
        counts[r.status] = counts.get(r.status, 0) + 1
    if args.json:
        print(json.dumps({"counts": counts, "checks": [r.__dict__ for r in RESULTS]}, indent=2))
    else:
        width = max(len(r.name) for r in RESULTS)
        for r in RESULTS:
            print(f"[{r.status:10s}] {r.area:9s} {r.name:<{width}}  {r.detail}")
        print()
        print("  ".join(f"{k}={v}" for k, v in sorted(counts.items())))
    drift = counts.get("DRIFT", 0)
    return 0 if (args.report or drift == 0) else 1


if __name__ == "__main__":
    sys.exit(main())
