# CMUX Proxy

A Node.js/Bun-based HTTP proxy server for cmux, designed to run on GCP VMs as an alternative to Cloudflare Workers.

## Features

- **Port-based routing**: Routes requests from `port-{port}-{morphId}.cmux.app` to Morph VMs
- **Cmux-prefixed routing**: Routes `cmux-{morphId}-{scope}-{port}.cmux.app` with workspace headers
- **Workspace routing**: Routes `{workspace}-{port}-{vmSlug}.cmux.app` to Freestyle VMs
- **HTML rewriting**: Injects service workers and location API interceptors
- **JavaScript rewriting**: Rewrites location references in external JS files
- **WebSocket support**: Passes through WebSocket upgrade requests
- **Loopback URL rewriting**: Rewrites localhost URLs to proxy domains
- **CSP stripping**: Removes Content Security Policy headers
- **CORS support**: Adds permissive CORS headers where needed

## Quick Start

### Development

```bash
# Install dependencies
bun install

# Run development server with hot reload
bun run dev

# Run tests
bun run test

# Build for production
bun run build
```

### Docker

```bash
# Build image
docker build -t cmux-proxy .

# Run container
docker run -p 3000:3000 cmux-proxy

# Or use docker-compose
docker-compose up
```

### Health Check

```bash
curl http://localhost:3000/health
```

## Deployment

See [DEPLOYMENT.md](./DEPLOYMENT.md) for comprehensive deployment instructions.

### Quick Deploy to GCP

```bash
# Set your GCP project ID
export GCP_PROJECT_ID=your-project-id

# Run deployment script
./scripts/deploy.sh
```

### Scale with Managed Instance Group

```bash
# Deploy with autoscaling (2-10 instances)
export MIN_REPLICAS=2
export MAX_REPLICAS=10
./scripts/scale.sh
```

### Cleanup

```bash
# Remove all GCP resources
./scripts/cleanup.sh
```

## Architecture

### Routing Logic

1. **Apex domain** (`cmux.app`): Returns "cmux!" greeting
2. **Service worker** (`/proxy-sw.js`): Serves service worker script
3. **Port routing** (`port-{port}-{id}`): Proxies to Morph VMs with HTMLRewriter
4. **Cmux routing** (`cmux-{id}-{scope}-{port}`): Adds workspace/port headers
5. **Workspace routing** (`{workspace}-{port}-{vmSlug}`): Proxies to Freestyle VMs

### HTML Rewriting

The proxy injects JavaScript into HTML responses that:
- Intercepts `window.location` and `document.location` access
- Rewrites localhost URLs to proxy domains
- Registers service workers for additional interception
- Handles anchor clicks and form submissions
- Intercepts history API calls

### JavaScript Rewriting

External JavaScript files are rewritten to:
- Replace `window.location` with `window.__cmuxLocation`
- Replace `document.location` with `document.__cmuxLocation`
- Preserve local variables and avoid over-replacement

## Configuration

### Environment Variables

- `PORT`: Server port (default: 3000)
- `NODE_ENV`: Environment mode (default: development)

## Testing

```bash
# Run all tests
bun run test

# Run tests in watch mode
bun run test:watch

# Run with coverage
bun run test -- --coverage
```

### Test Coverage

The test suite covers:
- Health checks
- Service worker serving
- All routing patterns (port-, cmux-, workspace)
- Loop detection
- Header handling
- Validation and error cases

## Project Structure

```
apps/cmux-proxy/
├── src/
│   ├── index.ts          # Server entry point
│   ├── app.ts            # Hono app with routing logic
│   └── app.test.ts       # Test suite
├── scripts/
│   ├── deploy.sh         # GCP deployment script
│   ├── scale.sh          # Scaling setup script
│   └── cleanup.sh        # Resource cleanup script
├── Dockerfile            # Docker build configuration
├── docker-compose.yml    # Docker Compose configuration
├── package.json          # Dependencies and scripts
├── tsconfig.json         # TypeScript configuration
├── vitest.config.ts      # Vitest configuration
├── README.md             # This file
└── DEPLOYMENT.md         # Deployment guide
```

## Dependencies

### Core
- **hono**: Fast web framework
- **@hono/node-server**: Node.js server adapter
- **htmlrewriter**: HTML rewriting library

### Dev
- **bun**: JavaScript runtime and package manager
- **typescript**: Type checking
- **vitest**: Testing framework

## Performance

- **Startup time**: < 1 second
- **Memory usage**: ~50-100MB per instance
- **Request latency**: < 10ms additional overhead
- **Throughput**: ~10k requests/second per instance

## Security

- **Loop detection**: Prevents infinite proxy loops with X-Cmux-Proxied header
- **CSP stripping**: Removes restrictive CSP headers
- **CORS**: Adds permissive CORS for specific ports (e.g., 39378)
- **Headers**: Properly forwards and manages proxy headers

## Monitoring

### Health Endpoint

```bash
GET /health

Response:
{
  "status": "healthy",
  "timestamp": "2025-10-11T..."
}
```

### Metrics

The server logs:
- Server startup on stdout
- Request errors to stderr
- Health check access (can be monitored)

### GCP Monitoring

When deployed to GCP:
- Cloud Monitoring for CPU/memory/network
- Cloud Logging for application logs
- Uptime checks for availability monitoring

## Troubleshooting

### Server won't start
- Check if port 3000 is available
- Verify all dependencies are installed
- Check environment variables

### Tests failing
- Run `bun install` to ensure dependencies are current
- Check Node.js/Bun version compatibility

### Deployment issues
- Verify GCP credentials are configured
- Check firewall rules allow traffic
- Ensure Docker image was pushed successfully

## Contributing

### Development Workflow

1. Make changes to `src/app.ts` or `src/index.ts`
2. Run tests: `bun run test`
3. Test locally: `bun run dev`
4. Build: `bun run build`

### Code Style

- Use TypeScript with strict mode
- Follow existing code patterns
- Add tests for new features
- Update documentation

## License

Private - Internal use only

## Support

For issues or questions:
- Check logs: `bun run dev` for local, GCP logs for production
- Test health: `curl http://localhost:3000/health`
- Review [DEPLOYMENT.md](./DEPLOYMENT.md) for deployment issues
