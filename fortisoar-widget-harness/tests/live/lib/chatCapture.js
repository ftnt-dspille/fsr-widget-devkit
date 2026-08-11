// Moved to lib/chatCapture.js: the recorder is harness INFRASTRUCTURE now, not
// a test-local helper. Any live spec or matrix row can record its own wire
// traffic through liveUiDriver (CAPTURE=1), and a module under tests/ is the
// wrong home for something lib/ depends on. Re-exported so existing importers
// keep working.
module.exports = require("../../../lib/chatCapture");
