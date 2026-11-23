#!/usr/bin/env python3
"""Drift warnings for `make doctor`. Warn only, never fail.

1. Lap drift: a ledger step whose recent median is over its budget
   (scripts/laps_summary.py --drift).
2. Doc drift: the agent docs (root and connector CLAUDE.md and TESTING.md, the
   skills under .claude/skills) name a make target, a script path or a make
   variable that no longer exists in this checkout, the connector or the framework.

  drift_check.py [--root DIR] [--connector DIR] [--framework DIR] [--ledger FILE]

3. CI state: the latest main CI of each repo in the solution pack (root, connector, framework,
   the two widgets), via `scripts/door.sh ci all`; a red main is flagged loudly with the failing job
   names. Skipped when this root has no scripts/door.sh.

A line a reader meant as a retired or example name can carry `(retired)` or
`(example)` after the token; it is skipped.
"""
import argparse
import glob
import os
import re
import subprocess
import sys

HERE = os.path.dirname(os.path.abspath(__file__))
SKIP_MARK = re.compile(r"\((retired|example|removed|gone)\)")
RULE = re.compile(r"^([A-Za-z0-9_.%\- ]+?)\s*:(?![=:])")
MAKE_CMD = re.compile(r"`([^`]*\bmake\b[^`]*)`")
PATH_TOK = re.compile(r"(?<![\w/.<>$-])((?:scripts|fortisoar-widget-harness|\.github|\.claude)/[\w./-]*[\w])")
TICK = re.compile(r"`([^`\n]+)`")
ENV_ASSIGN = re.compile(r"(?<![\w$])([A-Z][A-Z0-9_]{3,})=")
SYSTEM_ENV = {"PYTHONPATH", "CLAUDECODE", "HOME", "TMPDIR", "PATH"}   # not ours to define
PROSE = {"targets", "and", "or", "the", "a", "an", "it", "sure", "to", "in", "is"}   # `make targets` in a sentence


def make_targets(*makefiles):
    out = set()
    for mf in makefiles:
        try:
            lines = open(mf, errors="replace").read().splitlines()
        except OSError:
            continue
        for line in lines:
            if line.startswith(("\t", "#", " ")) or "=" in line.split(":")[0]:
                continue
            m = RULE.match(line)
            if not m:
                continue
            for t in m.group(1).split():
                if re.fullmatch(r"[A-Za-z0-9][A-Za-z0-9_.-]*", t):
                    out.add(t)
            if line.startswith(".PHONY"):
                out.update(line.split(":", 1)[1].split())
    return out


PRUNE = {"node_modules", ".git", ".venv", ".venv-localdev", "fsr_src", "test-results", "dist", "__pycache__", "widgets-src", "docs"}


def read_text(*paths):
    chunks = []
    for p in paths:
        if os.path.isfile(p):
            files = [p]
        else:
            files = []
            for dp, dns, fns in os.walk(p):
                dns[:] = [d for d in dns if d not in PRUNE]
                files += [os.path.join(dp, f) for f in fns]
        for f in files:
            if f.endswith((".png", ".jpg", ".pdf", ".tgz", ".gz", ".pyc", ".map", ".lock")):
                continue
            try:
                if os.path.getsize(f) < 2_000_000:
                    chunks.append(open(f, errors="replace").read())
            except OSError:
                pass
    return "\n".join(chunks)


def doc_files(root, conn):
    files = [os.path.join(root, "CLAUDE.md"), os.path.join(root, "TESTING.md")]
    files += sorted(glob.glob(os.path.join(root, ".claude", "skills", "*", "SKILL.md")))
    if conn:
        files += [os.path.join(conn, "CLAUDE.md"), os.path.join(conn, "TESTING.md")]
    return [f for f in files if os.path.isfile(f)]


def doc_drift(root, conn, fw):
    targets = make_targets(os.path.join(root, "Makefile"), *( [os.path.join(conn, "Makefile")] if conn else [] ),
                           *( [os.path.join(fw, "Makefile")] if fw else [] ))
    bases = [b for b in (root, os.path.join(root, "fortisoar-widget-harness"), conn, fw) if b]
    haystack = read_text(*[os.path.join(b, d) for b in (root, conn, fw) if b
                           for d in ("Makefile", "scripts", "fortisoar-widget-harness", "connector-fsr-agentic-assistant", "fsr_playbooks")])
    warns = []
    for doc in doc_files(root, conn):
        rel = os.path.relpath(doc, root) if doc.startswith(root) else doc
        for no, line in enumerate(open(doc, errors="replace").read().splitlines(), 1):
            if SKIP_MARK.search(line):
                continue
            for cmd in MAKE_CMD.findall(line):
                words = cmd.split()
                for i, w in enumerate(words):
                    if w == "make" and i + 1 < len(words):
                        j = i + 1
                        while j < len(words) and words[j].startswith("-"):
                            j += 1
                        t = words[j] if j < len(words) else ""
                        if re.fullmatch(r"[a-z][a-z0-9_-]*", t) and t not in targets and t not in PROSE:
                            warns.append(f"{rel}:{no}: make target '{t}' is not defined in any Makefile")
            for span in TICK.findall(line):   # `VAR=value` anywhere in a code span: some script or Makefile must read VAR
                for v in ENV_ASSIGN.findall(span):
                    if v not in SYSTEM_ENV and not re.search(r"\b%s\b" % re.escape(v), haystack):
                        warns.append(f"{rel}:{no}: variable {v} is read by nothing")
            for tok in PATH_TOK.findall(line):
                tok = tok.rstrip(".,:;)")
                if any(c in tok for c in "*<>{}$") or tok.endswith("/"):
                    continue
                if not any(os.path.exists(os.path.join(b, tok)) for b in bases):
                    warns.append(f"{rel}:{no}: path '{tok}' does not exist")
    seen, out = set(), []
    for w in warns:
        if w not in seen:
            seen.add(w)
            out.append(w)
    return out


def lap_drift(ledger):
    if not os.path.isfile(ledger) or not os.path.getsize(ledger):
        return []
    tail = subprocess.run(["tail", "-n", "200", ledger], capture_output=True, text=True).stdout
    r = subprocess.run([sys.executable, os.path.join(HERE, "laps_summary.py"), "--drift"], input=tail, capture_output=True, text=True)
    return [l for l in r.stdout.splitlines() if l.strip()]


def main(argv=None):
    ap = argparse.ArgumentParser()
    ap.add_argument("--root", default=os.path.dirname(HERE))
    ap.add_argument("--connector", default=None)
    ap.add_argument("--framework", default=None)
    ap.add_argument("--ledger", default=os.environ.get("FSR_LAP_LEDGER", os.path.expanduser("~/.cache/fsr-laps.tsv")))
    a = ap.parse_args(argv)
    warns = lap_drift(a.ledger) + ["WARN doc drift: " + w for w in doc_drift(a.root, a.connector, a.framework)]
    for w in warns:
        print(w)
    ci = os.path.join(a.root, "scripts", "door.sh")
    if os.path.exists(ci):
        r = subprocess.run(["bash", ci, "ci", "all"], capture_output=True, text=True, env={**os.environ, "FSR_TOOL_HOME": a.root})
        print(r.stdout.rstrip())
        if r.returncode == 1:
            print("WARN CI RED ON MAIN: see the !!! line(s) above; make ship refuses those repos unless the branch is green on the failing checks")
    if not warns:
        print("drift: no lap step over budget, no doc names a missing target, path or variable")
    return 0


if __name__ == "__main__":
    sys.exit(main())
