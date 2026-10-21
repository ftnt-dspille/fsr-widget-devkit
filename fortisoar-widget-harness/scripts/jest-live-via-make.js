"use strict";
// jest globalSetup for the live suite (wired in jest.live.config.js). The make
// targets that run it are test-matrix-live, test-matrix-local and
// test-designer-stage-live. The check itself: via-make-guard.js.
const { assertViaMake } = require("./via-make-guard");

module.exports = async function globalSetup() {
  assertViaMake("make test-matrix-live (or test-matrix-local, test-designer-stage-live)");
};
