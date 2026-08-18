"use strict";

// The live sweep had two verdicts and needed three.
//
// A FAIL meant "widget regression"; an [[SWEEP-ENV-SKIP]] meant "the box is
// down". Neither fits the case that actually occurred: the box is UP, the
// widget is fine, and one row asks for a capability the box does not have. The
// containment row prompts "Block the IP ... on FortiGate" against a box with no
// `fortigate` connector configured, so the agent correctly answers "I need
// ip_block_policy and ip_group_name" -- a question, not a card. The sweep
// graded that as `[[SWEEP-FAIL]] ... widget regression`, blaming the widget for
// the box being incomplete.
//
// The live matrix already drew this distinction (matrixDriver.js: "the backend
// is missing a capability, the widget is fine"). This is the sweep's half.
//
// The subtlety worth pinning: the probe is THREE-valued. A two-valued probe
// that collapsed "could not determine" into "absent" would silently skip a real
// containment gate the moment the search call hiccupped -- disarming the
// assertion it exists to guard. `null` must PROCEED, not skip.
//
// AND THEN THE PROBE ITSELF GOT IT WRONG (2026-08-17). Its first live run
// ENV-SKIPped the containment row on .159 -- correctly by its own logic, and
// wrongly in fact: the box HAS a configured FortiGate, installed under the
// package name `fortigate-firewall`, and the probe asked for `fortigate`. The
// exact-match rule was right; the name was not guessable. Hence the equivalence
// set at the bottom of this file. Note the direction: a false ENV-SKIP is worse
// than a false FAIL, because nobody investigates a skip.

const {
  classifyConnectorConfigured,
  combineConfigured,
  FIREWALL_CONNECTORS,
} = require("./live/lib/soarClient");

const configured = {
  data: [{ name: "fortigate", configuration: [{ config_id: "abc", default: true }] }]
};

describe("configured vs absent", () => {
  test("present with a configuration is TRUE", () => {
    expect(classifyConnectorConfigured(configured, "fortigate")).toBe(true);
  });

  test("absent from the results is FALSE", () => {
    expect(classifyConnectorConfigured({ data: [] }, "fortigate")).toBe(false);
  });

  test("installed but with ZERO configurations is FALSE, not true", () => {
    // The case that bites: the connector is present on the box, so a naive
    // existence check says "yes" -- but nothing can actually execute one of its
    // actions, which is indistinguishable from absent for this row's purposes.
    expect(classifyConnectorConfigured(
      { data: [{ name: "fortigate", configuration: [] }] }, "fortigate")).toBe(false);
    expect(classifyConnectorConfigured(
      { data: [{ name: "fortigate" }] }, "fortigate")).toBe(false);
  });

  test("a different connector does not satisfy the probe", () => {
    // Search is a substring match server-side, so the payload can carry rows
    // the caller did not ask for. Matching on those would skip a containment
    // gate because some unrelated connector happened to be configured.
    expect(classifyConnectorConfigured(
      { data: [{ name: "fortigate-fortimanager", configuration: [{ config_id: "x" }] }] },
      "fortigate")).toBe(false);
  });
});

describe("indeterminate is null, and null must not mean absent", () => {
  // Each of these is a probe that FAILED to answer. Returning false here would
  // silently skip the containment row -- a gate quietly covering nothing, which
  // is the failure mode this whole tier exists to prevent.
  test.each([
    ["no payload", null],
    ["undefined", undefined],
    ["empty object", {}],
    ["data is not an array", { data: { name: "fortigate" } }],
    ["data is a string", { data: "fortigate" }],
  ])("%s is null", (_label, payload) => {
    expect(classifyConnectorConfigured(payload, "fortigate")).toBeNull();
  });

  test("null is distinguishable from false by the caller", () => {
    // The spec branches on `=== false`, so these must not be conflated. If this
    // ever collapses to a falsy-only check, an indeterminate probe starts
    // skipping live gates.
    const indeterminate = classifyConnectorConfigured(null, "fortigate");
    const absent = classifyConnectorConfigured({ data: [] }, "fortigate");
    expect(indeterminate).not.toBe(absent);
    expect(indeterminate === false).toBe(false);
  });
});

describe("malformed rows do not crash the probe", () => {
  test("null entries in data are survived", () => {
    // A throw here would propagate out of beforeAll and read as a box outage.
    expect(classifyConnectorConfigured(
      { data: [null, undefined, { name: "fortigate", configuration: [{ config_id: "y" }] }] },
      "fortigate")).toBe(true);
  });
});

describe("an equivalence set of names, folded to one verdict", () => {
  // The probe shipped asking for `fortigate`, and the box installs the FortiGate
  // connector as `fortigate-firewall`. Exact-match (correct, and asserted above)
  // then found nothing, and the containment row ENV-SKIPped on a box that had a
  // configured firewall all along -- a FALSE skip, the worse direction: the run
  // stays green-ish while covering less than it claims.
  test("any definite yes wins", () => {
    expect(combineConfigured([false, true])).toBe(true);
    expect(combineConfigured([null, true])).toBe(true);
  });

  test("all definitely absent is absent", () => {
    expect(combineConfigured([false, false])).toBe(false);
  });

  test("no yes + any indeterminate is INDETERMINATE, not absent", () => {
    // "everything I could check says no, and one I could not check" is not
    // evidence of absence, and only definite absence may skip a live gate.
    expect(combineConfigured([false, null])).toBeNull();
    expect(combineConfigured([null, null])).toBeNull();
  });

  test("the firewall set carries the INSTALLED package name, not the vendor word", () => {
    // The regression guard for the bug above. `fortigate` alone is what shipped
    // and it matched nothing on a box that had a configured FortiGate.
    expect(FIREWALL_CONNECTORS).toContain("fortigate-firewall");
  });

  test("the real box payload resolves through the whole probe", () => {
    // Shape lifted from the .159 connector listing: the row is named
    // `fortigate-firewall` with one configuration. The pre-fix probe returned
    // false here; the set must return true.
    const payload = { data: [
      { name: "fortinet-fortiedr", configuration: [{ config_id: "e" }] },
      { name: "fortigate-firewall", configuration: [{ config_id: "a" }] },
    ] };
    const verdicts = FIREWALL_CONNECTORS.map(
      (n) => classifyConnectorConfigured(payload, n));
    expect(combineConfigured(verdicts)).toBe(true);
    expect(classifyConnectorConfigured(payload, "fortigate")).toBe(false);
  });
});
