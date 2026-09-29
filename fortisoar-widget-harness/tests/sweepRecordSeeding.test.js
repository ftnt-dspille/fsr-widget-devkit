"use strict";

// The live sweep hardcoded record IRIs "confirmed present on forticloud". On
// .159 none of the three existed: every triage row investigated a record that
// get_record answered `not_found` for, and still graded green, because the
// rows assert shape (no JS error, some tool ran), not that the investigation
// found anything. The sweep now resolves each record by exact name on the
// target box and creates it when absent (soarClient.ensureRecord). These pin
// the two pure halves of that lookup.

const { recordLookupQuery, firstRecordIri, staleFields } = require("./live/lib/soarClient");

describe("sweep record lookup", () => {
  test("filters by the exact name, newest first, one row", () => {
    const q = recordLookupQuery("alerts", "Outbound C2 traffic - smithDesktop");
    expect(q).toBe("/api/3/alerts?name=Outbound%20C2%20traffic%20-%20smithDesktop"
      + "&$limit=1&$orderby=-createDate");
  });

  test("encodes names that would otherwise break the query string", () => {
    expect(recordLookupQuery("incidents", "a&b=c #1"))
      .toContain("name=a%26b%3Dc%20%231&");
  });

  test("reads the first record's IRI from a hydra collection", () => {
    expect(firstRecordIri({ "hydra:member": [{ "@id": "/api/3/alerts/x" }, { "@id": "/y" }] }))
      .toBe("/api/3/alerts/x");
  });

  test("an empty or malformed response means absent, never a throw", () => {
    expect(firstRecordIri({ "hydra:member": [] })).toBeNull();
    expect(firstRecordIri(null)).toBeNull();
    expect(firstRecordIri({})).toBeNull();
    expect(firstRecordIri({ "hydra:member": [{}] })).toBeNull();
  });

  // A record an older sweep created lacks fields added since: the C2 alert had
  // its IOCs only in description prose, so a trace-built playbook had nothing
  // to wire them to (row 5: verified wiring 0 on every run).
  test("tops up scalar fields the existing record lacks or holds differently", () => {
    const row = { name: "n", description: "d", sourceIp: "", source: "FortiSIEM" };
    const want = { name: "n", description: "d", source: "FortiSIEM",
                   sourceIp: "10.50.60.70", destinationIp: "203.0.113.42" };
    expect(staleFields(row, want)).toEqual(
      { sourceIp: "10.50.60.70", destinationIp: "203.0.113.42" });
  });

  test("a current record needs nothing; name and objects are never patched", () => {
    const want = { name: "other", description: "d",
                   severity: { itemValue: "Critical" } };
    expect(staleFields({ name: "n", description: "d" }, want)).toEqual({});
  });
});
