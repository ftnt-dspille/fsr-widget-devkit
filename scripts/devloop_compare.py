#!/usr/bin/env python3
"""Compare one `make bench` run with the 11-22 baseline.

  devloop_compare.py --ledger FILE --since <iso ts> [--baseline FILE]

Phases come from the lap ledger rows at or after --since: `bench setup`, `bench code`,
`bench check`, `bench commit`, `bench ship` (the whole `make ship`), and the `promote`
and `promote ci-wait` laps the ship wrote. push+stamp is the ship minus promote and the
CI wait (CI's time is not ours). Prints a table, and exits 0 always: it reports.
"""
import argparse
import os
import sys

HERE = os.path.dirname(os.path.abspath(__file__))


def load_baseline(path):
    out = {}
    for line in open(path):
        if line.startswith("#") or not line.strip():
            continue
        k, v = line.rstrip("\n").split("\t")
        out[k] = int(v)
    return out


def load_run(ledger, since):
    got = {}
    for line in open(ledger):
        p = line.rstrip("\n").split("\t")
        if len(p) < 5 or not p[2].isdigit() or p[0] < since:
            continue
        got[p[1]] = got.get(p[1], 0) + int(p[2])
    return got


def phases(run):
    ship = run.get("bench ship", 0)
    promote = run.get("promote", 0)
    ciwait = run.get("promote ci-wait", 0)
    return {
        "setup": run.get("bench setup"),
        "code + check": (run.get("bench code", 0) + run.get("bench check", 0)) if "bench check" in run else None,
        "commit": run.get("bench commit"),
        "push+stamp": max(ship - promote - ciwait, 0) if "bench ship" in run else None,
        "promote": promote if "bench ship" in run else None,
    }, ciwait


def main(argv=None):
    ap = argparse.ArgumentParser()
    ap.add_argument("--ledger", required=True)
    ap.add_argument("--since", required=True)
    ap.add_argument("--baseline", default=os.path.join(HERE, "devloop_baseline.tsv"))
    a = ap.parse_args(argv)
    base = load_baseline(a.baseline)
    now, ciwait = phases(load_run(a.ledger, a.since))
    ref = {"setup": base.get("setup"), "code + check": base.get("code+test", 0) + base.get("full suite", 0),
           "commit": base.get("commit"), "push+stamp": base.get("push+stamp"), "promote": base.get("promote")}
    print("%-14s %9s %9s %9s" % ("phase", "baseline", "now", "change"))
    tb = tn = 0
    for k, b in ref.items():
        n = now.get(k)
        tb += b or 0
        if n is None:
            print("%-14s %8ss %9s %9s" % (k, b, "not run", ""))
            continue
        tn += n
        print("%-14s %8ss %8ss %+8ss" % (k, b, n, n - b))
    print("%-14s %8ss %8ss %+8ss   (orient, %ss in the baseline, is not measured)" % ("total", tb, tn, tn - tb, base.get("orient", 0)))
    if ciwait:
        print("CI wait %ds is not in the table (a GitHub run, not the loop)." % ciwait)
    print("compared with the 2026-11-22 timed task: %s" % ("FASTER" if tn < tb else "NOT FASTER"))
    return 0


if __name__ == "__main__":
    sys.exit(main())
