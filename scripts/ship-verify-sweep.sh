#!/usr/bin/env bash
#
# ship-verify step 6/6: the live-sweep gate for one widget.
#
# Called from the Makefile's ship-verify target with WIDGET and SKIP_LIVE_SWEEP
# in the environment, from the repo root. It lives here, not in the Makefile,
# because GNU make runs any recipe line that mentions $(MAKE) even under `make
# -n`. This step creates a temp file, pipes a recursive make and can exit 1, so
# inline it made a dry run do real work and fail. Behaviour is unchanged: the
# gate keys on the output markers, as before.
#
# The live sweep itself is `make test-live-sweep`, run by name from this script.

WIDGET="${WIDGET:-}"
lv_status="unverified"

if [ -n "${SKIP_LIVE_SWEEP:-}" ]; then
  echo "  ⚠️  SKIP_LIVE_SWEEP set -- this build is NOT live-verified."
  lv_status="skip"
elif [ -f "widgets-src/$WIDGET/tests/e2e/$WIDGET.liveSweep.spec.js" ]; then
  sweep_log=$(mktemp -t fsr-ship-sweep.XXXXXX)
  make test-live-sweep WIDGET="$WIDGET" 2>&1 | tee "$sweep_log"
  if grep -F -q '[[SWEEP-ENV-SKIP]]' "$sweep_log"; then
    echo "  ⚠️  box down / [[SWEEP-ENV-SKIP]] -- this build is NOT live-verified."
    lv_status="envskip"
  elif grep -F -q '[[SWEEP-VERIFIED]]' "$sweep_log"; then
    lv_status="verified"
  else
    echo "✗ live-sweep FAILED -- widget regression, not shipped (see output above)."
    rm -f "$sweep_log"
    exit 1
  fi
  rm -f "$sweep_log"
else
  echo "✗ no live sweep spec at widgets-src/$WIDGET/tests/e2e/$WIDGET.liveSweep.spec.js"
  echo "  ship-verify's live gate would cover NOTHING, so it fails instead of"
  echo "  claiming 'live-verified'. Write the spec, or pass SKIP_LIVE_SWEEP=1"
  echo "  to ship knowing this build is unverified against a box."
  exit 1
fi

case "$lv_status" in
  verified) lv_msg=" and live-verified";;
  skip) lv_msg=" -- NOT live-verified (SKIP_LIVE_SWEEP)";;
  envskip) lv_msg=" -- NOT live-verified (box down / [[SWEEP-ENV-SKIP]])";;
  *) lv_msg=" -- NOT live-verified";;
esac
echo "✅ ship-verify complete: $WIDGET gated (server+angular+testid lint, typecheck, unit, mock-e2e, introspect-gate), deployed$lv_msg."
