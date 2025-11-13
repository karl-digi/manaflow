#!/usr/bin/env python3
import os
import subprocess
import tempfile
from pathlib import Path

# Read environment variables from .env.codesign
env_file = Path(".env.codesign")
env_vars = {}

with open(env_file) as f:
    for line in f:
        if "=" in line and not line.startswith("#"):
            key, value = line.strip().split("=", 1)
            # Remove surrounding quotes if present
            if value.startswith('"') and value.endswith('"'):
                value = value[1:-1]
            env_vars[key] = value

# Create a temporary key file
with tempfile.NamedTemporaryFile(mode='w', suffix='.p8', delete=False) as key_file:
    key_file.write(env_vars['APPLE_API_KEY'])
    key_path = key_file.name

try:
    # Run notarytool
    cmd = [
        'xcrun', 'notarytool', 'history',
        '--key', key_path,
        '--key-id', env_vars['APPLE_API_KEY_ID'],
        '--issuer', env_vars['APPLE_API_ISSUER']
    ]
    
    print(f"Running: {' '.join(cmd)}")
    result = subprocess.run(cmd, capture_output=True, text=True)
    
    if result.stdout:
        print(result.stdout)
    if result.stderr:
        print("Error:", result.stderr)
    
    exit(result.returncode)
    
finally:
    # Clean up the temporary key file
    os.unlink(key_path)