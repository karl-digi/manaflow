#!/bin/bash

(cd apps/client && bunx dotenv-cli -e ../../.env -- pnpm dev:electron)