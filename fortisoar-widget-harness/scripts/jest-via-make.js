"use strict";
// jest globalSetup for the harness suite (wired in jest.config.js). Jest runs it
// once in the parent process before any test file, so a refused run executes
// no test. The check itself: via-make-guard.js.
const { assertViaMake } = require("./via-make-guard");

module.exports = async function globalSetup() {
  assertViaMake("make test-unit WIDGET=<name>");
};
