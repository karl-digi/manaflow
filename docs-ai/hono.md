# Hono

Hono is a small, simple, and ultrafast web framework built on Web Standards. The name means "flame" in Japanese.

## Key Features

- **Ultrafast**: Uses RegExpRouter that avoids linear loops for optimal routing speed
- **Lightweight**: The `hono/tiny` preset is under 14KB with zero dependencies
- **Multi-Runtime**: Runs on Cloudflare Workers, Fastly Compute, Deno, Bun, Vercel, AWS Lambda, and Node.js
- **TypeScript First**: Full TypeScript support with type inference
- **Middleware**: Rich ecosystem of built-in and third-party middleware

## Installation

```sh
npm create hono@latest
# or
npm install hono
```

## Basic Usage

```ts
import { Hono } from 'hono'

const app = new Hono()

app.get('/', (c) => c.text('Hello Hono!'))

export default app
```

## Routing

### HTTP Methods

```ts
app.get('/users', (c) => c.text('GET /users'))
app.post('/users', (c) => c.text('POST /users'))
app.put('/users/:id', (c) => c.text('PUT /users/:id'))
app.delete('/users/:id', (c) => c.text('DELETE /users/:id'))

// Handle any method
app.all('/any', (c) => c.text('Any method'))

// Custom methods
app.on('PURGE', '/cache', (c) => c.text('PURGE'))
```

### Path Parameters

```ts
// Basic parameter
app.get('/user/:name', (c) => {
  const name = c.req.param('name')
  return c.text(`Hello ${name}`)
})

// Optional parameter
app.get('/api/animal/:type?', (c) => {
  const type = c.req.param('type') ?? 'unknown'
  return c.json({ type })
})

// Regex validation
app.get('/post/:date{[0-9]+}/:title{[a-z]+}', (c) => {
  const { date, title } = c.req.param()
  return c.json({ date, title })
})

// Wildcard
app.get('/posts/*', (c) => c.text('Wildcard match'))
```

### Route Grouping

```ts
const api = new Hono()

api.get('/users', (c) => c.json([]))
api.get('/posts', (c) => c.json([]))

// Mount under /api
app.route('/api', api)

// Base path
const v1 = new Hono().basePath('/v1')
v1.get('/users', (c) => c.json([]))
```

## Context (c)

The context object provides access to request data and response methods.

### Request Access

```ts
app.get('/users/:id', async (c) => {
  // Path parameters
  const id = c.req.param('id')

  // Query parameters
  const page = c.req.query('page')
  const tags = c.req.queries('tags') // Multiple values

  // Headers
  const auth = c.req.header('Authorization')

  // Body parsing
  const json = await c.req.json()
  const text = await c.req.text()
  const form = await c.req.formData()
  const parsed = await c.req.parseBody() // Handles multipart

  // Request metadata
  const path = c.req.path
  const method = c.req.method
  const url = c.req.url

  return c.json({ id })
})
```

### Response Methods

```ts
// Text response
app.get('/text', (c) => c.text('Hello'))

// JSON response
app.get('/json', (c) => c.json({ message: 'Hello' }))

// HTML response
app.get('/html', (c) => c.html('<h1>Hello</h1>'))

// Redirect
app.get('/old', (c) => c.redirect('/new'))
app.get('/temp', (c) => c.redirect('/new', 307))

// Custom status
app.get('/created', (c) => {
  c.status(201)
  return c.json({ created: true })
})

// Headers
app.get('/headers', (c) => {
  c.header('X-Custom', 'value')
  c.header('Cache-Control', 'no-cache')
  return c.text('With headers')
})

// Not found
app.get('/maybe', (c) => {
  if (!found) return c.notFound()
  return c.json(data)
})
```

### Request-Scoped Variables

```ts
type Variables = {
  user: { id: string; name: string }
}

const app = new Hono<{ Variables: Variables }>()

app.use(async (c, next) => {
  c.set('user', { id: '1', name: 'John' })
  await next()
})

app.get('/me', (c) => {
  const user = c.get('user')
  return c.json(user)
})
```

## Middleware

### Using Middleware

```ts
import { logger } from 'hono/logger'
import { cors } from 'hono/cors'
import { basicAuth } from 'hono/basic-auth'

// Global middleware
app.use(logger())

// Path-specific middleware
app.use('/api/*', cors())

// Protected routes
app.use('/admin/*', basicAuth({
  username: 'admin',
  password: 'secret'
}))
```

### Built-in Middleware

- `logger()` - Request logging
- `cors()` - CORS headers
- `basicAuth()` - Basic authentication
- `bearerAuth()` - Bearer token auth
- `jwt()` - JWT verification
- `etag()` - ETag support
- `compress()` - Response compression
- `cache()` - Cache control
- `prettyJSON()` - Formatted JSON
- `secureHeaders()` - Security headers

### Custom Middleware

```ts
import { createMiddleware } from 'hono/factory'

// Simple middleware
app.use(async (c, next) => {
  console.log('Before')
  await next()
  console.log('After')
})

// With type safety
const timing = createMiddleware(async (c, next) => {
  const start = Date.now()
  await next()
  const duration = Date.now() - start
  c.header('X-Response-Time', `${duration}ms`)
})

app.use(timing)
```

### Middleware Execution Order

Middleware executes in registration order. Pre-`next()` code runs first-to-last, post-`next()` code runs last-to-first:

```ts
app.use(async (c, next) => {
  console.log('1 - before')
  await next()
  console.log('1 - after') // Runs last
})

app.use(async (c, next) => {
  console.log('2 - before')
  await next()
  console.log('2 - after')
})
// Output: 1-before, 2-before, 2-after, 1-after
```

## Error Handling

```ts
// Custom 404
app.notFound((c) => {
  return c.text('Not Found', 404)
})

// Error handler
app.onError((err, c) => {
  console.error(err)
  return c.text('Internal Server Error', 500)
})

// HTTPException for controlled errors
import { HTTPException } from 'hono/http-exception'

app.get('/protected', (c) => {
  if (!authorized) {
    throw new HTTPException(401, { message: 'Unauthorized' })
  }
  return c.json({ data: 'secret' })
})
```

## HTML Helper

```ts
import { html, raw } from 'hono/html'

app.get('/', (c) => {
  const username = 'John'
  return c.html(
    html`<!DOCTYPE html>
      <html>
        <head><title>Hello</title></head>
        <body>
          <h1>Hello ${username}!</h1>
        </body>
      </html>`
  )
})

// Raw (unescaped) content
app.get('/raw', (c) => {
  const content = '<strong>Bold</strong>'
  return c.html(html`<p>${raw(content)}</p>`)
})
```

## JSX Support

```tsx
// Configure jsx in tsconfig.json
// "jsxImportSource": "hono/jsx"

import { Hono } from 'hono'

const app = new Hono()

const Layout = ({ children }: { children: any }) => (
  <html>
    <head><title>My App</title></head>
    <body>{children}</body>
  </html>
)

app.get('/', (c) => {
  return c.html(
    <Layout>
      <h1>Welcome</h1>
    </Layout>
  )
})
```

## Validation

```ts
import { validator } from 'hono/validator'
import { z } from 'zod'

const schema = z.object({
  name: z.string(),
  age: z.number()
})

app.post('/users',
  validator('json', (value, c) => {
    const result = schema.safeParse(value)
    if (!result.success) {
      return c.json({ error: result.error }, 400)
    }
    return result.data
  }),
  (c) => {
    const data = c.req.valid('json')
    return c.json({ created: data })
  }
)
```

## Testing

```ts
import { describe, it, expect } from 'vitest'

describe('API', () => {
  it('returns hello', async () => {
    const res = await app.request('/')
    expect(res.status).toBe(200)
    expect(await res.text()).toBe('Hello Hono!')
  })

  it('handles POST', async () => {
    const res = await app.request('/users', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ name: 'John' })
    })
    expect(res.status).toBe(201)
  })
})
```

## RPC Mode (Type-Safe Client)

```ts
// Server
import { Hono } from 'hono'

const app = new Hono()
  .get('/users', (c) => c.json([{ id: 1, name: 'John' }]))
  .post('/users', async (c) => {
    const body = await c.req.json()
    return c.json({ id: 2, ...body })
  })

export type AppType = typeof app

// Client
import { hc } from 'hono/client'
import type { AppType } from './server'

const client = hc<AppType>('http://localhost:8787')

const users = await client.users.$get()
const data = await users.json() // Typed response
```

## Environment Bindings (Cloudflare)

```ts
type Bindings = {
  MY_KV: KVNamespace
  DB: D1Database
}

const app = new Hono<{ Bindings: Bindings }>()

app.get('/data', async (c) => {
  const value = await c.env.MY_KV.get('key')
  return c.json({ value })
})
```

## References

- [Official Documentation](https://hono.dev/)
- [GitHub Repository](https://github.com/honojs/hono)
- [Middleware Repository](https://github.com/honojs/middleware)
