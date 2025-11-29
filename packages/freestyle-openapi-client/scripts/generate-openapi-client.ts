import { createClient } from '@hey-api/openapi-ts'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const OPENAPI_SPEC_URL = 'https://api.freestyle.sh/openapi.json'

const __dirname = path.dirname(fileURLToPath(import.meta.url))
const packageRoot = path.join(__dirname, '..')
const outputPath = path.join(packageRoot, 'src/client')
const tsConfigPath = path.join(packageRoot, 'tsconfig.json')

await fs.promises.mkdir(outputPath, { recursive: true })

console.time('freestyle:download-openapi')
const response = await fetch(OPENAPI_SPEC_URL)
if (!response.ok) {
  throw new Error(
    `Failed to download Freestyle OpenAPI spec (${response.status} ${response.statusText})`
  )
}
const rawSpec = await response.text()
console.timeEnd('freestyle:download-openapi')

let specBody = rawSpec
try {
  let parsed = JSON.parse(rawSpec)
  // Handle double-encoded JSON (API returns a JSON string containing the spec)
  if (typeof parsed === 'string') {
    parsed = JSON.parse(parsed)
  }
  if (!Array.isArray(parsed.servers) || parsed.servers.length === 0) {
    parsed.servers = [{ url: 'https://api.freestyle.sh' }]
  }
  specBody = JSON.stringify(parsed)
} catch {
  // Leave as-is if the spec is not JSON
}

const tmpFile = path.join(
  os.tmpdir(),
  `freestyle-openapi-${process.pid}-${Date.now()}-${Math.random()
    .toString(36)
    .slice(2)}.json`
)

await fs.promises.writeFile(tmpFile, specBody)

try {
  console.time('freestyle:generate-client')
  await createClient({
    input: tmpFile,
    output: {
      path: outputPath,
      tsConfigPath,
    },
    plugins: [
      '@hey-api/client-fetch',
      '@hey-api/typescript',
      '@hey-api/sdk',
    ],
  })
  console.timeEnd('freestyle:generate-client')
} finally {
  await fs.promises.rm(tmpFile, { force: true })
}

console.log('[freestyle] OpenAPI client generated at', outputPath)
