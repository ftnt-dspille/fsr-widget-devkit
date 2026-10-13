// The boot check compares each widget's share of its own run, not wall-clock
// against a baseline from another day. Run beside a test suite, every widget
// booted 3-13x slower than its baseline at once and the gate failed all of
// them -- a gate nobody can pass, so nobody reads it.

const { bootRegression, median } = require("../scripts/introspect-gate.js");

describe("introspect-gate boot check", () => {
  test("a machine-wide slowdown fails nobody", () => {
    // Every widget ~5x slower, baseline median 400, run median 2000.
    expect(bootRegression(2100, 420, 2000, 400)).toBeNull();
    expect(bootRegression(1900, 380, 2000, 400)).toBeNull();
  });

  test("one widget slowing against its run still fails", () => {
    const msg = bootRegression(6000, 400, 2000, 400);
    expect(msg).toMatch(/^boot DCL \+200\.0% relative to its run/);
  });

  test("within the relative budget passes", () => {
    // Two back-to-back runs on one machine moved a widget's share by -47%..+25%;
    // the budget is about twice that.
    expect(bootRegression(3900, 400, 2000, 400)).toBeNull();   // +95%
    expect(bootRegression(4100, 400, 2000, 400)).not.toBeNull(); // +105%
  });

  test("without medians it falls back to the absolute budget", () => {
    expect(bootRegression(460, 400, null, null)).toBeNull();     // +15%
    expect(bootRegression(470, 400, null, null)).toMatch(/\+17\.5%/);
  });

  test("median ignores missing timings", () => {
    expect(median([3, 1, 2])).toBe(2);
    expect(median([4, 1, 3, 2])).toBe(2.5);
    expect(median([0, NaN, 5])).toBe(5);
    expect(median([])).toBeNull();
  });
});
