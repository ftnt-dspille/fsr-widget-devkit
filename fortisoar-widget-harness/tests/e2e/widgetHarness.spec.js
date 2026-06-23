"use strict";
// Self-tests for the reusable widget-harness kit (tests/e2e/_widgetHarness.js).
// Hermetic: drives the `counter` widget (no live box, deterministic config) and
// exercises the clippedBy primitive against injected DOM. If this suite is green,
// agents can trust mountWidget + the measure primitives for any widget.
//
//   make test-e2e-spec SPEC=tests/e2e/widgetHarness.spec.js

const { test, expect } = require("./_fixtures");
const { mountWidget, clippedBy } = require("./_widgetHarness");

test.describe("widget-harness kit", () => {
  test("mounts a configured widget and reads its DOM facts", async ({ page }) => {
    const w = await mountWidget(page, "counter", {
      config: { title: "Kit Test", start: 7, step: 1 },
    });

    // mount resolved on the widget's real content, not the loading placeholder.
    expect(await w.renderError()).toBeNull();
    expect(await w.visible("[data-testid=counter-root]")).toBe(true);

    // config drove the render (start:7 → value 7; title passthrough).
    expect(await w.text("[data-testid=counter-value]")).toBe("7");
    expect(await w.text("[data-testid=counter-title]")).toBe("Kit Test");

    // count + box primitives return real values.
    expect(await w.count(".counter-btn")).toBe(3);
    const box = await w.box("[data-testid=counter-value]");
    expect(box.width).toBeGreaterThan(0);
    expect(box.height).toBeGreaterThan(0);

    // style primitive reads a computed property.
    expect(await w.style("[data-testid=counter-root]", "display")).not.toBe("none");
  });

  test("an interaction changes a measured fact", async ({ page }) => {
    const w = await mountWidget(page, "counter", { config: { start: 0, step: 1 } });
    expect(await w.text("[data-testid=counter-value]")).toBe("0");
    await w.click("[data-testid=counter-increment]");
    await w.settle();
    expect(await w.text("[data-testid=counter-value]")).toBe("1");
  });

  test("clippedBy detects a child clipped by an overflow ancestor (both ways)", async ({ page }) => {
    await mountWidget(page, "counter", { config: { start: 0 } });
    // Inject a deterministic ancestor/child pair: child overflows the ancestor.
    await page.evaluate(() => {
      const mk = (overflow) => {
        const anc = document.createElement("div");
        anc.style.cssText = `position:fixed;top:0;left:0;width:100px;height:50px;overflow:${overflow}`;
        anc.className = `kit-anc-${overflow}`;
        const child = document.createElement("div");
        child.style.cssText = "width:100px;height:200px"; // taller than ancestor
        child.className = `kit-child-${overflow}`;
        anc.appendChild(child);
        document.body.appendChild(anc);
      };
      mk("hidden");
      mk("visible");
    });

    const clipped = await clippedBy(page, ".kit-child-hidden", ".kit-anc-hidden");
    expect(clipped.clipped).toBe(true);
    expect(clipped.edges.below).toBe(true);

    const spilled = await clippedBy(page, ".kit-child-visible", ".kit-anc-visible");
    expect(spilled.clipped).toBe(false); // overflow:visible → not clipped even though it spills
  });
});
