# @cmux/morphcloud-client

Auto-generated TypeScript client for the MorphCloud API.

## Overview

This package provides a type-safe TypeScript client for interacting with the MorphCloud API. It's auto-generated from the MorphCloud OpenAPI specification using [@hey-api/openapi-ts](https://heyapi.dev/).

## Installation

This is a workspace package and is installed as part of the cmux monorepo:

```bash
bun install
```

## Usage

```typescript
import { client } from '@cmux/morphcloud-client';

// Configure the client
client.setConfig({
  baseUrl: 'https://cloud.morph.so',
  headers: {
    Authorization: `Bearer ${apiKey}`,
  },
});

// Example: List instances
const { data, error } = await client.GET('/instance');
if (error) {
  console.error('Error:', error);
} else {
  console.log('Instances:', data);
}

// Example: Start an instance from a snapshot
const { data: instance, error: startError } = await client.POST('/instance', {
  query: { snapshot_id: 'snapshot_xxx' },
  body: {
    metadata: { name: 'my-instance' },
    ttl_seconds: 3600,
  },
});
```

## Regenerating the Client

To regenerate the client from the latest MorphCloud OpenAPI specification:

```bash
bun run generate
```

This will:
1. Fetch the OpenAPI spec from `https://cloud.morph.so/api/openapi.json`
2. Generate TypeScript types and client code
3. Output to `src/client/`

## Examples

See `examples/basic-usage.ts` for comprehensive usage examples including:
- Creating snapshots
- Starting/stopping instances
- Executing commands
- Managing instance lifecycle

## API Documentation

For full API documentation, see:
- [MorphCloud API Docs](https://cloud.morph.so/api/doc)
- Generated types in `src/client/types.gen.ts`

## Package Structure

```
├── src/
│   └── client/          # Generated client code (do not edit)
│       ├── client/      # Client implementation
│       ├── core/        # Core utilities
│       ├── types.gen.ts # Type definitions
│       └── index.ts     # Main export
├── scripts/
│   └── generate-client.ts  # Generation script
└── package.json
```

## Development

- `bun run typecheck` - Type check the generated code
- `bun run lint` - Lint the package
- `bun run generate` - Regenerate the client
