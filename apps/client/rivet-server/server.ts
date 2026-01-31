/// <reference types="bun-types" />
/**
 * Rivet Demo Server
 *
 * Run this with: bun run rivet:dev
 *
 * This imports the registry which auto-starts the rivetkit manager on port 6421.
 * The client connects directly to the manager which has built-in CORS support.
 */
import "./registry";

// The registry auto-starts on import due to rivetkit's setTimeout(() => ensureRuntime(), 0)
// Just keep the process alive
console.log("Rivet demo server initializing...");
console.log("Client should connect to http://localhost:6421");

process.on("SIGINT", () => {
  console.log("\nShutting down Rivet server...");
  process.exit(0);
});
