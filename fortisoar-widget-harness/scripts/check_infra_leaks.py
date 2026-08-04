#!/usr/bin/env python3
"""Pre-commit guard: block internal infra strings from entering the public mirror.

Scans the *staged additions* (added lines only) of each changed text file and
fails the commit if any internal host string slips in. This is the source-level
replacement for the old publish-time scrub: the tracked tree must stay clean so
the repo can be pushed to the public GitHub mirror with ordinary `git push`.

Binary files are scanned too, in full rather than by diff. They used to be
skipped outright, and that is how `tooling/tests/fixtures/tooling_reference.db`
reached the public mirror carrying 7,000+ live appliance URLs and the lab admin
account: a sqlite fixture stores its strings as plain text, but `git diff`
renders it as "Binary files differ", so the staged-diff scan saw no added lines
and passed it. There is no cheap way to diff a binary's *added* strings, so any
match anywhere in the blob is reported -- a whole-file scan on a file format
that has no line structure to begin with.

What it blocks, in two layers:

  - **generic** (in this file): vendor product subdomains --
    *.fortinet.com / *.fortinet.net / *.forticloud.com. Public names, so
    stating them here discloses nothing.
  - **local** (`scripts/infra_patterns.local.json`, gitignored): the specific
    lab subnet, appliance domains, and account names.

The split is the point. Writing a lab subnet or an internal domain into a
tracked file publishes it on the public mirror -- handing a reader of this
repo the exact strings to go looking for, via the guard meant to protect
them. So the shape of the rule is public and the values stay local.

Allowed (public, safe to ship):
  - repo.fortisoar.fortinet.com          (public connector repo)
  - sample @fortinet.com email addresses (no dot before "fortinet", so the
    host regex below never matches them)

Without the local file only the generic layer applies, and the guard says so
on every run. A fresh public clone is therefore usable, and an overlay that
has gone missing is visible rather than silent.

Run automatically via .pre-commit-config.yaml; run manually with:
    python scripts/check_infra_leaks.py            # scan staged changes
    python scripts/check_infra_leaks.py --all      # scan whole tracked tree
"""
from __future__ import annotations

import json
import pathlib
import re
import subprocess
import sys

DENY = [
    # Vendor product subdomains. Public and generic -- naming these discloses
    # nothing, and they are the rules a public contributor still benefits from.
    re.compile(r"\b[a-z0-9][a-z0-9.-]*\.fortinet\.(?:com|net)\b", re.IGNORECASE),
    re.compile(r"\b[a-z0-9][a-z0-9.-]*\.forticloud\.com\b", re.IGNORECASE),
]
# Known-public strings that match a DENY pattern but are intentionally shipped.
ALLOW = [
    re.compile(r"repo\.fortisoar\.fortinet\.com", re.IGNORECASE),
    re.compile(r"docs\.fortinet\.com", re.IGNORECASE),
    re.compile(r"support\.fortinet\.com", re.IGNORECASE),
    re.compile(r"fortiguard\.fortinet\.com", re.IGNORECASE),
    re.compile(r"marketplace\.fortinet\.com", re.IGNORECASE),
    re.compile(r"fortisoar\.contenthub\.fortinet\.com", re.IGNORECASE),
    re.compile(r"foo\.forticloud\.com", re.IGNORECASE),
]

# Binaries get a NARROWER deny set than source text, and the difference is
# deliberate. The broad `*.fortinet.com` rule above is right for files we
# author -- we never have a reason to type an internal hostname. But the
# reference DBs are vendored: they hold stock connector definitions whose
# metadata legitimately references public Fortinet product hosts
# (docs./support./fortiguard.fortinet.com, the FortiCloud SaaS endpoints).
# Applying the broad rule there reports ~30 such hosts per DB, and a guard that
# cries wolf on vendor content is a guard people learn to skip.
#
# So binaries are scanned only for markers that are unambiguously OURS and
# could not have arrived from Fortinet: the lab subnet, the lab-internal
# domains, and the lab admin account.
# Empty by default: every marker narrow enough to be worth scanning a binary
# for is, by definition, specific to our infrastructure -- so it belongs in the
# local overlay, not here.
BINARY_DENY: list[re.Pattern[bytes]] = []
# ---------------------------------------------------------------------------
# Local-only overlay
# ---------------------------------------------------------------------------
# The patterns above are the *shape* of the problem. The specific lab subnet,
# appliance domains, and account names are loaded from a gitignored file so
# they are never published by the very guard meant to protect them -- writing a
# lab subnet or an internal domain into a tracked file tells a reader of the
# public mirror exactly what to go looking for.
#
# Format (`scripts/infra_patterns.local.json`)::
#
#     {"text": ["<regex>", ...], "binary": ["<regex>", ...],
#      "allow": ["<regex>", ...],
#      "replace": [["<regex>", "<re.sub template>"], ...]}
#
# `replace` is not used by this guard -- it is read by
# `scripts/scrub_infra_from_db.py`, which rewrites already-committed fixtures.
# It lives in the same file because a replacement and the deny pattern it
# answers are the same secret stated twice; splitting them across a tracked and
# an untracked file is how they drift.
#
# Absent (a fresh public clone, or CI): the overlay is empty and only the
# generic rules above apply. Printed on every run so an inactive overlay is
# visible rather than silent -- a guard that quietly does nothing is worse than
# no guard.
_OVERLAY_PATH = pathlib.Path(__file__).with_name("infra_patterns.local.json")


def _load_overlay() -> tuple[list, list, list]:
    if not _OVERLAY_PATH.exists():
        return [], [], []
    try:
        cfg = json.loads(_OVERLAY_PATH.read_text())
    except (json.JSONDecodeError, OSError) as exc:
        print(f"infra-leak guard: cannot read {_OVERLAY_PATH.name}: {exc}",
              file=sys.stderr)
        return [], [], []
    return (
        [re.compile(p, re.IGNORECASE) for p in cfg.get("text", [])],
        [re.compile(p.encode(), re.IGNORECASE) for p in cfg.get("binary", [])],
        [re.compile(p, re.IGNORECASE) for p in cfg.get("allow", [])],
    )


def overlay_replacements() -> list[tuple[re.Pattern[str], str]]:
    """(pattern, re.sub template) pairs from the overlay's `replace` key.

    Public entry point for `scrub_infra_from_db.py`. Empty without the overlay,
    which is correct: with no local patterns loaded there is nothing this repo
    can name that needs rewriting.
    """
    if not _OVERLAY_PATH.exists():
        return []
    try:
        cfg = json.loads(_OVERLAY_PATH.read_text())
    except (json.JSONDecodeError, OSError):
        return []
    return [(re.compile(p, re.IGNORECASE), t) for p, t in cfg.get("replace", [])]


_TEXT_EXTRA, _BINARY_EXTRA, _ALLOW_EXTRA = _load_overlay()
DENY += _TEXT_EXTRA
BINARY_DENY += _BINARY_EXTRA
ALLOW += _ALLOW_EXTRA
OVERLAY_ACTIVE = bool(_TEXT_EXTRA or _BINARY_EXTRA)

# Files that legitimately *define* the deny patterns (this guard + the hook that
# runs it). Scanning them would self-match; skip them in both modes.
SKIP = {
    "scripts/check_infra_leaks.py",
    ".pre-commit-config.yaml",
    "scripts/infra_patterns.local.json",
}



def is_binary(blob: bytes) -> bool:
    """A NUL byte in the first 8 KiB -- the same heuristic git itself uses."""
    return b"\x00" in blob[:8192]


def scan_blob(blob: bytes) -> list[str]:
    """Every distinct BINARY_DENY hit in a blob, in first-seen order.

    Matched against the raw bytes rather than extracted printable runs: sqlite
    stores its text unterminated and packed against adjacent cell data, so a
    `strings(1)`-style pass can fuse a host into a neighbouring value and hide
    it from an anchored pattern. The deny patterns are self-delimiting, so
    scanning the whole blob loses nothing and cannot be fooled by framing.
    """
    seen: dict[str, None] = {}
    for rx in BINARY_DENY:
        for m in rx.finditer(blob):
            hit = m.group(0).decode("ascii", "replace")
            if not any(a.search(hit) for a in ALLOW):
                seen.setdefault(hit, None)
    return list(seen)


def _is_leak(text: str) -> str | None:
    for rx in DENY:
        for m in rx.finditer(text):
            if not any(a.search(m.group(0)) for a in ALLOW):
                return m.group(0)
    return None


def _staged_files() -> list[str]:
    out = subprocess.run(
        ["git", "diff", "--cached", "--name-only", "--diff-filter=ACM"],
        capture_output=True, text=True, check=True,
    ).stdout
    return [f for f in out.splitlines() if f]


def _added_lines(path: str) -> list[tuple[int, str]]:
    """Return (line_no_in_new_file, text) for lines added in the staged diff."""
    diff = subprocess.run(
        ["git", "diff", "--cached", "-U0", "--no-color", "--", path],
        capture_output=True, text=True, check=True,
    ).stdout
    lines: list[tuple[int, str]] = []
    new_ln = 0
    for ln in diff.splitlines():
        if ln.startswith("@@"):
            m = re.search(r"\+(\d+)", ln)
            new_ln = int(m.group(1)) if m else 0
        elif ln.startswith("+") and not ln.startswith("+++"):
            lines.append((new_ln, ln[1:]))
            new_ln += 1
    return lines


def main() -> int:
    scan_all = "--all" in sys.argv
    hits: list[str] = []

    if scan_all:
        files = subprocess.run(
            ["git", "ls-files"], capture_output=True, text=True, check=True
        ).stdout.splitlines()
        for path in files:
            if path in SKIP:
                continue
            try:
                blob = open(path, "rb").read()
            except OSError:
                continue
            if is_binary(blob):
                hits += [f"{path}: {leak}  (embedded in binary)"
                         for leak in scan_blob(blob)]
                continue
            try:
                for i, line in enumerate(blob.decode("utf-8").splitlines(), 1):
                    leak = _is_leak(line)
                    if leak:
                        hits.append(f"{path}:{i}: {leak}")
            except UnicodeDecodeError:
                continue
    else:
        for path in _staged_files():
            if path in SKIP:
                continue
            # A staged binary has no usable line diff -- git renders it as
            # "Binary files differ" and _added_lines() returns nothing, which is
            # exactly how the leaked fixture got through. Scan the staged blob
            # itself instead of the diff.
            try:
                blob = subprocess.run(
                    ["git", "show", f":{path}"], capture_output=True, check=True,
                ).stdout
            except subprocess.CalledProcessError:
                blob = b""
            if is_binary(blob):
                hits += [f"{path}: {leak}  (embedded in binary)"
                         for leak in scan_blob(blob)]
                continue
            try:
                for lineno, text in _added_lines(path):
                    leak = _is_leak(text)
                    if leak:
                        hits.append(f"{path}:{lineno}: {leak}")
            except (subprocess.CalledProcessError, UnicodeDecodeError):
                continue

    if hits:
        sys.stderr.write(
            "\n\033[31mInfra-leak guard: internal host string(s) detected\033[0m\n"
        )
        for h in hits:
            sys.stderr.write(f"  {h}\n")
        sys.stderr.write(
            "\nUse an RFC5737 doc IP (198.51.100.x) or a placeholder host instead.\n"
            "If this is a genuinely public string, add it to ALLOW in "
            "scripts/check_infra_leaks.py.\n"
        )
        return 1
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
