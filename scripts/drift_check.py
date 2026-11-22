#!/usr/bin/env python3
"""Drift warnings for `make doctor`. Warn only, never fail.

1. Lap drift: a ledger step whose recent median is over its budget
   (scripts/laps_summary.py --drift).
2. Doc drift: the agent docs (root and connector CLAUDE.md and TESTING.md, the
   skills under .claude/skills) name a make target, a script path or a make
   variable that no longer exists in this checkout, the connector or the framework.

  drift_check.py [--root DIR] [--connector DIR] [--framework DIR] [--ledger FILE]

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


def read_text(*paths):
    chunks = []
    for p in paths:
        for f in (glob.glob(os.path.join(p, "**", "*"), recursive=True) if os.path.isdir(p) else [p]):
            if os.path.isfile(f) and not f.endswith((".png", ".jpg", ".pdf", ".tgz", ".gz", ".pyc")) \
                    and "node_modules" not in f and "/.git/" not in f and "/.venv" not in f:
                try:
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
    haystack = read_text(*[os.path.join(b, d) for b in bases for d in ("Makefile", "scripts", "fortisoar-widget-harness/scripts",
                                                                       "fortisoar-widget-harness/lib")] )
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
                        for v in words[j + 1:]:
                            m = re.fullmatch(r"([A-Z][A-Z0-9_]{2,})=.*", v.strip("`,;"))
                            if m and not re.search(r"\b%s\b" % re.escape(m.group(1)), haystack):
                                warns.append(f"{rel}:{no}: make variable {m.group(1)} is read by nothing")
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
    if not warns:
        print("drift: no lap step over budget, no doc names a missing target, path or variable")
    return 0


if __name__ == "__main__":
    sys.exit(main())
