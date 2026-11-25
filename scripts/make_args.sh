#!/usr/bin/env bash
# Refuse a make command-line variable nothing reads: make silently ignores a
# misspelt name, so `make promote BRNCH=x` behaved like a missing BRANCH with no
# hint why. Called once from the Makefile with $(MAKEOVERRIDES); prints the
# error (and exits 1) for any NAME=value whose NAME is not read by the
# Makefile, the scripts it runs, or the harness scripts.
#   known = every $(NAME) / ${NAME} / $NAME / process.env.NAME in Makefile,
#           scripts/*, fortisoar-widget-harness/{scripts,lib}/, plus
#           MAKE_ARGS_EXTRA (space-separated) for names read elsewhere.
#   plus the retired box knobs (RETIRED below): the Makefile hands them to box.sh,
#   which warns a human or refuses an agent, so make must not reject them first.
# MAKE_ARGS_OFF=1 skips the check.
set -uo pipefail
[[ "${MAKE_ARGS_OFF:-}" == 1 ]] && exit 0
root="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
RETIRED="ENV FSR_ENV SHIP_ENV SWEEP_ENV MATRIX_ENV LIVE_ENV SSH_HOST"   # keep in step with _DEP_KNOBS in the Makefile
names=()
for a in "$@"; do
    [[ "$a" == *=* ]] || continue
    n="${a%%=*}"; n="${n%:}"; n="${n%+}"
    [[ "$n" =~ ^[A-Za-z_][A-Za-z0-9_]*$ ]] && names+=("$n")
done
(( ${#names[@]} )) || exit 0
known="$( { cat "$root/Makefile"; cat "$root"/scripts/* 2>/dev/null
            find "$root/fortisoar-widget-harness/scripts" "$root/fortisoar-widget-harness/lib" \
                 -maxdepth 3 -type f \( -name '*.js' -o -name '*.ts' -o -name '*.sh' -o -name '*.py' \) \
                 -not -path '*/node_modules/*' -exec cat {} + 2>/dev/null
          } | grep -aoE '\$[({]?[A-Z_][A-Z0-9_]*|process\.env\.[A-Z_][A-Z0-9_]*|environ(\.get)?\(?\[?"[A-Z_][A-Z0-9_]*' \
            | grep -oE '[A-Z_][A-Z0-9_]*$' | sort -u)
${MAKE_ARGS_EXTRA:-}
$(tr " " "\n" <<< "$RETIRED")"
bad=0
for n in "${names[@]}"; do
    grep -qxF "$n" <<< "$known" && continue
    hint="$(KNOWN="$known" python3 -c '
import difflib, os, sys
m = difflib.get_close_matches(sys.argv[1], os.environ["KNOWN"].split(), n=1, cutoff=0.7)
print(m[0] if m else "")' "$n" 2>/dev/null)"
    echo "make: unknown variable $n${hint:+ (did you mean $hint?)}. Nothing reads it, so it would be ignored. MAKE_ARGS_OFF=1 skips this check." >&2
    bad=1
done
exit $bad
