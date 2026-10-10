"use strict";

// Replays the golden turn frames through the live grader's digest. The same
// files are graded by the framework's Python readers
// (fsr_playbooks/tests/test_harness_golden_frames.py); the copies here are the
// JS side of one corpus. They come from real session frames, scrubbed.
//
// A test.failing() row is a KNOWN divergence between the two readers, pinned so
// it cannot drift silently: when the JS side is fixed the row fails, and the
// marker is removed in the same change.

const fs = require("fs");
const path = require("path");
const { digestLive } = require("./live/lib/exportGrader");

const DIR = path.join(__dirname, "live/fixtures/golden-frames");
const docs = fs.readdirSync(DIR).filter((f) => f.endsWith(".json")).sort()
  .map((f) => JSON.parse(fs.readFileSync(path.join(DIR, f), "utf8")));

// Golden name -> the field the JS digest does not agree with the framework on.
const KNOWN_DIVERGENCE = {
  // The framework reads the enhance path's verify_enhancement.after_yaml;
  // digestLive reads only yaml / playbook_yaml / currentYaml, so it loses the YAML.
  enhance_after_yaml_no_fence: "delivered_yaml",
  // digestLive keeps a fenced block only when it begins playbooks: / steps: /
  // - name:. The framework takes the last fence whatever it holds, so a fragment
  // the assistant put in a fence counts as delivered on one side only.
  fence_only_reply: "delivered_yaml",
};

describe.each(docs.map((d) => [d.name, d]))("golden frames: %s", (name, doc) => {
  const frames = doc.envelope.transcript;
  const expect_ = doc.expect;
  const d = digestLive(frames, [], {});

  test("streamed text deltas join to the assistant text", () => {
    expect(d.texts.join("").trim()).toBe(expect_.assistant_text);
  });

  test("tool calls take their name from the paired tool_use", () => {
    expect(d.toolCalls.map((t) => t.name)).toEqual(expect_.tool_calls.map((t) => t.name));
  });

  test("halts surface as cards (approval_request included)", () => {
    for (const h of expect_.halts) {
      expect(d.cards).toContain(h.type);
    }
  });

  test("error frames are not read as answer text", () => {
    if (expect_.error_messages.length) {
      expect(d.texts.join("")).not.toContain(expect_.error_messages[0]);
    }
  });

  const yamlTest = KNOWN_DIVERGENCE[name] ? test.failing : test;
  yamlTest("the delivered playbook matches the framework reader", () => {
    // Edge whitespace is not part of the playbook (the fence keeps its newline).
    expect((d.finalYaml || "").trim()).toBe(expect_.delivered_yaml.trim());
  });
});
