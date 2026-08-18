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

const { classifyConnectorConfigured } = require("./live/lib/soarClient");

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
