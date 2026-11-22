"use strict";
// Tooling tests exercise the working-tree copy of every root script, never the
// remote main's: `make` runs root tooling through scripts/run_from_main.sh, which
// would otherwise run main's copy and test the wrong source. FROM_TREE=1 is its
// switch. The suites that test run_from_main.sh itself delete it from the env they
// hand to the child.
process.env.FROM_TREE = "1";
