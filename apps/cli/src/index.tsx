import React from "react";
import { render } from "ink";
import { App } from "./app";

try {
  render(<App />);
} catch (error) {
  const message =
    error instanceof Error
      ? error.message
      : "Unknown error while starting the CLI.";
  console.error(message);
  process.exitCode = 1;
}
