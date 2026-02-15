# Vite

Vite is a next-generation frontend build tool that provides an extremely fast development experience for modern web projects. It consists of two major parts: a dev server that serves source files over native ES modules with lightning-fast Hot Module Replacement (HMR), and a build command that bundles code with Rolldown for highly optimized production output. Vite supports TypeScript, JSX, CSS modules, and various CSS preprocessors out of the box.

Vite is designed to be framework-agnostic while offering first-party plugins for Vue and React. It leverages native ES modules during development to avoid costly bundling, making cold starts nearly instantaneous regardless of application size. For production builds, Vite pre-configures Rolldown with sensible defaults while remaining highly configurable through its Plugin API and JavaScript API.

## CLI Commands

### vite (Dev Server)

Start the Vite development server with hot module replacement and instant server start.

```bash
# Start dev server in current directory
npx vite

# Start with specific port and open browser
npx vite --port 3000 --open

# Start with custom config file
npx vite --config my-config.js

# Start with specific mode
npx vite --mode staging
```

### vite build

Build the application for production with optimized output.

```bash
# Basic production build
npx vite build

# Build with custom output directory
npx vite build --outDir build

# Build with sourcemaps
npx vite build --sourcemap

# Build for SSR
npx vite build --ssr src/entry-server.js

# Build with manifest for preload directives
npx vite build --manifest
```

### vite preview

Preview the production build locally before deployment.

```bash
# Preview the built application
npx vite preview

# Preview on specific port
npx vite preview --port 8080 --open
```

## Configuration

### defineConfig

Use the defineConfig helper to get TypeScript intellisense when configuring Vite.

```javascript
// vite.config.js
import { defineConfig } from 'vite'

export default defineConfig({
  root: './src',
  base: '/my-app/',
  publicDir: 'public',
  cacheDir: 'node_modules/.vite',

  resolve: {
    alias: {
      '@': '/src',
      'components': '/src/components'
    },
    extensions: ['.mjs', '.js', '.ts', '.jsx', '.tsx', '.json']
  },

  define: {
    __APP_VERSION__: JSON.stringify('1.0.0'),
    __API_URL__: JSON.stringify('https://api.example.com')
  },

  server: {
    port: 3000,
    open: true,
    cors: true,
    proxy: {
      '/api': {
        target: 'http://localhost:4000',
        changeOrigin: true,
        rewrite: (path) => path.replace(/^\/api/, '')
      }
    }
  },

  build: {
    outDir: 'dist',
    assetsDir: 'assets',
    sourcemap: true,
    minify: 'esbuild',
    target: 'es2015'
  }
})
```

### Conditional Configuration

Export a function for environment-specific configuration based on command and mode.

```javascript
// vite.config.js
import { defineConfig } from 'vite'

export default defineConfig(({ command, mode, isSsrBuild, isPreview }) => {
  const isDev = command === 'serve'
  const isProd = command === 'build'

  return {
    base: isProd ? '/production-path/' : '/',

    define: {
      __DEV__: isDev,
      __PROD__: isProd
    },

    build: {
      sourcemap: isDev,
      minify: isProd ? 'esbuild' : false
    },

    server: isDev ? {
      port: 3000,
      hmr: { overlay: true }
    } : undefined
  }
})
```

### Environment Variables

Load and use environment variables from .env files in configuration.

```javascript
// vite.config.js
import { defineConfig, loadEnv } from 'vite'

export default defineConfig(({ mode }) => {
  // Load env files from current directory
  // Third param '' loads all variables (not just VITE_ prefixed)
  const env = loadEnv(mode, process.cwd(), '')

  return {
    define: {
      __APP_ENV__: JSON.stringify(env.APP_ENV)
    },
    server: {
      port: env.PORT ? Number(env.PORT) : 5173
    }
  }
})

// .env file example:
// VITE_API_URL=https://api.example.com
// VITE_APP_TITLE=My App

// Access in application code:
// console.log(import.meta.env.VITE_API_URL)
// console.log(import.meta.env.MODE)
// console.log(import.meta.env.DEV)
// console.log(import.meta.env.PROD)
```

## JavaScript API

### createServer

Create a Vite dev server programmatically for custom integrations.

```javascript
import { createServer } from 'vite'

async function startDevServer() {
  const server = await createServer({
    configFile: false,
    root: process.cwd(),
    server: {
      port: 3000,
      strictPort: true,
      host: true
    },
    plugins: []
  })

  await server.listen()
  server.printUrls()
  server.bindCLIShortcuts({ print: true })

  // Access server properties
  console.log('Resolved config:', server.config)
  console.log('Module graph:', server.moduleGraph)

  // Programmatically transform files
  const result = await server.transformRequest('/src/main.js')
  console.log('Transformed code:', result?.code)

  // Transform HTML
  const html = await server.transformIndexHtml('/index.html', '<html>...</html>')

  // Graceful shutdown
  process.on('SIGTERM', async () => {
    await server.close()
    process.exit(0)
  })
}

startDevServer()
```

### build

Run production build programmatically with custom configuration.

```javascript
import { build } from 'vite'
import path from 'node:path'

async function buildProject() {
  const result = await build({
    root: path.resolve(import.meta.dirname, './project'),
    base: '/app/',
    build: {
      outDir: 'dist',
      emptyOutDir: true,
      sourcemap: true,
      rolldownOptions: {
        input: {
          main: path.resolve(import.meta.dirname, 'index.html'),
          admin: path.resolve(import.meta.dirname, 'admin.html')
        },
        output: {
          manualChunks: {
            vendor: ['react', 'react-dom']
          }
        }
      }
    }
  })

  console.log('Build complete:', result)
}

buildProject()
```

### preview

Start a preview server for the production build.

```javascript
import { preview } from 'vite'

async function startPreview() {
  const previewServer = await preview({
    preview: {
      port: 8080,
      open: true,
      strictPort: true
    }
  })

  previewServer.printUrls()
  previewServer.bindCLIShortcuts({ print: true })

  console.log('Preview server running at:', previewServer.resolvedUrls)
}

startPreview()
```

### resolveConfig and mergeConfig

Resolve and merge Vite configurations programmatically.

```javascript
import { resolveConfig, mergeConfig, defineConfig } from 'vite'

// Resolve full config from file
async function getResolvedConfig() {
  const config = await resolveConfig({}, 'build', 'production')
  console.log('Resolved config:', config)
  return config
}

// Merge two configs
const baseConfig = {
  plugins: [],
  resolve: { alias: { '@': '/src' } }
}

const productionConfig = {
  build: { minify: true },
  resolve: { alias: { 'utils': '/src/utils' } }
}

const mergedConfig = mergeConfig(baseConfig, productionConfig)
// Result: { plugins: [], resolve: { alias: { '@': '/src', 'utils': '/src/utils' } }, build: { minify: true } }

// Merge callback config with object config
const callbackConfig = defineConfig(({ mode }) => ({
  define: { __MODE__: JSON.stringify(mode) }
}))

export default defineConfig((configEnv) =>
  mergeConfig(callbackConfig(configEnv), { base: '/app/' })
)
```

## Plugin API

### Basic Plugin Structure

Create a Vite plugin to transform files, inject content, or configure the build.

```javascript
// vite-plugin-example.js
export default function myPlugin(options = {}) {
  return {
    name: 'vite-plugin-example',

    // Modify Vite config
    config(config, { command, mode }) {
      return {
        resolve: {
          alias: { 'my-alias': '/src/custom' }
        }
      }
    },

    // Access resolved config
    configResolved(resolvedConfig) {
      console.log('Build command:', resolvedConfig.command)
    },

    // Transform source code
    transform(code, id) {
      if (id.endsWith('.custom')) {
        return {
          code: `export default ${JSON.stringify(code)}`,
          map: null
        }
      }
    },

    // Resolve custom imports
    resolveId(source) {
      if (source === 'virtual:my-module') {
        return '\0virtual:my-module'
      }
    },

    // Load virtual modules
    load(id) {
      if (id === '\0virtual:my-module') {
        return `export const msg = "Hello from virtual module"`
      }
    }
  }
}

// Usage in vite.config.js
import myPlugin from './vite-plugin-example.js'

export default defineConfig({
  plugins: [myPlugin({ debug: true })]
})
```

### Server Configuration Hook

Configure the dev server with custom middleware.

```javascript
export default function serverPlugin() {
  return {
    name: 'server-plugin',

    configureServer(server) {
      // Add middleware before Vite's internal middlewares
      server.middlewares.use((req, res, next) => {
        if (req.url === '/api/health') {
          res.writeHead(200, { 'Content-Type': 'application/json' })
          res.end(JSON.stringify({ status: 'ok' }))
          return
        }
        next()
      })

      // Return function to add middleware after internal middlewares
      return () => {
        server.middlewares.use((req, res, next) => {
          // Post middleware logic
          next()
        })
      }
    },

    configurePreviewServer(server) {
      server.middlewares.use((req, res, next) => {
        // Preview server middleware
        next()
      })
    }
  }
}
```

### HTML Transform Hook

Transform HTML during development and build.

```javascript
export default function htmlPlugin() {
  return {
    name: 'html-transform',

    transformIndexHtml: {
      order: 'pre', // or 'post', or undefined (default)
      handler(html, ctx) {
        // Return transformed HTML string
        return html.replace(
          '</head>',
          `<script>window.BUILD_TIME = "${new Date().toISOString()}"</script></head>`
        )
      }
    }
  }
}

// Or inject tags
export default function injectTagsPlugin() {
  return {
    name: 'inject-tags',

    transformIndexHtml() {
      return [
        {
          tag: 'script',
          attrs: { src: '/analytics.js' },
          injectTo: 'body'
        },
        {
          tag: 'link',
          attrs: { rel: 'stylesheet', href: '/custom.css' },
          injectTo: 'head'
        },
        {
          tag: 'meta',
          attrs: { name: 'version', content: '1.0.0' },
          injectTo: 'head-prepend'
        }
      ]
    }
  }
}
```

### HMR Handling Hook

Handle custom hot module replacement logic.

```javascript
export default function hmrPlugin() {
  return {
    name: 'hmr-plugin',

    handleHotUpdate({ file, server, modules, timestamp }) {
      if (file.endsWith('.config.json')) {
        // Trigger full reload for config changes
        server.ws.send({ type: 'full-reload' })
        return []
      }

      if (file.endsWith('.custom')) {
        // Send custom event to client
        server.ws.send({
          type: 'custom',
          event: 'custom-update',
          data: { file, timestamp }
        })
        return []
      }

      // Return filtered modules for standard HMR
      return modules.filter(m => !m.id?.includes('node_modules'))
    }
  }
}
```

## HMR API

### Self-Accepting Module

Enable hot module replacement for a module that handles its own updates.

```javascript
// counter.js
export let count = 0

export function increment() {
  count++
  render()
}

function render() {
  document.getElementById('count').textContent = count
}

render()

// HMR handling
if (import.meta.hot) {
  // Preserve state across updates
  import.meta.hot.accept((newModule) => {
    if (newModule) {
      // newModule is undefined on syntax errors
      console.log('Module updated, new count:', newModule.count)
    }
  })

  // Clean up side effects before module replacement
  import.meta.hot.dispose((data) => {
    // Save state for next module instance
    data.savedCount = count
  })

  // Restore state from previous module
  if (import.meta.hot.data.savedCount !== undefined) {
    count = import.meta.hot.data.savedCount
    render()
  }
}
```

### Accepting Dependencies

Accept updates from specific dependencies without full reload.

```javascript
// main.js
import { render } from './render.js'
import { theme } from './theme.js'

render(theme)

if (import.meta.hot) {
  // Accept single dependency
  import.meta.hot.accept('./theme.js', (newTheme) => {
    render(newTheme?.theme)
  })

  // Accept multiple dependencies
  import.meta.hot.accept(['./render.js', './theme.js'], ([newRender, newTheme]) => {
    const renderFn = newRender?.render || render
    const currentTheme = newTheme?.theme || theme
    renderFn(currentTheme)
  })
}
```

### HMR Events

Listen to HMR lifecycle events for custom handling.

```javascript
if (import.meta.hot) {
  // Before update is applied
  import.meta.hot.on('vite:beforeUpdate', (payload) => {
    console.log('About to update:', payload)
  })

  // After update is applied
  import.meta.hot.on('vite:afterUpdate', (payload) => {
    console.log('Update complete:', payload)
  })

  // Before full page reload
  import.meta.hot.on('vite:beforeFullReload', () => {
    console.log('Full reload triggered')
  })

  // On HMR error
  import.meta.hot.on('vite:error', (payload) => {
    console.error('HMR error:', payload)
  })

  // Custom events from plugins
  import.meta.hot.on('custom-update', (data) => {
    console.log('Custom update:', data)
  })

  // Send message to server
  import.meta.hot.send('my-event', { message: 'hello' })
}
```

## Server-Side Rendering

### SSR Dev Server Setup

Set up Vite in middleware mode for SSR development.

```javascript
// server.js
import express from 'express'
import { createServer as createViteServer } from 'vite'
import fs from 'node:fs'
import path from 'node:path'

async function createServer() {
  const app = express()

  const vite = await createViteServer({
    server: { middlewareMode: true },
    appType: 'custom'
  })

  app.use(vite.middlewares)

  app.use('*all', async (req, res, next) => {
    const url = req.originalUrl

    try {
      // Read and transform index.html
      let template = fs.readFileSync(
        path.resolve(import.meta.dirname, 'index.html'),
        'utf-8'
      )
      template = await vite.transformIndexHtml(url, template)

      // Load server entry with HMR support
      const { render } = await vite.ssrLoadModule('/src/entry-server.js')

      // Render app to HTML
      const appHtml = await render(url)

      // Inject rendered HTML
      const html = template.replace('<!--ssr-outlet-->', appHtml)

      res.status(200).set({ 'Content-Type': 'text/html' }).end(html)
    } catch (e) {
      vite.ssrFixStacktrace(e)
      next(e)
    }
  })

  app.listen(5173)
}

createServer()

// entry-server.js example
import { renderToString } from 'react-dom/server'
import App from './App'

export async function render(url) {
  return renderToString(<App url={url} />)
}
```

### Production SSR Build

Configure separate client and server builds for production SSR.

```javascript
// vite.config.js
import { defineConfig } from 'vite'

export default defineConfig({
  build: {
    // For client build
    outDir: 'dist/client',
    manifest: true,
    ssrManifest: true
  }
})

// package.json scripts
// "build:client": "vite build --outDir dist/client --ssrManifest"
// "build:server": "vite build --outDir dist/server --ssr src/entry-server.js"

// Production server.js
import express from 'express'
import fs from 'node:fs'
import path from 'node:path'
import sirv from 'sirv'

const isProduction = process.env.NODE_ENV === 'production'

async function createServer() {
  const app = express()

  if (isProduction) {
    // Serve static files
    app.use(sirv('dist/client', { extensions: [] }))
  }

  app.use('*all', async (req, res) => {
    const url = req.originalUrl

    const template = fs.readFileSync(
      isProduction
        ? 'dist/client/index.html'
        : 'index.html',
      'utf-8'
    )

    const { render } = isProduction
      ? await import('./dist/server/entry-server.js')
      : await vite.ssrLoadModule('/src/entry-server.js')

    const appHtml = await render(url)
    const html = template.replace('<!--ssr-outlet-->', appHtml)

    res.status(200).set({ 'Content-Type': 'text/html' }).end(html)
  })

  app.listen(5173)
}

createServer()
```

## Build Configuration

### Library Mode

Build a library for distribution with multiple output formats.

```javascript
// vite.config.js
import { defineConfig } from 'vite'
import { resolve } from 'node:path'

export default defineConfig({
  build: {
    lib: {
      entry: resolve(import.meta.dirname, 'lib/main.js'),
      name: 'MyLib', // UMD global name
      fileName: (format) => `my-lib.${format}.js`,
      formats: ['es', 'umd', 'cjs']
    },
    rolldownOptions: {
      external: ['vue', 'react', 'react-dom'],
      output: {
        globals: {
          vue: 'Vue',
          react: 'React',
          'react-dom': 'ReactDOM'
        }
      }
    }
  }
})

// package.json for library
// {
//   "name": "my-lib",
//   "type": "module",
//   "files": ["dist"],
//   "main": "./dist/my-lib.umd.cjs",
//   "module": "./dist/my-lib.es.js",
//   "exports": {
//     ".": {
//       "import": "./dist/my-lib.es.js",
//       "require": "./dist/my-lib.umd.cjs"
//     },
//     "./style.css": "./dist/my-lib.css"
//   }
// }
```

### Multi-Page Application

Configure builds for applications with multiple HTML entry points.

```javascript
// vite.config.js
import { defineConfig } from 'vite'
import { resolve } from 'node:path'

export default defineConfig({
  build: {
    rolldownOptions: {
      input: {
        main: resolve(import.meta.dirname, 'index.html'),
        admin: resolve(import.meta.dirname, 'admin/index.html'),
        login: resolve(import.meta.dirname, 'auth/login.html')
      }
    }
  }
})

// Project structure:
// ├── index.html
// ├── admin/
// │   └── index.html
// ├── auth/
// │   └── login.html
// └── src/
//     ├── main.js
//     ├── admin.js
//     └── login.js
```

## Asset Handling

### Static Asset Imports

Import and reference static assets with various query modifiers.

```javascript
// Import as URL (resolved public path)
import imageUrl from './image.png'
document.getElementById('hero').src = imageUrl

// Import as raw string
import shaderSource from './shader.glsl?raw'
gl.shaderSource(shader, shaderSource)

// Import as URL explicitly
import assetUrl from './data.json?url'
fetch(assetUrl).then(r => r.json())

// Web Workers
import Worker from './worker.js?worker'
const worker = new Worker()

// Inline worker as base64
import InlineWorker from './worker.js?worker&inline'

// Import JSON with named exports
import { version, name } from './package.json'
console.log(`${name}@${version}`)

// Glob import
const modules = import.meta.glob('./modules/*.js')
for (const path in modules) {
  modules[path]().then(mod => console.log(path, mod))
}

// Glob with eager loading
const eagerModules = import.meta.glob('./modules/*.js', { eager: true })

// Glob with named imports
const setups = import.meta.glob('./modules/*.js', {
  import: 'setup',
  eager: true
})
```

### CSS Handling

Import and use CSS with modules, preprocessors, and special features.

```javascript
// Regular CSS import
import './styles.css'

// CSS Modules
import styles from './component.module.css'
element.className = styles.container

// With camelCase conversion configured
import { myClassName } from './component.module.css'

// Inline CSS (no injection)
import cssText from './styles.css?inline'
const style = document.createElement('style')
style.textContent = cssText
document.head.appendChild(style)

// vite.config.js CSS configuration
export default defineConfig({
  css: {
    modules: {
      localsConvention: 'camelCaseOnly',
      generateScopedName: '[name]__[local]___[hash:base64:5]'
    },
    preprocessorOptions: {
      scss: {
        additionalData: `@import "@/styles/variables.scss";`
      },
      less: {
        math: 'parens-division'
      }
    },
    devSourcemap: true
  }
})
```

## TypeScript Support

### TypeScript Configuration

Configure TypeScript with proper types and compilation settings.

```json
// tsconfig.json
{
  "compilerOptions": {
    "target": "ES2020",
    "useDefineForClassFields": true,
    "module": "ESNext",
    "lib": ["ES2020", "DOM", "DOM.Iterable"],
    "skipLibCheck": true,
    "moduleResolution": "bundler",
    "allowImportingTsExtensions": true,
    "resolveJsonModule": true,
    "isolatedModules": true,
    "noEmit": true,
    "strict": true,
    "types": ["vite/client"]
  },
  "include": ["src"]
}
```

```typescript
// vite-env.d.ts
/// <reference types="vite/client" />

// Extend ImportMeta for custom env variables
interface ImportMetaEnv {
  readonly VITE_API_URL: string
  readonly VITE_APP_TITLE: string
}

interface ImportMeta {
  readonly env: ImportMetaEnv
}

// Custom module declarations
declare module '*.svg' {
  const content: string
  export default content
}

declare module 'virtual:my-module' {
  export const data: string
}
```

Vite excels at providing a unified development and build experience for modern web applications. Its primary use cases include developing single-page applications with frameworks like Vue, React, or Svelte; building JavaScript libraries for distribution; server-side rendering with frameworks; and creating multi-page applications. The plugin system enables deep integration with build tools and frameworks.

For integration patterns, Vite works seamlessly with backend frameworks through middleware mode, supports custom server configurations for SSR, and provides programmatic APIs for build tool orchestration. The consistent configuration between development and production environments ensures reliable deployments. Teams can extend Vite through plugins that tap into the Rolldown/Rollup ecosystem while leveraging Vite-specific hooks for dev server customization.
