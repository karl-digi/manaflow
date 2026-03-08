#!/usr/bin/env node

// Post-install message for devsh
// Only show in interactive terminals to avoid noise in CI

const isCI = process.env.CI === 'true' ||
             process.env.CONTINUOUS_INTEGRATION === 'true' ||
             process.env.BUILD_NUMBER !== undefined ||
             process.env.GITHUB_ACTIONS === 'true';

const isInteractive = process.stdout.isTTY && !isCI;

if (isInteractive) {
  const message = `
┌─────────────────────────────────────────────────────────┐
│                                                         │
│   devsh installed successfully!                          │
│                                                         │
│   Get started:                                          │
│     $ devsh login         # Login to your account       │
│     $ devsh start         # Create a cloud VM           │
│     $ devsh --help        # See all commands            │
│                                                         │
│   Documentation: https://github.com/karlorz/cmux          │
│                                                         │
└─────────────────────────────────────────────────────────┘
`;
  console.log(message);
}
