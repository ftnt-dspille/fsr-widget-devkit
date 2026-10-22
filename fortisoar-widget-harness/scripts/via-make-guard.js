"use strict";
// Refusal shared by the two test runners (jest and Playwright). Claude Code sets
// CLAUDECODE=1 in every shell it spawns. Under it, a runner starts only when a
// blessed make target started it: the Makefile exports VIA_MAKE=1 for exactly
// those targets. A human shell never sets CLAUDECODE, so nothing changes for
// them. The rule and why it exists: TESTING.md, "Guardrails".

function assertViaMake(hint, env = process.env) {
  if (env.CLAUDECODE && !env.VIA_MAKE) {
    throw new Error(
      `run via ${hint}: jest and Playwright refuse to start under Claude Code ` +
        "(CLAUDECODE is set) unless a make target set VIA_MAKE=1. See TESTING.md, Guardrails."
    );
  }
}

module.exports = { assertViaMake };
