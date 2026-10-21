"use strict";
// Self-tests for the reusable widget-harness kit (tests/e2e/_widgetHarness.js).
// Hermetic: drives the `_template` widget (folder `_template`, widget name
// `myWidget`) -- a no-API, deterministic scaffold that renders a greeting from
// its config. If this suite is green, agents can trust mountWidget + the measure
// primitives (text/count/box/style/visible/renderError/settle) and the clippedBy
// primitive for any widget.
//
// Why `_template` and not a bespoke fixture: the kit must stay exercised against
// a real, kept widget so it can't rot behind an archived one (the previous
// version drove `counter`, which was archived). `_template` is the one widget
// guaranteed to exist for every contributor.
//
//   make test-e2e-spec SPEC=tests/e2e/widgetHarness.spec.js

const { test, expect } = require("./_fixtures");
const { mountWidget, clippedBy } = require("./_widgetHarness");

test.describe("widget-harness kit", () => {
  test("mounts a configured widget and reads its DOM facts", async ({ page }) => {
    const w = await mountWidget(page, "myWidget", {
      config: { title: "Kit Test" },
    });

    // mount resolved on the widget's real content, not the loading placeholder
    // or a render-error panel.
    expect(await w.renderError()).toBeNull();
    expect(await w.visible("[data-testid=my-widget-root]")).toBe(true);

    // config drove the render: greeting is "Hello, " + config.title.
    expect(await w.text("[data-testid=my-widget-greeting]")).toBe("Hello, Kit Test");

    // count primitive returns a real value (exactly one greeting heading).
    expect(await w.count("[data-testid=my-widget-greeting]")).toBe(1);

    // box primitive returns real geometry.
    const box = await w.box("[data-testid=my-widget-greeting]");
    expect(box.width).toBeGreaterThan(0);
    expect(box.height).toBeGreaterThan(0);

    // style primitive reads a computed property.
    expect(await w.style("[data-testid=my-widget-root]", "display")).not.toBe("none");

    // settle primitive flushes a digest/layout without throwing.
    await w.settle();
    expect(await w.text("[data-testid=my-widget-greeting]")).toBe("Hello, Kit Test");
  });

  test("config seeding deterministically drives what the kit measures", async ({ page }) => {
    const a = await mountWidget(page, "myWidget", { config: { title: "Alpha" } });
    expect(await a.text("[data-testid=my-widget-greeting]")).toBe("Hello, Alpha");

    // Re-mount with a different config and confirm the measured fact changes --
    // proves the kit's config-seed-then-reload path (not a stale page).
    const b = await mountWidget(page, "myWidget", { config: { title: "Beta" } });
    expect(await b.text("[data-testid=my-widget-greeting]")).toBe("Hello, Beta");
  });

  test("clippedBy detects a child clipped by an overflow ancestor (both ways)", async ({ page }) => {
    await mountWidget(page, "myWidget", { config: { title: "Clip" } });
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
    expect(spilled.clipped).toBe(false); // overflow:visible -> not clipped even though it spills
  });
});
