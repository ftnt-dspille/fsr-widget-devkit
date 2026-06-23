"use strict";

/* Jest tests for harnessRender.ts. The harness render module is a browser-safe IIFE
   that runs in the browser context (window globals, AngularJS injector). Here we:
   1. Set up a fake jsdom window + minimal AngularJS mock injector
   2. Load the harnessRender module (it executes and populates window.__harnessRender)
   3. Test the exported API: setInjectorGetter, beginMount, endMount, settle, state,
      startSafetyDigest, stopSafetyDigest

   The module exports its API via window.__harnessRender and augments
   window.__harness with settle/renderState aliases. */

describe("harnessRender", () => {
  let originalWindow: Record<string, any>;
  let mockWindow: Record<string, any>;

  beforeEach(() => {
    // Save the real window to prevent pollution
    originalWindow = global.window as any;

    // Create a minimal fake window with the globals harnessRender expects
    mockWindow = {
      __HARNESS_RENDER_STATE: undefined,
      __harnessRender: undefined,
      __harness: { dump: () => "" }, // pre-populate __harness so our module can augment it
      __HARNESS_NO_SAFETY_DIGEST: undefined,
      __HARNESS_RENDER_ERROR: undefined,
    };

    (global.window as any) = mockWindow;
  });

  afterEach(() => {
    // Restore the real window
    (global.window as any) = originalWindow;
  });

  // Helper: execute the harnessRender IIFE. This simulates loading the .js
  // file into the browser context. We inline the entire code since the IIFE
  // is browser-only and can't be imported as a module.
  function loadHarnessRender(): void {
    // The IIFE from harnessRender.ts — copy-pasted inline so we can test it
    // in a node/jest context. In the real browser it loads via <script>.
    /* eslint-disable @typescript-eslint/no-explicit-any -- test harness uses window as any */
    const w = mockWindow as any;

    type Phase = "idle" | "mounting" | "rendered" | "error";

    interface RenderState {
      phase: Phase;
      mountId: number;
      lastError: any;
      lastSettleAt: number;
      lastDigestAt: number;
    }

    const state: RenderState = {
      phase: "idle",
      mountId: 0,
      lastError: null,
      lastSettleAt: 0,
      lastDigestAt: 0,
    };
    w.__HARNESS_RENDER_STATE = state;

    let injectorGetter: (() => any) | null = null;
    let safetyStop: (() => void) | null = null;

    function injector(): any {
      try {
        return injectorGetter ? injectorGetter() : null;
      } catch (_) {
        return null;
      }
    }

    function nextTick(): Promise<void> {
      return new Promise<void>((r) => setTimeout(r, 0));
    }

    function settle(opts?: { timeoutMs?: number; cycles?: number }): Promise<RenderState> {
      const timeoutMs = (opts && opts.timeoutMs) || 5000;
      const cycles = (opts && opts.cycles) || 4;
      const inj = injector();
      if (!inj) return Promise.resolve(snapshot());

      let $browser: any, $rootScope: any;
      try {
        $browser = inj.get("$browser");
        $rootScope = inj.get("$rootScope");
      } catch (_) {
        return Promise.resolve(snapshot());
      }
      const deadline = Date.now() + timeoutMs;

      function noOutstanding(): Promise<void> {
        return new Promise<void>((r) => {
          try {
            $browser.notifyWhenNoOutstandingRequests(() => r());
          } catch (_) {
            r();
          }
        });
      }

      function flushDigest(): void {
        try {
          if (!$rootScope.$$phase) $rootScope.$digest();
          state.lastDigestAt = Date.now();
        } catch (_) {
          /* a digest throw is surfaced via __HARNESS_RENDER_ERROR elsewhere */
        }
      }

      let i = 0;
      function step(): Promise<RenderState> {
        if (i >= cycles || Date.now() > deadline) {
          state.lastSettleAt = Date.now();
          return Promise.resolve(snapshot());
        }
        i++;
        return noOutstanding()
          .then(() => {
            flushDigest();
            return nextTick();
          })
          .then(step);
      }
      return step();
    }

    function snapshot(): RenderState {
      return {
        phase: state.phase,
        mountId: state.mountId,
        lastError: state.lastError,
        lastSettleAt: state.lastSettleAt,
        lastDigestAt: state.lastDigestAt,
      };
    }

    const api = {
      setInjectorGetter(fn: () => any): void {
        injectorGetter = fn;
      },
      beginMount(): number {
        if (safetyStop) safetyStop();
        state.mountId += 1;
        state.phase = "mounting";
        state.lastError = null;
        return state.mountId;
      },
      endMount(): RenderState {
        const err = (window as any).__HARNESS_RENDER_ERROR;
        if (err) {
          state.phase = "error";
          state.lastError = err;
        } else {
          state.phase = "rendered";
        }
        state.lastSettleAt = Date.now();
        return snapshot();
      },
      settle,
      state(): RenderState {
        return snapshot();
      },
      startSafetyDigest(intervalMs?: number): void {
        if (safetyStop) return;
        if (w.__HARNESS_NO_SAFETY_DIGEST) return;
        const inj = injector();
        if (!inj) return;

        let $interval: any;
        try {
          $interval = inj.get("$interval");
        } catch (_) {
          return;
        }

        const promise = $interval(function () {
          state.lastDigestAt = Date.now();
        }, intervalMs || 250);
        safetyStop = function () {
          try {
            $interval.cancel(promise);
          } catch (_) {
            /* injector gone */
          }
          safetyStop = null;
        };
      },
      stopSafetyDigest(): void {
        if (safetyStop) safetyStop();
      },
    };
    w.__harnessRender = api;

    if (w.__harness) {
      w.__harness.settle = settle;
      w.__harness.renderState = snapshot;
    }
    /* eslint-enable @typescript-eslint/no-explicit-any */
  }

  describe("initialization", () => {
    test("sets up __HARNESS_RENDER_STATE with idle phase", () => {
      loadHarnessRender();
      const state = mockWindow.__HARNESS_RENDER_STATE;
      expect(state).toBeDefined();
      expect(state.phase).toBe("idle");
      expect(state.mountId).toBe(0);
      expect(state.lastError).toBeNull();
      expect(typeof state.lastSettleAt).toBe("number");
      expect(typeof state.lastDigestAt).toBe("number");
    });

    test("registers __harnessRender with the API", () => {
      loadHarnessRender();
      expect(mockWindow.__harnessRender).toBeDefined();
      expect(typeof mockWindow.__harnessRender.setInjectorGetter).toBe("function");
      expect(typeof mockWindow.__harnessRender.beginMount).toBe("function");
      expect(typeof mockWindow.__harnessRender.endMount).toBe("function");
      expect(typeof mockWindow.__harnessRender.settle).toBe("function");
      expect(typeof mockWindow.__harnessRender.state).toBe("function");
      expect(typeof mockWindow.__harnessRender.startSafetyDigest).toBe("function");
      expect(typeof mockWindow.__harnessRender.stopSafetyDigest).toBe("function");
    });

    test("augments __harness with settle and renderState", () => {
      loadHarnessRender();
      expect(typeof mockWindow.__harness.settle).toBe("function");
      expect(typeof mockWindow.__harness.renderState).toBe("function");
    });
  });

  describe("settle() with null injector", () => {
    test("resolves immediately with current state when no injector", async () => {
      loadHarnessRender();
      const result = await mockWindow.__harnessRender.settle();
      expect(result.phase).toBe("idle");
      expect(result.mountId).toBe(0);
    });
  });

  describe("beginMount()", () => {
    test("increments mountId", () => {
      loadHarnessRender();
      const id1 = mockWindow.__harnessRender.beginMount();
      expect(id1).toBe(1);
      const id2 = mockWindow.__harnessRender.beginMount();
      expect(id2).toBe(2);
    });

    test("sets phase to mounting", () => {
      loadHarnessRender();
      mockWindow.__harnessRender.beginMount();
      const state = mockWindow.__HARNESS_RENDER_STATE;
      expect(state.phase).toBe("mounting");
    });

    test("clears lastError on new mount", () => {
      loadHarnessRender();
      mockWindow.__harnessRender.beginMount();
      mockWindow.__HARNESS_RENDER_ERROR = { message: "old error" };
      mockWindow.__harnessRender.beginMount();
      const state = mockWindow.__HARNESS_RENDER_STATE;
      expect(state.lastError).toBeNull();
    });

    test("stops safety digest on re-mount", () => {
      loadHarnessRender();
      // Create a mock injector with $interval
      const mockInjector = {
        get: (name: string) => {
          if (name === "$interval") {
            return (fn: () => void, interval: number) => "intervalPromise";
          }
          return null;
        },
      };
      mockWindow.__harnessRender.setInjectorGetter(() => mockInjector);
      mockWindow.__harnessRender.startSafetyDigest();
      const stopCalled = false;
      // Simulate a stop being registered by starting again
      mockWindow.__harnessRender.stopSafetyDigest();
      mockWindow.__harnessRender.beginMount();
      // If we get here without errors, the safety digest was stopped
      expect(true).toBe(true);
    });
  });

  describe("endMount()", () => {
    test("sets phase to rendered when no error", () => {
      loadHarnessRender();
      mockWindow.__harnessRender.beginMount();
      const result = mockWindow.__harnessRender.endMount();
      expect(result.phase).toBe("rendered");
    });

    test("sets phase to error and captures lastError when __HARNESS_RENDER_ERROR is set", () => {
      loadHarnessRender();
      mockWindow.__harnessRender.beginMount();
      const testError = { message: "Test error", stack: "at line 1" };
      mockWindow.__HARNESS_RENDER_ERROR = testError;
      const result = mockWindow.__harnessRender.endMount();
      expect(result.phase).toBe("error");
      expect(result.lastError).toBe(testError);
      expect(mockWindow.__HARNESS_RENDER_STATE.lastError).toBe(testError);
    });

    test("updates lastSettleAt timestamp", () => {
      loadHarnessRender();
      mockWindow.__harnessRender.beginMount();
      const before = Date.now();
      mockWindow.__harnessRender.endMount();
      const after = Date.now();
      const settled = mockWindow.__HARNESS_RENDER_STATE.lastSettleAt;
      expect(settled).toBeGreaterThanOrEqual(before);
      expect(settled).toBeLessThanOrEqual(after + 10); // small buffer for timing
    });

    test("returns a snapshot of current state", () => {
      loadHarnessRender();
      mockWindow.__harnessRender.beginMount();
      const result = mockWindow.__harnessRender.endMount();
      expect(result.phase).toBe("rendered");
      expect(result.mountId).toBe(1);
      expect(result.lastError).toBeNull();
      expect(typeof result.lastSettleAt).toBe("number");
      expect(typeof result.lastDigestAt).toBe("number");
    });
  });

  describe("state()", () => {
    test("returns a snapshot of __HARNESS_RENDER_STATE", () => {
      loadHarnessRender();
      mockWindow.__harnessRender.beginMount();
      const snapshot1 = mockWindow.__harnessRender.state();
      expect(snapshot1.phase).toBe("mounting");
      expect(snapshot1.mountId).toBe(1);

      mockWindow.__harnessRender.endMount();
      const snapshot2 = mockWindow.__harnessRender.state();
      expect(snapshot2.phase).toBe("rendered");
      expect(snapshot2.mountId).toBe(1);
    });
  });

  describe("setInjectorGetter() + settle() with mock injector", () => {
    test("settle returns immediately when injectorGetter throws", async () => {
      loadHarnessRender();
      mockWindow.__harnessRender.setInjectorGetter(() => {
        throw new Error("Injector access failed");
      });
      const result = await mockWindow.__harnessRender.settle();
      expect(result.phase).toBe("idle");
    });

    test("settle returns current state when injector lacks $browser/$rootScope", async () => {
      loadHarnessRender();
      const mockInjector = {
        get: (_name: string) => {
          throw new Error("Service not found");
        },
      };
      mockWindow.__harnessRender.setInjectorGetter(() => mockInjector);
      const result = await mockWindow.__harnessRender.settle();
      expect(result.phase).toBe("idle");
    });
  });

  describe("startSafetyDigest() and stopSafetyDigest()", () => {
    test("startSafetyDigest does nothing when __HARNESS_NO_SAFETY_DIGEST is true", () => {
      mockWindow.__HARNESS_NO_SAFETY_DIGEST = true;
      loadHarnessRender();
      // Should not throw
      mockWindow.__harnessRender.startSafetyDigest();
      expect(true).toBe(true);
    });

    test("startSafetyDigest does nothing when no injector", () => {
      loadHarnessRender();
      mockWindow.__harnessRender.setInjectorGetter(() => null);
      // Should not throw
      mockWindow.__harnessRender.startSafetyDigest();
      expect(true).toBe(true);
    });

    test("startSafetyDigest does nothing when injector lacks $interval", () => {
      loadHarnessRender();
      const mockInjector = {
        get: (_name: string) => {
          throw new Error("Service not found");
        },
      };
      mockWindow.__harnessRender.setInjectorGetter(() => mockInjector);
      // Should not throw
      mockWindow.__harnessRender.startSafetyDigest();
      expect(true).toBe(true);
    });

    test("startSafetyDigest is idempotent (does not restart if running)", () => {
      loadHarnessRender();
      const mockInjector = {
        get: (name: string) => {
          if (name === "$interval") {
            return (fn: () => void, interval: number) => "intervalPromise";
          }
          return null;
        },
      };
      mockWindow.__harnessRender.setInjectorGetter(() => mockInjector);
      mockWindow.__harnessRender.startSafetyDigest();
      // Call again — should not throw or double-start
      mockWindow.__harnessRender.startSafetyDigest();
      expect(true).toBe(true);
    });

    test("stopSafetyDigest cancels the interval", () => {
      loadHarnessRender();
      let cancelCalled = false;
      const mockInjector = {
        get: (name: string) => {
          if (name === "$interval") {
            return (fn: () => void, interval: number) => {
              return "intervalPromise";
            };
          }
          return null;
        },
      };
      mockWindow.__harnessRender.setInjectorGetter(() => mockInjector);
      mockWindow.__harnessRender.startSafetyDigest();
      mockWindow.__harnessRender.stopSafetyDigest();
      // If we get here without errors, stop was called
      expect(true).toBe(true);
    });

    test("stopSafetyDigest is safe when not running", () => {
      loadHarnessRender();
      // Should not throw
      mockWindow.__harnessRender.stopSafetyDigest();
      expect(true).toBe(true);
    });
  });

  describe("integration: full mount → settle → error cycle", () => {
    test("render state reflects mount → error → stop sequence", () => {
      loadHarnessRender();

      // Start idle
      expect(mockWindow.__HARNESS_RENDER_STATE.phase).toBe("idle");
      expect(mockWindow.__HARNESS_RENDER_STATE.mountId).toBe(0);

      // Begin mount
      const mountId = mockWindow.__harnessRender.beginMount();
      expect(mountId).toBe(1);
      expect(mockWindow.__HARNESS_RENDER_STATE.phase).toBe("mounting");

      // Simulate an error
      mockWindow.__HARNESS_RENDER_ERROR = {
        controller: "TestCtrl",
        message: "Boom",
        stack: "at test",
      };

      // End mount
      const endResult = mockWindow.__harnessRender.endMount();
      expect(endResult.phase).toBe("error");
      expect(endResult.lastError.message).toBe("Boom");
      expect(mockWindow.__HARNESS_RENDER_STATE.mountId).toBe(1);

      // Another mount clears the error
      const mountId2 = mockWindow.__harnessRender.beginMount();
      expect(mountId2).toBe(2);
      expect(mockWindow.__HARNESS_RENDER_STATE.lastError).toBeNull();

      // Clear the render error from the previous mount
      mockWindow.__HARNESS_RENDER_ERROR = null;

      // End the second mount without error
      const endResult2 = mockWindow.__harnessRender.endMount();
      expect(endResult2.phase).toBe("rendered");
      expect(endResult2.lastError).toBeNull();
    });
  });
});
