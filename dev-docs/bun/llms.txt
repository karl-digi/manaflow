# Bun

Bun is an all-in-one JavaScript and TypeScript toolkit designed for speed. It ships as a single executable called `bun` and serves as a drop-in replacement for Node.js. Built with Zig and powered by JavaScriptCore, Bun dramatically reduces startup times and memory usage compared to traditional JavaScript runtimes. The toolkit includes a fast JavaScript runtime, a bundler, a test runner, and a Node.js-compatible package manager.

At its core, Bun provides native implementations of common JavaScript APIs, built-in TypeScript and JSX support, and seamless integration with existing Node.js projects. It supports ES modules, CommonJS, and offers extensive compatibility with the Node.js ecosystem while providing Bun-specific APIs for file I/O, HTTP servers, SQLite databases, shell scripting, and more.

## HTTP Server - Bun.serve()

Create high-performance HTTP servers with built-in routing, WebSocket support, and automatic request handling. The `Bun.serve()` API uses a simple configuration object with route handlers that can return Response objects, files, or redirects.

```typescript
import { Database } from "bun:sqlite";

const db = new Database(":memory:");
db.exec(`
  CREATE TABLE IF NOT EXISTS users (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    name TEXT NOT NULL,
    email TEXT UNIQUE
  )
`);

const server = Bun.serve({
  port: 3000,

  routes: {
    // Static response
    "/api/health": new Response("OK"),

    // Dynamic route with params
    "/api/users/:id": (req) => {
      const user = db.query("SELECT * FROM users WHERE id = ?").get(req.params.id);
      if (!user) return new Response("Not Found", { status: 404 });
      return Response.json(user);
    },

    // Per-method handlers
    "/api/users": {
      GET: () => {
        const users = db.query("SELECT * FROM users").all();
        return Response.json(users);
      },
      POST: async (req) => {
        const { name, email } = await req.json();
        const result = db.query("INSERT INTO users (name, email) VALUES (?, ?)").run(name, email);
        return Response.json({ id: result.lastInsertRowid, name, email }, { status: 201 });
      },
    },

    // Serve static files
    "/favicon.ico": Bun.file("./public/favicon.ico"),

    // Wildcard catch-all
    "/api/*": Response.json({ error: "Not found" }, { status: 404 }),
  },

  // Fallback handler for unmatched routes
  fetch(req) {
    return new Response("Not Found", { status: 404 });
  },

  // Error handler
  error(error) {
    console.error(error);
    return new Response("Internal Server Error", { status: 500 });
  },
});

console.log(`Server running at ${server.url}`);

// Hot reload routes without restart
server.reload({
  routes: {
    "/api/version": () => Response.json({ version: "2.0.0" }),
  },
});

// Gracefully stop the server
// await server.stop();
```

## File I/O - Bun.file() and Bun.write()

Read and write files with optimized system calls. `Bun.file()` creates lazy-loaded file references that conform to the Blob interface, while `Bun.write()` handles various input types and automatically selects the fastest system calls.

```typescript
// Reading files - Bun.file() returns a lazy BunFile (Blob)
const file = Bun.file("./config.json");
console.log(`Size: ${file.size} bytes`);
console.log(`Type: ${file.type}`);

// Check if file exists
const exists = await file.exists();

// Read in various formats
const text = await file.text();           // string
const json = await file.json();           // parsed JSON
const buffer = await file.arrayBuffer();  // ArrayBuffer
const bytes = await file.bytes();         // Uint8Array
const stream = file.stream();             // ReadableStream

// Writing files - Bun.write() handles multiple input types
await Bun.write("output.txt", "Hello, World!");
await Bun.write("data.json", JSON.stringify({ key: "value" }));
await Bun.write("copy.txt", Bun.file("original.txt"));  // Copy file

// Write HTTP response body to file
const response = await fetch("https://example.com");
await Bun.write("page.html", response);

// Write binary data
const encoder = new TextEncoder();
await Bun.write("binary.dat", encoder.encode("binary data"));

// Incremental writing with FileSink
const writer = Bun.file("log.txt").writer({ highWaterMark: 1024 * 1024 });
writer.write("Line 1\n");
writer.write("Line 2\n");
writer.flush();  // Flush buffer to disk
writer.end();    // Close the file

// Delete a file
await Bun.file("temp.txt").delete();

// Write to stdout
await Bun.write(Bun.stdout, "Output to terminal\n");
```

## SQLite Database - bun:sqlite

Native high-performance SQLite3 driver with prepared statements, transactions, and type-safe query results. The API is synchronous for simplicity and performance, with support for mapping results to custom classes.

```typescript
import { Database } from "bun:sqlite";

// Create/open database
const db = new Database("myapp.db");  // File-based
// const db = new Database(":memory:");  // In-memory

// Enable WAL mode for better performance
db.run("PRAGMA journal_mode = WAL;");

// Create tables
db.run(`
  CREATE TABLE IF NOT EXISTS posts (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    title TEXT NOT NULL,
    content TEXT,
    author_id INTEGER,
    created_at TEXT DEFAULT CURRENT_TIMESTAMP
  )
`);

// Prepared statements with .query() (cached)
const insertPost = db.query("INSERT INTO posts (title, content, author_id) VALUES ($title, $content, $authorId)");
const result = insertPost.run({ $title: "Hello", $content: "World", $authorId: 1 });
console.log(`Inserted row ${result.lastInsertRowid}, ${result.changes} rows affected`);

// Query methods
const allPosts = db.query("SELECT * FROM posts WHERE author_id = ?").all(1);      // Array of objects
const onePost = db.query("SELECT * FROM posts WHERE id = ?").get(1);              // Single object or null
const values = db.query("SELECT id, title FROM posts").values();                  // Array of arrays
const { changes } = db.query("DELETE FROM posts WHERE id = ?").run(999);          // Execute, get metadata

// Iterate over large result sets
for (const post of db.query("SELECT * FROM posts").iterate()) {
  console.log(post.title);
}

// Map results to a class
class Post {
  id!: number;
  title!: string;
  content!: string;

  get summary() {
    return this.content?.substring(0, 100) + "...";
  }
}

const typedPosts = db.query("SELECT * FROM posts").as(Post).all();
console.log(typedPosts[0].summary);

// Transactions
const insertMany = db.transaction((posts: { title: string; content: string }[]) => {
  const insert = db.prepare("INSERT INTO posts (title, content) VALUES (?, ?)");
  for (const post of posts) {
    insert.run(post.title, post.content);
  }
  return posts.length;
});

const count = insertMany([
  { title: "Post 1", content: "Content 1" },
  { title: "Post 2", content: "Content 2" },
]);

// Using statement with auto-cleanup
{
  using stmt = db.query("SELECT * FROM posts");
  console.log(stmt.all());
}  // stmt is automatically finalized

// Serialize/deserialize database
const backup = db.serialize();  // Uint8Array
const restored = Database.deserialize(backup);

db.close();
```

## SQL Client - Bun.sql

Unified SQL client supporting PostgreSQL, MySQL, and SQLite with tagged template literals, connection pooling, and automatic SQL injection protection.

```typescript
import { sql, SQL } from "bun";

// PostgreSQL (uses DATABASE_URL or defaults)
const users = await sql`SELECT * FROM users WHERE active = ${true} LIMIT ${10}`;

// Explicit connections
const pg = new SQL("postgres://user:pass@localhost:5432/mydb");
const mysql = new SQL("mysql://user:pass@localhost:3306/mydb");
const sqlite = new SQL("sqlite://myapp.db");

// Tagged template queries (auto-parameterized, SQL injection safe)
const userId = 1;
const user = await pg`SELECT * FROM users WHERE id = ${userId}`;

// Bulk insert
const newUsers = [
  { name: "Alice", email: "alice@example.com" },
  { name: "Bob", email: "bob@example.com" },
];
await pg`INSERT INTO users ${pg(newUsers)}`;

// Transactions
await pg.begin(async (tx) => {
  const [user] = await tx`INSERT INTO users (name) VALUES (${"Charlie"}) RETURNING *`;
  await tx`INSERT INTO profiles (user_id, bio) VALUES (${user.id}, ${"Developer"})`;
});

// Savepoints (nested transactions)
await pg.begin(async (tx) => {
  await tx`UPDATE accounts SET balance = balance - 100 WHERE id = ${1}`;

  await tx.savepoint(async (sp) => {
    await sp`UPDATE inventory SET quantity = quantity - 1 WHERE product_id = ${42}`;
    // If this throws, only the savepoint is rolled back
  });
});

// Close connections when done
await pg.end();
```

## Shell Scripting - Bun.$

Cross-platform bash-like shell with JavaScript interop. Template literals provide safe string interpolation with automatic escaping to prevent injection attacks.

```typescript
import { $ } from "bun";

// Basic commands
await $`echo "Hello, World!"`;

// Capture output
const result = await $`ls -la`.text();
console.log(result);

// Parse JSON output
const pkg = await $`cat package.json`.json();
console.log(pkg.name);

// Read lines
for await (const line of $`cat file.txt`.lines()) {
  console.log(line);
}

// Piping
const count = await $`cat README.md | wc -l`.text();

// Safe interpolation (automatically escaped)
const filename = "my file.txt; rm -rf /";  // Malicious input is safely escaped
await $`cat ${filename}`;  // Safe!

// Environment variables
await $`FOO=bar bun -e 'console.log(process.env.FOO)'`;

// Change working directory
await $`pwd`.cwd("/tmp");

// Set environment for all commands
$.env({ NODE_ENV: "production" });
$.cwd("/app");

// Error handling
try {
  await $`exit 1`;
} catch (err) {
  console.log(`Exit code: ${err.exitCode}`);
  console.log(`stderr: ${err.stderr.toString()}`);
}

// Disable throwing on non-zero exit
const { exitCode } = await $`exit 1`.nothrow();
if (exitCode !== 0) console.log("Command failed");

// Redirect to files and JavaScript objects
await $`echo "log" > output.txt`;
await $`echo "error" 2> errors.txt`;

const buffer = Buffer.alloc(100);
await $`echo "hello" > ${buffer}`;

// Pipe from Response
const response = await fetch("https://example.com");
await $`cat < ${response} | wc -c`;

// Built-in cross-platform commands: ls, cd, rm, mkdir, cat, echo, pwd, touch, mv, which
```

## Child Processes - Bun.spawn()

Spawn and manage child processes with streaming I/O, IPC communication, and PTY support for terminal applications.

```typescript
// Basic spawn
const proc = Bun.spawn(["bun", "--version"]);
console.log(await proc.exited);  // Exit code

// With options
const proc2 = Bun.spawn(["node", "script.js"], {
  cwd: "./project",
  env: { ...process.env, NODE_ENV: "test" },
  stdout: "pipe",
  stderr: "pipe",
  onExit(proc, exitCode, signalCode, error) {
    console.log(`Exited with ${exitCode}`);
  },
});

// Read stdout
const output = await proc2.stdout.text();
console.log(output);

// Streaming stdin
const cat = Bun.spawn(["cat"], { stdin: "pipe" });
cat.stdin.write("Hello ");
cat.stdin.write("World!");
cat.stdin.end();
console.log(await cat.stdout.text());

// Pipe from fetch response
const download = Bun.spawn(["cat"], {
  stdin: await fetch("https://example.com"),
});

// Synchronous spawn
const result = Bun.spawnSync(["echo", "hello"]);
console.log(result.stdout.toString());  // "hello\n"
console.log(result.success);  // true

// With timeout
const timedProc = Bun.spawn({
  cmd: ["sleep", "10"],
  timeout: 5000,  // Kill after 5 seconds
  killSignal: "SIGKILL",
});

// IPC between Bun processes
// parent.ts
const child = Bun.spawn(["bun", "child.ts"], {
  ipc(message) {
    console.log("From child:", message);
    child.send({ reply: "Hello child!" });
  },
});
child.send({ greeting: "Hello from parent" });

// child.ts
process.on("message", (msg) => {
  console.log("From parent:", msg);
  process.send({ received: true });
});

// Kill and cleanup
proc.kill();
proc.kill("SIGTERM");
proc.unref();  // Don't keep process alive
```

## Bundler - Bun.build()

Fast native bundler for JavaScript, TypeScript, and JSX with tree-shaking, code splitting, and plugin support.

```typescript
// Basic build
const result = await Bun.build({
  entrypoints: ["./src/index.tsx"],
  outdir: "./dist",
});

if (!result.success) {
  console.error("Build failed:", result.logs);
}

// Full configuration
await Bun.build({
  entrypoints: ["./src/index.tsx", "./src/worker.ts"],
  outdir: "./dist",
  target: "browser",  // "browser" | "bun" | "node"
  format: "esm",      // "esm" | "cjs" | "iife"

  // Code splitting
  splitting: true,

  // Minification
  minify: true,
  // Or granular:
  // minify: { whitespace: true, syntax: true, identifiers: true },

  // Source maps
  sourcemap: "linked",  // "none" | "linked" | "inline" | "external"

  // External packages (not bundled)
  external: ["react", "react-dom"],

  // Environment variables
  env: "inline",  // Inline process.env values

  // Define globals
  define: {
    "process.env.API_URL": JSON.stringify("https://api.example.com"),
  },

  // Custom naming
  naming: {
    entry: "[dir]/[name]-[hash].[ext]",
    chunk: "chunks/[name]-[hash].[ext]",
    asset: "assets/[name]-[hash].[ext]",
  },

  // Drop console/debugger in production
  drop: ["console", "debugger"],

  // Banner/footer
  banner: '"use client";',
  footer: "// Built with Bun",
});

// Build artifacts
for (const output of result.outputs) {
  console.log(`${output.kind}: ${output.path} (${output.size} bytes)`);

  // Artifacts are Blobs
  const content = await output.text();

  // Use in Response
  new Response(output);  // Content-Type auto-set
}

// CLI equivalent
// bun build ./src/index.tsx --outdir ./dist --minify --splitting --sourcemap=linked
```

## Test Runner - bun:test

Fast, Jest-compatible test runner with TypeScript support, mocking, snapshots, and watch mode.

```typescript
import { test, expect, describe, beforeAll, afterEach, mock, spyOn } from "bun:test";

// Basic test
test("2 + 2 = 4", () => {
  expect(2 + 2).toBe(4);
});

// Async test
test("fetch data", async () => {
  const response = await fetch("https://api.example.com/data");
  expect(response.ok).toBe(true);
});

// Test groups
describe("Math operations", () => {
  test("addition", () => expect(1 + 1).toBe(2));
  test("multiplication", () => expect(2 * 3).toBe(6));
});

// Lifecycle hooks
let db: Database;
beforeAll(() => {
  db = new Database(":memory:");
});
afterEach(() => {
  db.run("DELETE FROM users");
});

// Matchers
test("matchers", () => {
  expect(5).toBeGreaterThan(3);
  expect([1, 2, 3]).toContain(2);
  expect({ a: 1 }).toEqual({ a: 1 });
  expect("hello").toMatch(/ell/);
  expect(() => { throw new Error("oops"); }).toThrow("oops");
  expect(Promise.resolve(42)).resolves.toBe(42);
});

// Mocking functions
const mockFn = mock((x: number) => x * 2);
mockFn(5);
expect(mockFn).toHaveBeenCalledWith(5);
expect(mockFn).toHaveBeenCalledTimes(1);
expect(mockFn.mock.results[0].value).toBe(10);

// Spying on methods
const obj = { method: (x: number) => x + 1 };
const spy = spyOn(obj, "method");
obj.method(5);
expect(spy).toHaveBeenCalled();

// Snapshot testing
test("snapshot", () => {
  const data = { users: [{ name: "Alice" }] };
  expect(data).toMatchSnapshot();
});

// Skip and todo
test.skip("skipped test", () => {});
test.todo("implement later");

// Concurrent tests
test.concurrent("parallel test 1", async () => { /* ... */ });
test.concurrent("parallel test 2", async () => { /* ... */ });

// CLI: bun test
// CLI: bun test --watch
// CLI: bun test --coverage
// CLI: bun test -t "pattern"
```

## Hashing and Passwords

Cryptographic hashing with `Bun.CryptoHasher` and secure password hashing with `Bun.password` using argon2 or bcrypt.

```typescript
// Password hashing (argon2id by default)
const password = "super-secure-password";
const hash = await Bun.password.hash(password);
// $argon2id$v=19$m=65536,t=2,p=1$...

const isValid = await Bun.password.verify(password, hash);
console.log(isValid);  // true

// With bcrypt
const bcryptHash = await Bun.password.hash(password, {
  algorithm: "bcrypt",
  cost: 10,
});

// Synchronous versions (blocking)
const hashSync = Bun.password.hashSync(password);
const validSync = Bun.password.verifySync(password, hashSync);

// Cryptographic hashing
const hasher = new Bun.CryptoHasher("sha256");
hasher.update("hello ");
hasher.update("world");
const digest = hasher.digest("hex");
// b94d27b9934d3e08a52e52d7da7dabfac484efe37a5380ee9088f7ace2efcde9

// One-liner
const sha256 = new Bun.CryptoHasher("sha256").update("data").digest("base64");

// Supported algorithms: md5, sha1, sha256, sha384, sha512, sha3-256, blake2b256, etc.

// HMAC
const hmac = new Bun.CryptoHasher("sha256", "secret-key");
hmac.update("message");
console.log(hmac.digest("hex"));

// Fast non-cryptographic hashing
Bun.hash("data");                    // Wyhash (default)
Bun.hash.crc32("data");
Bun.hash.xxHash64("data");
Bun.hash.murmur32v3("data");
```

## WebSocket Server

Built-in WebSocket support with pub/sub, per-socket data, and compression.

```typescript
const server = Bun.serve({
  port: 3000,

  fetch(req, server) {
    // Upgrade HTTP to WebSocket
    const upgraded = server.upgrade(req, {
      data: {
        username: new URL(req.url).searchParams.get("user"),
        joinedAt: Date.now(),
      },
    });

    if (upgraded) return;  // Upgrade successful
    return new Response("Expected WebSocket", { status: 400 });
  },

  websocket: {
    open(ws) {
      console.log(`${ws.data.username} connected`);
      ws.subscribe("chat");
      ws.publish("chat", `${ws.data.username} joined`);
    },

    message(ws, message) {
      // Broadcast to all subscribers
      ws.publish("chat", `${ws.data.username}: ${message}`);
    },

    close(ws) {
      ws.publish("chat", `${ws.data.username} left`);
      ws.unsubscribe("chat");
    },

    // Optional handlers
    drain(ws) {
      console.log("Backpressure relieved");
    },

    // Configuration
    maxPayloadLength: 16 * 1024 * 1024,  // 16MB
    idleTimeout: 120,  // seconds
    perMessageDeflate: true,  // compression
  },
});

// Server-side publish to all subscribers
server.publish("chat", "Server announcement!");
console.log(`${server.subscriberCount("chat")} users in chat`);
```

## Package Manager

Bun includes a fast npm-compatible package manager with workspaces, lockfile support, and lifecycle scripts.

```bash
# Install dependencies (reads package.json)
bun install

# Add packages
bun add express
bun add -d typescript          # dev dependency
bun add -g create-vite         # global

# Remove packages
bun remove lodash

# Update packages
bun update
bun update react

# Run scripts from package.json
bun run build
bun run dev

# Execute packages without installing
bunx create-vite my-app
bunx cowsay "Hello"

# Workspaces
bun install --filter "packages/*"

# Lock file
bun install --frozen-lockfile  # CI mode
```

## Summary

Bun provides a comprehensive JavaScript/TypeScript development experience with its integrated runtime, bundler, test runner, and package manager. The main use cases include building high-performance HTTP servers and APIs with `Bun.serve()`, working with SQLite databases via `bun:sqlite`, executing shell commands cross-platform with `Bun.$`, spawning child processes with `Bun.spawn()`, and bundling applications for production with `Bun.build()`. The test runner offers Jest compatibility for seamless migration of existing test suites.

For integration patterns, Bun works seamlessly with existing Node.js projects - most npm packages work out of the box. Common patterns include using `Bun.serve()` with framework adapters (Express, Hono, Elysia), leveraging the built-in SQLite for local data storage or caching, using `Bun.build()` for frontend bundling with React/Vue/Svelte, and employing the shell API for build scripts and automation. The runtime supports both ES modules and CommonJS, reads `tsconfig.json` for TypeScript configuration, and provides environment variable loading from `.env` files automatically.
