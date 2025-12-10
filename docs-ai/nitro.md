# Nitro

Nitro is a full-stack framework that extends Vite applications with a production-ready server. It's designed to run anywhere with zero configuration.

## Key Features

- **Full-Stack**: Add server routes to any Vite application
- **Multi-Runtime**: Deploy to Node.js, Bun, Deno, Cloudflare Workers, and more
- **Zero-Config**: Auto-detects deployment targets and configures accordingly
- **Fast Startup**: Code-splitting and compiled routes minimize boot time
- **Storage Layer**: Built-in key-value storage with 20+ drivers
- **Caching**: Integrated caching system with SWR support

## Installation

### New Project

```sh
npx create-nitro-app
# or
bunx create-nitro-app
```

### Add to Existing Vite Project

```sh
npm install nitro
```

```ts
// vite.config.ts
import { defineConfig } from 'vite'
import { nitro } from 'nitro/vite'

export default defineConfig({
  plugins: [
    nitro()
  ],
  nitro: {
    serverDir: './'
  }
})
```

## Server Entry

The server entry is global middleware that runs before route matching.

### Auto-Detection

Create a `server.ts` file in your project root:

```ts
// server.ts - Using Web Standard
export default {
  async fetch(req: Request): Promise<Response> {
    return new Response(`Hello world! (${req.url})`)
  }
}
```

### With H3

```ts
// server.ts
import { H3 } from 'h3'

const app = new H3()

app.get('/', () => '⚡️ Hello from H3!')

export default app
```

### With Hono

```ts
// server.ts
import { Hono } from 'hono'

const app = new Hono()

app.get('/', (c) => c.text('🔥 Hello from Hono!'))

export default app
```

### With Elysia

```ts
// server.ts
import { Elysia } from 'elysia'

const app = new Elysia()

app.get('/', () => '🦊 Hello from Elysia!')

export default app
```

### Using defineHandler

```ts
// server.ts
import { defineHandler } from 'nitro/h3'

export default defineHandler((event) => {
  // Add request ID to context
  event.context.requestId = crypto.randomUUID()

  // Return undefined to continue to routes
  return undefined

  // Or return a Response to stop processing
  // return new Response('Blocked', { status: 403 })
})
```

## Routing

Nitro uses filesystem-based routing. Files in `routes/` or `api/` are automatically registered.

### Basic Routes

```
routes/
├── index.ts        → /
├── hello.ts        → /hello
├── users/
│   ├── index.ts    → /users
│   └── [id].ts     → /users/:id
└── api/
    └── posts.ts    → /api/posts
```

### Request Handlers

```ts
// routes/hello.ts
import { defineHandler } from 'nitro/h3'

export default defineHandler((event) => {
  return { message: 'Hello!' }
})

// Or simple function
export default (event) => {
  return { message: 'Hello!' }
}
```

### HTTP Methods

Specify methods by appending to filename:

```
routes/
├── users.get.ts     → GET /users
├── users.post.ts    → POST /users
└── users/
    ├── [id].get.ts  → GET /users/:id
    ├── [id].put.ts  → PUT /users/:id
    └── [id].delete.ts → DELETE /users/:id
```

### Dynamic Routes

```ts
// routes/users/[id].ts
import { defineHandler } from 'nitro/h3'

export default defineHandler((event) => {
  const id = event.context.params.id
  return { userId: id }
})
```

### Catch-All Routes

```ts
// routes/[...slug].ts
import { defineHandler } from 'nitro/h3'

export default defineHandler((event) => {
  const slug = event.context.params.slug
  return { path: slug }
})
```

### Route Groups

Parentheses create organizational groups without affecting paths:

```
routes/
├── (auth)/
│   ├── login.ts    → /login
│   └── register.ts → /register
└── (dashboard)/
    ├── stats.ts    → /stats
    └── settings.ts → /settings
```

## Middleware

Create middleware in the `middleware/` directory:

```ts
// middleware/auth.ts
import { defineHandler } from 'nitro/h3'

export default defineHandler((event) => {
  const token = event.node.req.headers.authorization

  if (!token) {
    return new Response('Unauthorized', { status: 401 })
  }

  // Continue processing
  return undefined
})
```

Middleware executes in directory listing order for all routes.

## Caching

### Cached Handlers

```ts
// routes/api/data.ts
import { defineCachedHandler } from 'nitro/h3'

export default defineCachedHandler(async (event) => {
  // Expensive operation
  const data = await fetchFromDatabase()
  return data
}, {
  maxAge: 60 * 10, // 10 minutes
  swr: true // Serve stale while revalidating (default)
})
```

### Cached Functions

```ts
// utils/fetchData.ts
import { defineCachedFunction } from 'nitro/h3'

export const getData = defineCachedFunction(async (key: string) => {
  const response = await fetch(`https://api.example.com/${key}`)
  return response.json()
}, {
  maxAge: 60 * 60, // 1 hour
  getKey: (key) => `data:${key}`
})

// routes/api/items/[id].ts
import { getData } from '~/utils/fetchData'

export default defineHandler(async (event) => {
  const id = event.context.params.id
  return getData(id)
})
```

### Route-Based Caching

```ts
// nitro.config.ts
export default {
  routeRules: {
    '/api/static/**': { cache: { maxAge: 60 * 60 * 24 } }, // 24 hours
    '/api/dynamic/**': { cache: false },
    '/api/swr/**': { cache: { maxAge: 60, swr: true } }
  }
}
```

### Cache Options

```ts
defineCachedHandler(handler, {
  maxAge: 60,              // Cache duration in seconds
  swr: true,               // Serve stale while revalidating
  varies: ['cookie'],      // Headers that affect cache key
  getKey: (event) => '',   // Custom cache key
  shouldInvalidateCache: (event) => false,
  shouldBypassCache: (event) => false
})
```

## Storage

Nitro provides a runtime-agnostic key-value storage layer.

### Using Storage

```ts
import { defineHandler } from 'nitro/h3'
import { useStorage } from 'nitro/storage'

export default defineHandler(async (event) => {
  const storage = useStorage()

  // Set value
  await storage.setItem('user:1', { name: 'John' })

  // Get value
  const user = await storage.getItem('user:1')

  // Check existence
  const exists = await storage.hasItem('user:1')

  // Remove
  await storage.removeItem('user:1')

  // List keys
  const keys = await storage.getKeys('user:')

  return { user }
})
```

### Storage Configuration

```ts
// nitro.config.ts
export default {
  storage: {
    redis: {
      driver: 'redis',
      url: 'redis://localhost:6379'
    },
    db: {
      driver: 'fs',
      base: './data'
    }
  }
}
```

### Mounting Storage

```ts
const storage = useStorage()

// Use specific mount
await storage.setItem('redis:session:123', { user: 'john' })
await storage.getItem('db:config')
```

## Deployment

### Auto-Detection

Nitro auto-detects these platforms via CI/CD:
- AWS Amplify
- Azure
- Cloudflare Pages/Workers
- Firebase
- Netlify
- Vercel
- Zeabur

### Manual Preset Selection

```ts
// nitro.config.ts
export default {
  preset: 'cloudflare-pages'
}
```

Or via environment:

```sh
NITRO_PRESET=cloudflare-pages npm run build
```

Or CLI:

```sh
vite build --preset cloudflare-pages
```

### Available Presets

- `node` - Node.js server (default)
- `bun` - Bun runtime
- `deno` - Deno runtime
- `cloudflare-pages` - Cloudflare Pages
- `cloudflare-workers` - Cloudflare Workers
- `vercel` - Vercel Functions
- `netlify` - Netlify Functions
- `aws-lambda` - AWS Lambda
- `azure-functions` - Azure Functions

### Build Output

```sh
npm run build
# or
vite build
```

Output is generated in `.output/` directory, ready for deployment.

## Configuration

```ts
// nitro.config.ts or vite.config.ts nitro option
export default {
  // Deployment preset
  preset: 'node',

  // Route rules for caching, redirects, etc.
  routeRules: {
    '/api/**': { cors: true },
    '/old-path': { redirect: '/new-path' }
  },

  // Storage drivers
  storage: {},

  // Development storage (different from production)
  devStorage: {},

  // Server entry point
  serverEntry: 'server.ts',

  // Compatibility date for feature flags
  compatibilityDate: '2024-01-01'
}
```

## Route Rules

```ts
// nitro.config.ts
export default {
  routeRules: {
    // Cache
    '/api/cached': { cache: { maxAge: 3600 } },

    // Redirect
    '/old': { redirect: '/new' },
    '/old/**': { redirect: '/new/**' },

    // Proxy
    '/proxy/**': { proxy: 'https://api.example.com/**' },

    // CORS
    '/api/**': {
      cors: true,
      headers: { 'Access-Control-Allow-Origin': '*' }
    },

    // Headers
    '/assets/**': {
      headers: { 'Cache-Control': 'public, max-age=31536000' }
    },

    // Disable caching
    '/api/realtime': { cache: false }
  }
}
```

## Error Handling

```ts
// routes/api/users/[id].ts
import { defineHandler, createError } from 'nitro/h3'

export default defineHandler(async (event) => {
  const id = event.context.params.id
  const user = await findUser(id)

  if (!user) {
    throw createError({
      statusCode: 404,
      message: 'User not found'
    })
  }

  return user
})
```

Error responses:
- Routes under `/api/` return JSON errors
- Other routes return HTML errors

## References

- [Official Documentation (v3)](https://v3.nitro.build)
- [GitHub Repository](https://github.com/nitrojs/nitro)
- [H3 Documentation](https://h3.unjs.io)
