"use strict";
// Per-worker server isolation.
//
// The e2e suite runs 2 workers. Historically both shared ONE dev server on
// 14401; Node serves the heavy AngularJS app-shell single-threaded, so two
// simultaneous widget boots starved each other and produced "boot timeout"
// failures. The old config papered over that with retries (flaky-green), which
// we reject — a test that fails once is a failure.
//
// Instead each worker gets its OWN dev server (playwright.config.js boots one
// per port: 14401 + parallelIndex), so the workers never contend. This fixture
// points every spec that imports it at its worker's own server via baseURL.
//
// Specs use it exactly like @playwright/test:
//   const { test, expect } = require('<path>/_isolated');
import { test as base, expect } from "@playwright/test";

const BASE_PORT = 14401;

export const test = base.extend({
  baseURL: [
    async ({}, use, testInfo) => {
      const port = BASE_PORT + (testInfo.parallelIndex || 0);
      await use(`http://localhost:${port}`);
    },
    { scope: "test" },
  ],
});

export { expect };

// Per-worker harness origin for helpers that need an absolute URL (most specs
// should use relative paths against baseURL and never need this).
export const harnessUrl = (testInfo: {parallelIndex?: number}): string =>
  `http://localhost:${BASE_PORT + (testInfo.parallelIndex || 0)}`;
