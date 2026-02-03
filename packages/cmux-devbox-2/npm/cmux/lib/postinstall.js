#!/usr/bin/env node
/**
 * Post-install script for cmux
 * Copies the platform-specific binary to the bin directory
 */

const fs = require('fs');
const path = require('path');

const PLATFORMS = {
  'darwin-arm64': 'cmux-darwin-arm64',
  'darwin-x64': 'cmux-darwin-x64',
  'linux-arm64': 'cmux-linux-arm64',
  'linux-x64': 'cmux-linux-x64',
  'win32-x64': 'cmux-win32-x64',
};

function getPlatformPackage() {
  const platform = process.platform;
  const arch = process.arch;

  // Map Node.js arch to our naming
  let archName = arch;
  if (arch === 'x64') archName = 'x64';
  else if (arch === 'arm64') archName = 'arm64';

  const key = `${platform}-${archName}`;
  return PLATFORMS[key];
}

function findBinary(packageName) {
  // Try to find the binary in node_modules
  const possiblePaths = [
    // Hoisted to top-level node_modules
    path.join(__dirname, '..', '..', packageName, 'bin'),
    // In our own node_modules
    path.join(__dirname, '..', 'node_modules', packageName, 'bin'),
    // Global install
    path.join(__dirname, '..', '..', '..', packageName, 'bin'),
  ];

  for (const p of possiblePaths) {
    const binName = process.platform === 'win32' ? 'cmux.exe' : 'cmux';
    const binPath = path.join(p, binName);
    if (fs.existsSync(binPath)) {
      return binPath;
    }
  }

  return null;
}

function main() {
  const platformPackage = getPlatformPackage();

  if (!platformPackage) {
    console.error(`Unsupported platform: ${process.platform}-${process.arch}`);
    console.error('Supported platforms: darwin-arm64, darwin-x64, linux-arm64, linux-x64, win32-x64');
    process.exit(1);
  }

  const sourceBinary = findBinary(platformPackage);

  if (!sourceBinary) {
    // Binary not found - this is OK if we're in development or the optional dep wasn't installed
    console.log(`Platform package ${platformPackage} not found, skipping binary copy`);
    console.log('If you need the binary, install the platform-specific package manually:');
    console.log(`  npm install ${platformPackage}`);
    return;
  }

  const binDir = path.join(__dirname, '..', 'bin');
  const destBinary = path.join(binDir, process.platform === 'win32' ? 'cmux.exe' : 'cmux');

  // Ensure bin directory exists
  if (!fs.existsSync(binDir)) {
    fs.mkdirSync(binDir, { recursive: true });
  }

  // Copy the binary
  fs.copyFileSync(sourceBinary, destBinary);

  // Make executable on Unix
  if (process.platform !== 'win32') {
    fs.chmodSync(destBinary, 0o755);
  }

  console.log(`cmux: Installed ${platformPackage} binary`);
}

main();
