#!/bin/bash
# scripts/setup_base_snapshot.sh
# Run this ONCE on a fresh Morph VM to create the reusable base snapshot
#
# This script installs all required software for the DBA development environment:
# - Chrome with CDP for browser automation
# - TigerVNC + XFCE for visual desktop
# - noVNC for web-based VNC access
# - code-server for VS Code in browser
# - Docker for containerized development
# - nginx as reverse proxy
# - Devbox/Nix for package management
#
# Usage:
#   ./setup_base_snapshot.sh
#
# After running, save as snapshot with:
#   morph snapshot create --digest="dba-base-v1"

set -e

# Colors for output
RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
NC='\033[0m' # No Color

log_info() {
    echo -e "${GREEN}[INFO]${NC} $1"
}

log_warn() {
    echo -e "${YELLOW}[WARN]${NC} $1"
}

log_error() {
    echo -e "${RED}[ERROR]${NC} $1"
}

log_step() {
    echo ""
    echo -e "${GREEN}=== $1 ===${NC}"
}

echo "=============================================="
echo "       DBA Base Snapshot Setup Script        "
echo "=============================================="
echo ""
echo "Started at: $(date)"
echo ""

# Check if running as root
if [ "$EUID" -ne 0 ]; then
    log_error "Please run as root"
    exit 1
fi

# -----------------------------------------------------------------------------
# Step 1/13: System packages
# -----------------------------------------------------------------------------
log_step "Step 1/13: Installing system packages"

apt-get update
DEBIAN_FRONTEND=noninteractive apt-get install -y \
    curl wget git build-essential \
    xfce4 xfce4-goodies dbus-x11 \
    tigervnc-standalone-server \
    nginx \
    python3 python3-pip python3-venv \
    fonts-liberation fonts-dejavu-core fonts-noto-color-emoji \
    ca-certificates gnupg lsb-release \
    jq netcat-openbsd \
    sudo openssh-server

log_info "System packages installed"

# -----------------------------------------------------------------------------
# Step 2/13: Install Chrome
# -----------------------------------------------------------------------------
log_step "Step 2/13: Installing Google Chrome"

# Add Google Chrome repository
wget -qO- https://dl.google.com/linux/linux_signing_key.pub | gpg --dearmor -o /usr/share/keyrings/google-chrome.gpg
echo "deb [arch=amd64 signed-by=/usr/share/keyrings/google-chrome.gpg] http://dl.google.com/linux/chrome/deb/ stable main" > /etc/apt/sources.list.d/google-chrome.list

apt-get update
apt-get install -y google-chrome-stable

# Verify Chrome installation
if command -v google-chrome &> /dev/null; then
    CHROME_VERSION=$(google-chrome --version)
    log_info "Chrome installed: $CHROME_VERSION"
else
    log_error "Chrome installation failed"
    exit 1
fi

# -----------------------------------------------------------------------------
# Step 3/13: Install Node.js (for agent-browser and other tools)
# -----------------------------------------------------------------------------
log_step "Step 3/13: Installing Node.js"

curl -fsSL https://deb.nodesource.com/setup_20.x | bash -
apt-get install -y nodejs

# Verify Node installation
NODE_VERSION=$(node --version)
NPM_VERSION=$(npm --version)
log_info "Node.js installed: $NODE_VERSION"
log_info "npm installed: $NPM_VERSION"

# Install agent-browser globally (Vercel's version)
# It will use the existing Chrome via CDP on port 9222
npm install -g agent-browser || log_warn "agent-browser installation failed"

# Install dba-worker daemon script
cat > /usr/local/bin/dba-worker << 'WORKER_EOF'
#!/usr/bin/env node
/**
 * DBA Worker Daemon
 *
 * HTTP server that wraps agent-browser commands.
 * Runs on port 39377 (exposed via Morph's worker URL).
 *
 * Authentication:
 * - Validates Stack Auth JWT from Authorization header
 * - Verifies JWT signature using Stack Auth's JWKS
 * - Checks that the user ID in JWT matches the instance owner
 */

const http = require('http');
const https = require('https');
const crypto = require('crypto');
const { spawn } = require('child_process');
const fs = require('fs');
const path = require('path');

const PORT = process.env.PORT || 39377;
const OWNER_ID_FILE = '/var/run/dba/owner-id';
const PROJECT_ID_FILE = '/var/run/dba/stack-project-id';
const SESSION_SECRET_FILE = '/var/run/dba/session-secret';

// Auth configuration - loaded at startup
let ownerId = null;
let projectId = null;
let sessionSecret = null;
let jwksCache = null;
let jwksCacheTime = 0;
const JWKS_CACHE_TTL = 3600000; // 1 hour
const SESSION_COOKIE_NAME = 'dba_session';
const SESSION_MAX_AGE = 7 * 24 * 60 * 60; // 7 days in seconds

/**
 * Load auth configuration from files
 */
function loadAuthConfig() {
  try {
    ownerId = fs.readFileSync(OWNER_ID_FILE, 'utf8').trim();
    projectId = fs.readFileSync(PROJECT_ID_FILE, 'utf8').trim();
    console.log(`Auth config loaded: owner=${ownerId}, project=${projectId}`);
  } catch (e) {
    console.error('Warning: Could not load auth config:', e.message);
    console.error('JWT auth will be disabled.');
  }

  // Load or generate session secret for cookie signing
  try {
    sessionSecret = fs.readFileSync(SESSION_SECRET_FILE, 'utf8').trim();
  } catch (e) {
    // Generate new session secret
    sessionSecret = crypto.randomBytes(32).toString('hex');
    try {
      fs.mkdirSync('/var/run/dba', { recursive: true });
      fs.writeFileSync(SESSION_SECRET_FILE, sessionSecret);
      console.log('Generated new session secret');
    } catch (writeErr) {
      console.error('Warning: Could not save session secret:', writeErr.message);
    }
  }

  return !!(ownerId && projectId);
}

/**
 * Sign a value for session cookie
 */
function signSession(userId) {
  const data = JSON.stringify({ userId, exp: Date.now() + SESSION_MAX_AGE * 1000 });
  const signature = crypto.createHmac('sha256', sessionSecret).update(data).digest('base64url');
  return Buffer.from(data).toString('base64url') + '.' + signature;
}

/**
 * Verify and decode session cookie
 */
function verifySession(cookie) {
  try {
    const [dataB64, signature] = cookie.split('.');
    const data = Buffer.from(dataB64, 'base64url').toString();
    const expectedSig = crypto.createHmac('sha256', sessionSecret).update(data).digest('base64url');
    if (signature !== expectedSig) return null;
    const parsed = JSON.parse(data);
    if (parsed.exp < Date.now()) return null;
    return parsed;
  } catch (e) {
    return null;
  }
}

/**
 * Parse cookies from request
 */
function parseCookies(req) {
  const cookies = {};
  const header = req.headers.cookie || '';
  header.split(';').forEach(cookie => {
    const [name, ...rest] = cookie.trim().split('=');
    if (name) cookies[name] = rest.join('=');
  });
  return cookies;
}

/**
 * Generate access denied page HTML
 */
function getAccessDeniedHtml() {
  return `<!DOCTYPE html>
<html>
<head>
  <title>Access Denied - DBA</title>
  <meta name="viewport" content="width=device-width, initial-scale=1">
  <style>
    body {
      font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif;
      background: #0a0a0a; color: #fafafa;
      min-height: 100vh; margin: 0;
      display: flex; align-items: center; justify-content: center;
    }
    .container { text-align: center; padding: 2rem; max-width: 400px; }
    h1 { margin-bottom: 0.5rem; }
    p { color: #888; line-height: 1.6; }
    code { background: #222; padding: 2px 6px; border-radius: 4px; }
  </style>
</head>
<body>
  <div class="container">
    <h1>Access Denied</h1>
    <p>This DBA workspace requires authentication.</p>
    <p>Use the CLI to open this workspace:</p>
    <p><code>dba code &lt;instance-id&gt;</code></p>
    <p><code>dba vnc &lt;instance-id&gt;</code></p>
  </div>
</body>
</html>`;
}

/**
 * Verify one-time login token (signed by CLI)
 * Token format: base64url(JSON{userId, exp}).signature
 */
function verifyLoginToken(token) {
  try {
    const [dataB64, signature] = token.split('.');
    if (!dataB64 || !signature) return null;

    const data = Buffer.from(dataB64, 'base64url').toString();
    const expectedSig = crypto.createHmac('sha256', sessionSecret).update(data).digest('base64url');

    if (signature !== expectedSig) return null;

    const parsed = JSON.parse(data);
    // Token expires after 5 minutes
    if (!parsed.exp || parsed.exp < Date.now()) return null;
    if (!parsed.userId) return null;

    return parsed;
  } catch (e) {
    return null;
  }
}

/**
 * Fetch JWKS from Stack Auth
 */
async function fetchJWKS() {
  // Return cached JWKS if still valid
  if (jwksCache && Date.now() - jwksCacheTime < JWKS_CACHE_TTL) {
    return jwksCache;
  }

  const jwksUrl = `https://api.stack-auth.com/api/v1/projects/${projectId}/.well-known/jwks.json?include_anonymous=true`;

  return new Promise((resolve, reject) => {
    https.get(jwksUrl, (res) => {
      let data = '';
      res.on('data', chunk => data += chunk);
      res.on('end', () => {
        try {
          jwksCache = JSON.parse(data);
          jwksCacheTime = Date.now();
          resolve(jwksCache);
        } catch (e) {
          reject(new Error('Failed to parse JWKS'));
        }
      });
    }).on('error', reject);
  });
}

/**
 * Base64URL decode
 */
function base64UrlDecode(str) {
  str = str.replace(/-/g, '+').replace(/_/g, '/');
  while (str.length % 4) str += '=';
  return Buffer.from(str, 'base64');
}

/**
 * Verify JWT signature using JWKS
 */
async function verifyJWT(token) {
  const parts = token.split('.');
  if (parts.length !== 3) {
    throw new Error('Invalid JWT format');
  }

  const [headerB64, payloadB64, signatureB64] = parts;
  const header = JSON.parse(base64UrlDecode(headerB64).toString());
  const payload = JSON.parse(base64UrlDecode(payloadB64).toString());

  // Check expiration
  if (payload.exp && payload.exp < Date.now() / 1000) {
    throw new Error('JWT expired');
  }

  // Check issuer
  const expectedIssuer = `https://api.stack-auth.com/api/v1/projects/${projectId}`;
  const anonIssuer = `https://api.stack-auth.com/api/v1/projects-anonymous-users/${projectId}`;
  if (payload.iss !== expectedIssuer && payload.iss !== anonIssuer) {
    throw new Error('Invalid issuer');
  }

  // Fetch JWKS and find matching key
  const jwks = await fetchJWKS();
  const key = jwks.keys.find(k => k.kid === header.kid);
  if (!key) {
    throw new Error('Key not found in JWKS');
  }

  // Verify signature using Node.js crypto
  const signatureData = `${headerB64}.${payloadB64}`;
  const signature = base64UrlDecode(signatureB64);

  // Import the JWK as a crypto key
  const keyObject = crypto.createPublicKey({ key, format: 'jwk' });

  const isValid = crypto.verify(
    'sha256',
    Buffer.from(signatureData),
    { key: keyObject, dsaEncoding: 'ieee-p1363' },
    signature
  );

  if (!isValid) {
    throw new Error('Invalid signature');
  }

  return payload;
}

/**
 * Verify authentication - checks JWT and owner ID
 */
async function verifyAuth(req) {
  // If auth config not loaded, deny all requests
  if (!ownerId || !projectId) {
    return { valid: false, error: 'Auth not configured' };
  }

  const authHeader = req.headers['authorization'];
  if (!authHeader) {
    return { valid: false, error: 'No authorization header' };
  }

  const [type, token] = authHeader.split(' ');
  if (type !== 'Bearer' || !token) {
    return { valid: false, error: 'Invalid authorization format' };
  }

  try {
    const payload = await verifyJWT(token);

    // Check if user ID matches owner
    const userId = payload.sub;
    if (userId !== ownerId) {
      return { valid: false, error: 'User is not the instance owner' };
    }

    return { valid: true, userId };
  } catch (e) {
    return { valid: false, error: e.message };
  }
}

// Load auth config at startup
loadAuthConfig();

/**
 * Run an agent-browser command and return the result
 * Uses CDP to connect to the existing Chrome on port 9222
 */
async function runAgentBrowser(args) {
  return new Promise((resolve, reject) => {
    const proc = spawn('agent-browser', [...args, '--cdp', '9222', '--json'], {
      env: { ...process.env, FORCE_COLOR: '0' },
    });

    let stdout = '';
    let stderr = '';

    proc.stdout.on('data', (data) => {
      stdout += data.toString();
    });

    proc.stderr.on('data', (data) => {
      stderr += data.toString();
    });

    proc.on('close', (code) => {
      if (code !== 0) {
        reject(new Error(stderr || stdout || `Exit code ${code}`));
      } else {
        try {
          resolve(JSON.parse(stdout));
        } catch (e) {
          resolve({ success: true, data: stdout });
        }
      }
    });

    proc.on('error', (err) => {
      reject(err);
    });
  });
}

/**
 * Parse JSON body from request
 */
async function parseBody(req) {
  return new Promise((resolve, reject) => {
    let body = '';
    req.on('data', (chunk) => {
      body += chunk.toString();
    });
    req.on('end', () => {
      if (!body) {
        resolve({});
        return;
      }
      try {
        resolve(JSON.parse(body));
      } catch (e) {
        reject(new Error('Invalid JSON'));
      }
    });
    req.on('error', reject);
  });
}

/**
 * Send JSON response
 */
function sendJson(res, data, status = 200) {
  res.writeHead(status, { 'Content-Type': 'application/json' });
  res.end(JSON.stringify(data));
}

/**
 * Proxy request to nginx (port 80)
 * Used for VS Code, VNC, and other browser-accessible services
 */
function proxyToNginx(req, res, originalHost) {
  const proxyReq = http.request({
    hostname: '127.0.0.1',
    port: 80,
    path: req.url,
    method: req.method,
    headers: {
      ...req.headers,
      // Keep original host for proper redirects
      host: originalHost || req.headers.host || 'localhost',
    },
  }, (proxyRes) => {
    // Rewrite Location header if it points to localhost
    const headers = { ...proxyRes.headers };
    if (headers.location && originalHost) {
      headers.location = headers.location
        .replace(/^http:\/\/localhost(:\d+)?/i, `https://${originalHost}`)
        .replace(/^http:\/\/127\.0\.0\.1(:\d+)?/i, `https://${originalHost}`);
    }
    res.writeHead(proxyRes.statusCode, headers);
    proxyRes.pipe(res);
  });

  proxyReq.on('error', (err) => {
    console.error('Proxy error:', err.message);
    res.writeHead(502);
    res.end('Bad Gateway');
  });

  req.pipe(proxyReq);
}

/**
 * Check if path should be proxied to nginx (browser access)
 */
function isBrowserPath(pathname) {
  // Root path serves VS Code
  if (pathname === '/') return true;
  // VS Code paths
  if (pathname.startsWith('/code')) return true;
  // VNC paths
  if (pathname.startsWith('/vnc')) return true;
  // WebSocket for VNC
  if (pathname.startsWith('/websockify')) return true;
  // Static assets from VS Code
  if (pathname.startsWith('/static')) return true;
  if (pathname.startsWith('/stable')) return true;
  if (pathname.startsWith('/vscode')) return true;
  // VS Code internal paths (but not our /_dba/ endpoints)
  if (pathname.startsWith('/_') && !pathname.startsWith('/_dba')) return true;
  // Favicon, manifest, etc.
  if (pathname === '/favicon.ico') return true;
  if (pathname === '/manifest.json') return true;
  return false;
}

/**
 * Handle requests
 */
async function handleRequest(req, res) {
  const url = new URL(req.url, `http://localhost:${PORT}`);
  const reqPath = url.pathname;

  // Health check - no auth
  if (reqPath === '/health') {
    sendJson(res, { status: 'ok' });
    return;
  }

  // Auth endpoint - CLI generates URL with signed token, sets session cookie
  // URL format: /_dba/auth?token=xxx&return=/code/
  if (reqPath === '/_dba/auth') {
    const token = url.searchParams.get('token');
    const returnTo = url.searchParams.get('return') || '/code/';

    if (!token) {
      res.writeHead(400, { 'Content-Type': 'text/html' });
      res.end(getAccessDeniedHtml());
      return;
    }

    // Verify the one-time login token
    const tokenData = verifyLoginToken(token);
    if (!tokenData) {
      res.writeHead(401, { 'Content-Type': 'text/html' });
      res.end('<html><body><h1>Invalid or expired link</h1><p>Please use the CLI to generate a new link: <code>dba code &lt;id&gt;</code></p></body></html>');
      return;
    }

    // Check user is the instance owner
    if (tokenData.userId !== ownerId) {
      res.writeHead(403, { 'Content-Type': 'text/html' });
      res.end('<html><body><h1>Access Denied</h1><p>You are not the owner of this workspace.</p></body></html>');
      return;
    }

    // Create session cookie and redirect
    const sessionValue = signSession(tokenData.userId);
    res.writeHead(302, {
      'Location': returnTo,
      'Set-Cookie': `${SESSION_COOKIE_NAME}=${sessionValue}; Path=/; HttpOnly; SameSite=Lax; Max-Age=${SESSION_MAX_AGE}`
    });
    res.end();
    return;
  }

  // Browser paths (VS Code, VNC) - require session cookie
  if (isBrowserPath(reqPath)) {
    const cookies = parseCookies(req);
    const session = cookies[SESSION_COOKIE_NAME] ? verifySession(cookies[SESSION_COOKIE_NAME]) : null;

    if (!session || session.userId !== ownerId) {
      // No valid session - show access denied page
      res.writeHead(401, { 'Content-Type': 'text/html' });
      res.end(getAccessDeniedHtml());
      return;
    }

    // Valid session - proxy to nginx
    proxyToNginx(req, res, req.headers.host);
    return;
  }

  // CORS headers for API endpoints
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET, POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type, Authorization');

  if (req.method === 'OPTIONS') {
    res.writeHead(204);
    res.end();
    return;
  }

  // API endpoints require JWT authentication
  const authResult = await verifyAuth(req);
  if (!authResult.valid) {
    sendJson(res, { error: 'Unauthorized', message: authResult.error || 'Authentication required' }, 401);
    return;
  }

  try {
    let result;
    let body = {};

    if (req.method === 'POST') {
      body = await parseBody(req);
    }

    switch (reqPath) {

      // Generate one-time auth token for browser access (CLI calls this)
      case '/_dba/generate-token':
        const tokenData = {
          userId: ownerId,
          exp: Date.now() + 5 * 60 * 1000 // 5 minutes
        };
        const tokenJson = JSON.stringify(tokenData);
        const tokenB64 = Buffer.from(tokenJson).toString('base64url');
        const tokenSig = crypto.createHmac('sha256', sessionSecret).update(tokenJson).digest('base64url');
        result = { token: `${tokenB64}.${tokenSig}` };
        break;

      case '/snapshot':
        const snapshotArgs = ['snapshot'];
        if (body.interactive) snapshotArgs.push('-i');
        if (body.compact) snapshotArgs.push('-c');
        result = await runAgentBrowser(snapshotArgs);
        break;

      case '/open':
        if (!body.url) {
          sendJson(res, { error: 'url required' }, 400);
          return;
        }
        result = await runAgentBrowser(['open', body.url]);
        break;

      case '/click':
        if (!body.selector) {
          sendJson(res, { error: 'selector required' }, 400);
          return;
        }
        result = await runAgentBrowser(['click', body.selector]);
        break;

      case '/dblclick':
        if (!body.selector) {
          sendJson(res, { error: 'selector required' }, 400);
          return;
        }
        result = await runAgentBrowser(['dblclick', body.selector]);
        break;

      case '/type':
        if (!body.text) {
          sendJson(res, { error: 'text required' }, 400);
          return;
        }
        result = await runAgentBrowser(['type', body.selector || '', body.text]);
        break;

      case '/fill':
        if (!body.selector || body.value === undefined) {
          sendJson(res, { error: 'selector and value required' }, 400);
          return;
        }
        result = await runAgentBrowser(['fill', body.selector, body.value]);
        break;

      case '/press':
        if (!body.key) {
          sendJson(res, { error: 'key required' }, 400);
          return;
        }
        result = await runAgentBrowser(['press', body.key]);
        break;

      case '/hover':
        if (!body.selector) {
          sendJson(res, { error: 'selector required' }, 400);
          return;
        }
        result = await runAgentBrowser(['hover', body.selector]);
        break;

      case '/scroll':
        const dir = body.direction || 'down';
        const amount = body.amount ? String(body.amount) : undefined;
        const scrollArgs = ['scroll', dir];
        if (amount) scrollArgs.push(amount);
        result = await runAgentBrowser(scrollArgs);
        break;

      case '/screenshot':
        // Take screenshot and return base64
        const ssResult = await runAgentBrowser(['screenshot']);
        if (ssResult.success && ssResult.data && ssResult.data.path) {
          const imgData = fs.readFileSync(ssResult.data.path);
          const base64 = imgData.toString('base64');
          result = { success: true, data: { base64 } };
          // Clean up temp file
          try { fs.unlinkSync(ssResult.data.path); } catch (e) {}
        } else {
          result = ssResult;
        }
        break;

      case '/back':
        result = await runAgentBrowser(['back']);
        break;

      case '/forward':
        result = await runAgentBrowser(['forward']);
        break;

      case '/reload':
        result = await runAgentBrowser(['reload']);
        break;

      case '/url':
        result = await runAgentBrowser(['get', 'url']);
        break;

      case '/title':
        result = await runAgentBrowser(['get', 'title']);
        break;

      case '/wait':
        if (!body.selector) {
          sendJson(res, { error: 'selector required' }, 400);
          return;
        }
        result = await runAgentBrowser(['wait', body.selector]);
        break;

      case '/eval':
        if (!body.script) {
          sendJson(res, { error: 'script required' }, 400);
          return;
        }
        result = await runAgentBrowser(['eval', body.script]);
        break;

      default:
        sendJson(res, { error: 'Not found' }, 404);
        return;
    }

    sendJson(res, result);
  } catch (err) {
    console.error('Error:', err.message);
    sendJson(res, { success: false, error: err.message }, 500);
  }
}

const server = http.createServer(handleRequest);

server.listen(PORT, '0.0.0.0', () => {
  console.log(`DBA Worker daemon listening on port ${PORT}`);
});

// Handle graceful shutdown
process.on('SIGTERM', () => {
  console.log('Shutting down...');
  server.close(() => process.exit(0));
});

process.on('SIGINT', () => {
  console.log('Shutting down...');
  server.close(() => process.exit(0));
});
WORKER_EOF

chmod +x /usr/local/bin/dba-worker
log_info "Installed dba-worker daemon"

# Create token directory
mkdir -p /var/run/dba

# -----------------------------------------------------------------------------
# Step 4/13: Install Docker
# -----------------------------------------------------------------------------
log_step "Step 4/13: Installing Docker"

# Detect OS (Ubuntu or Debian)
. /etc/os-release
DOCKER_OS="$ID"
log_info "Detected OS: $DOCKER_OS ($VERSION_CODENAME)"

# Add Docker's official GPG key
install -m 0755 -d /etc/apt/keyrings
curl -fsSL "https://download.docker.com/linux/$DOCKER_OS/gpg" -o /etc/apt/keyrings/docker.asc
chmod a+r /etc/apt/keyrings/docker.asc

# Add Docker repository
echo \
  "deb [arch=$(dpkg --print-architecture) signed-by=/etc/apt/keyrings/docker.asc] https://download.docker.com/linux/$DOCKER_OS \
  $VERSION_CODENAME stable" | \
  tee /etc/apt/sources.list.d/docker.list > /dev/null

apt-get update

# Install Docker packages
DEBIAN_FRONTEND=noninteractive apt-get install -y \
    docker-ce \
    docker-ce-cli \
    containerd.io \
    docker-buildx-plugin \
    docker-compose-plugin

# Verify Docker installation
if command -v docker &> /dev/null; then
    DOCKER_VERSION=$(docker --version)
    log_info "Docker installed: $DOCKER_VERSION"
else
    log_error "Docker installation failed"
    exit 1
fi

# Enable and start Docker
systemctl enable docker
systemctl start docker

# Verify Docker is running
if docker info &>/dev/null; then
    log_info "Docker daemon is running"
else
    log_warn "Docker daemon may not be running yet"
fi

log_info "Docker installation complete"

# -----------------------------------------------------------------------------
# Step 5/13: Install Devbox
# -----------------------------------------------------------------------------
log_step "Step 5/13: Installing Devbox"

curl -fsSL https://get.jetify.com/devbox | bash -s -- -f

# Verify Devbox installation
if command -v devbox &> /dev/null; then
    DEVBOX_VERSION=$(devbox version 2>/dev/null || echo "installed")
    log_info "Devbox installed: $DEVBOX_VERSION"
else
    log_warn "Devbox installation may require shell restart"
fi

# -----------------------------------------------------------------------------
# Step 6/13: Install code-server
# -----------------------------------------------------------------------------
log_step "Step 6/13: Installing code-server"

curl -fsSL https://code-server.dev/install.sh | sh

# Verify code-server installation
if command -v code-server &> /dev/null; then
    CODE_SERVER_VERSION=$(code-server --version | head -1)
    log_info "code-server installed: $CODE_SERVER_VERSION"
else
    log_error "code-server installation failed"
    exit 1
fi

# -----------------------------------------------------------------------------
# Step 7/13: Install noVNC
# -----------------------------------------------------------------------------
log_step "Step 7/13: Installing noVNC"

git clone --depth 1 https://github.com/novnc/noVNC.git /opt/noVNC
git clone --depth 1 https://github.com/novnc/websockify.git /opt/noVNC/utils/websockify

# Make noVNC launch script executable
chmod +x /opt/noVNC/utils/novnc_proxy

log_info "noVNC installed to /opt/noVNC"

# -----------------------------------------------------------------------------
# Step 8/13: Create dba user
# -----------------------------------------------------------------------------
log_step "Step 8/13: Creating dba user"

# Create user if doesn't exist
if ! id "dba" &>/dev/null; then
    useradd -m -s /bin/bash dba
    log_info "Created user 'dba'"
else
    log_info "User 'dba' already exists"
fi

# Add to sudoers
echo "dba ALL=(ALL) NOPASSWD:ALL" > /etc/sudoers.d/dba
chmod 440 /etc/sudoers.d/dba

# Add dba user to docker group
usermod -aG docker dba
log_info "User 'dba' added to docker group"

log_info "User 'dba' configured with sudo access"

# -----------------------------------------------------------------------------
# Step 9/13: Configure VNC
# -----------------------------------------------------------------------------
log_step "Step 9/13: Configuring VNC"

# Create VNC directory
mkdir -p /home/dba/.vnc

# Create VNC startup script for XFCE
cat > /home/dba/.vnc/xstartup << 'EOF'
#!/bin/bash
unset SESSION_MANAGER
unset DBUS_SESSION_BUS_ADDRESS
export XDG_SESSION_TYPE=x11

# Start D-Bus
if [ -z "$DBUS_SESSION_BUS_ADDRESS" ]; then
    eval $(dbus-launch --sh-syntax)
    export DBUS_SESSION_BUS_ADDRESS
fi

# Start XFCE
exec startxfce4
EOF

chmod +x /home/dba/.vnc/xstartup
chown -R dba:dba /home/dba/.vnc

log_info "VNC configured"

# -----------------------------------------------------------------------------
# Step 10/13: Create systemd services
# -----------------------------------------------------------------------------
log_step "Step 10/13: Creating systemd services"

# VNC Server service
cat > /etc/systemd/system/vncserver.service << 'EOF'
[Unit]
Description=TigerVNC Server for DBA
After=network.target

[Service]
Type=simple
User=dba
Group=dba
Environment=DISPLAY=:1
Environment=HOME=/home/dba

# Kill any existing VNC server on display :1
ExecStartPre=-/usr/bin/vncserver -kill :1
ExecStartPre=/bin/sleep 1

# Start Xvnc directly
ExecStart=/usr/bin/Xvnc :1 \
    -geometry 1920x1080 \
    -depth 24 \
    -rfbport 5901 \
    -SecurityTypes None \
    -localhost no \
    -AlwaysShared \
    -AcceptKeyEvents \
    -AcceptPointerEvents \
    -SendCutText \
    -AcceptCutText

ExecStop=/usr/bin/vncserver -kill :1
Restart=on-failure
RestartSec=3

[Install]
WantedBy=multi-user.target
EOF

log_info "Created vncserver.service"

# XFCE Session service
cat > /etc/systemd/system/xfce-session.service << 'EOF'
[Unit]
Description=XFCE Desktop Session
After=vncserver.service
Requires=vncserver.service

[Service]
Type=simple
User=dba
Group=dba
Environment=DISPLAY=:1
Environment=HOME=/home/dba
Environment=XDG_SESSION_TYPE=x11

# Wait for VNC to be ready
ExecStartPre=/bin/bash -c 'for i in {1..30}; do [ -e /tmp/.X11-unix/X1 ] && break; sleep 0.5; done'

# Start XFCE
ExecStart=/usr/bin/startxfce4

Restart=on-failure
RestartSec=3

[Install]
WantedBy=multi-user.target
EOF

log_info "Created xfce-session.service"

# Chrome with CDP service
cat > /etc/systemd/system/chrome-cdp.service << 'EOF'
[Unit]
Description=Chrome with Chrome DevTools Protocol
After=xfce-session.service
Requires=xfce-session.service

[Service]
Type=simple
User=dba
Group=dba
Environment=DISPLAY=:1
Environment=HOME=/home/dba

# Wait for XFCE to be ready
ExecStartPre=/bin/bash -c 'for i in {1..60}; do pgrep -u dba xfwm4 > /dev/null && break; sleep 0.5; done'
ExecStartPre=/bin/sleep 2

ExecStart=/usr/bin/google-chrome \
    --headless=new \
    --remote-debugging-port=9222 \
    --remote-debugging-address=127.0.0.1 \
    --no-sandbox \
    --disable-gpu \
    --disable-dev-shm-usage \
    --disable-software-rasterizer \
    --window-size=1920,1080 \
    --no-first-run \
    --no-default-browser-check \
    --disable-default-apps \
    --disable-extensions \
    --disable-sync \
    --disable-translate \
    --disable-background-networking \
    --disable-client-side-phishing-detection \
    --disable-component-update \
    --disable-hang-monitor \
    --disable-popup-blocking \
    --disable-prompt-on-repost \
    --metrics-recording-only \
    --safebrowsing-disable-auto-update \
    --password-store=basic \
    --use-mock-keychain \
    --user-data-dir=/home/dba/.chrome-dba \
    about:blank

Restart=on-failure
RestartSec=5

[Install]
WantedBy=multi-user.target
EOF

log_info "Created chrome-cdp.service"

# noVNC service
cat > /etc/systemd/system/novnc.service << 'EOF'
[Unit]
Description=noVNC Web VNC Client
After=vncserver.service
Requires=vncserver.service

[Service]
Type=simple
Environment=HOME=/root

# Wait for VNC to be ready
ExecStartPre=/bin/bash -c 'for i in {1..30}; do nc -z localhost 5901 && break; sleep 0.5; done'

ExecStart=/opt/noVNC/utils/novnc_proxy \
    --vnc localhost:5901 \
    --listen 6080

Restart=on-failure
RestartSec=3

[Install]
WantedBy=multi-user.target
EOF

log_info "Created novnc.service"

# code-server service
cat > /etc/systemd/system/code-server.service << 'EOF'
[Unit]
Description=code-server IDE
After=network.target

[Service]
Type=simple
User=dba
Group=dba
Environment=HOME=/home/dba
Environment=PASSWORD=
WorkingDirectory=/home/dba

ExecStart=/usr/bin/code-server \
    --bind-addr 0.0.0.0:10080 \
    --auth none \
    --disable-telemetry \
    /home/dba/workspace

Restart=on-failure
RestartSec=3

[Install]
WantedBy=multi-user.target
EOF

log_info "Created code-server.service"

# dba-worker service (browser automation API)
cat > /etc/systemd/system/dba-worker.service << 'EOF'
[Unit]
Description=DBA Worker Daemon (Browser Automation API)
After=chrome-cdp.service
Requires=chrome-cdp.service

[Service]
Type=simple
Environment=PORT=39377
Environment=PATH=/usr/local/bin:/usr/bin:/bin
WorkingDirectory=/home/dba

ExecStart=/usr/bin/node /usr/local/bin/dba-worker

Restart=on-failure
RestartSec=3

[Install]
WantedBy=multi-user.target
EOF

log_info "Created dba-worker.service"

# Reload systemd
systemctl daemon-reload

# -----------------------------------------------------------------------------
# Step 11/13: Configure nginx
# -----------------------------------------------------------------------------
log_step "Step 11/13: Configuring nginx"

cat > /etc/nginx/sites-available/dba << 'EOF'
# DBA nginx configuration
# Routes all services through port 80

upstream code_server {
    server 127.0.0.1:10080;
}

upstream app_server {
    server 127.0.0.1:10000;
}

upstream novnc {
    server 127.0.0.1:6080;
}

upstream chrome_cdp {
    server 127.0.0.1:9222;
}

server {
    listen 80 default_server;
    server_name _;

    # Increase timeouts for WebSocket connections
    proxy_connect_timeout 7d;
    proxy_send_timeout 7d;
    proxy_read_timeout 7d;

    # code-server (VS Code IDE)
    location /code/ {
        proxy_pass http://code_server/;
        proxy_http_version 1.1;
        proxy_set_header Host $host;
        proxy_set_header Upgrade $http_upgrade;
        proxy_set_header Connection "upgrade";
        proxy_set_header X-Real-IP $remote_addr;
        proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for;
        proxy_set_header X-Forwarded-Proto $scheme;
        proxy_set_header Accept-Encoding gzip;
    }

    # App (developer's application on port 10000)
    location /app/ {
        proxy_pass http://app_server/;
        proxy_http_version 1.1;
        proxy_set_header Host $host;
        proxy_set_header Upgrade $http_upgrade;
        proxy_set_header Connection "upgrade";
        proxy_set_header X-Real-IP $remote_addr;
        proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for;
        proxy_set_header X-Forwarded-Proto $scheme;
    }

    # noVNC (web-based VNC)
    location /vnc/ {
        proxy_pass http://novnc/;
        proxy_http_version 1.1;
        proxy_set_header Host $host;
        proxy_set_header Upgrade $http_upgrade;
        proxy_set_header Connection "upgrade";
        proxy_set_header X-Real-IP $remote_addr;
        proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for;
    }

    # noVNC websocket connection
    location /websockify {
        proxy_pass http://novnc/websockify;
        proxy_http_version 1.1;
        proxy_set_header Upgrade $http_upgrade;
        proxy_set_header Connection "upgrade";
        proxy_set_header Host $host;
    }

    # Chrome DevTools Protocol (for agent-browser)
    location /cdp/ {
        proxy_pass http://chrome_cdp/;
        proxy_http_version 1.1;
        proxy_set_header Upgrade $http_upgrade;
        proxy_set_header Connection "upgrade";
        proxy_set_header Host localhost;
    }

    # CDP JSON endpoints
    location /json {
        proxy_pass http://chrome_cdp/json;
        proxy_http_version 1.1;
        proxy_set_header Host localhost;
    }

    # DevTools WebSocket
    location ~ ^/devtools/.*$ {
        proxy_pass http://chrome_cdp;
        proxy_http_version 1.1;
        proxy_set_header Upgrade $http_upgrade;
        proxy_set_header Connection "upgrade";
        proxy_set_header Host localhost;
    }

    # Health check endpoint
    location /health {
        access_log off;
        return 200 'DBA VM is healthy\n';
        add_header Content-Type text/plain;
    }

    # Root - redirect to VNC by default
    location = / {
        return 302 /vnc/;
    }
}
EOF

# Enable the site
ln -sf /etc/nginx/sites-available/dba /etc/nginx/sites-enabled/dba

# Remove default site
rm -f /etc/nginx/sites-enabled/default

# Test nginx configuration
nginx -t

log_info "nginx configured"

# -----------------------------------------------------------------------------
# Step 12/13: Create workspace directory and final setup
# -----------------------------------------------------------------------------
log_step "Step 12/13: Final setup"

# Create workspace directory
mkdir -p /home/dba/workspace
mkdir -p /home/dba/.chrome-dba
chown -R dba:dba /home/dba/workspace
chown -R dba:dba /home/dba/.chrome-dba

# Create a welcome file in workspace
cat > /home/dba/workspace/README.md << 'EOF'
# DBA Workspace

This is your development workspace in the Morph Cloud VM.

## Quick Links

- VS Code: http://localhost/code/
- VNC: http://localhost/vnc/
- Your App: http://localhost/app/ (when running)

## Getting Started

1. Clone your repository here
2. Use `devbox init` to set up your development environment
3. Start your dev server on port 10000

## Docker

Docker and Docker Compose are pre-installed:
```bash
docker --version
docker compose --version
```

Run containerized services:
```bash
docker run -d -p 5432:5432 postgres
docker compose up -d
```

## Port Mappings

| Service | Port |
|---------|------|
| Your App | 10000 |
| code-server | 10080 |
| Chrome CDP | 9222 |
| VNC | 5901 |
| noVNC | 6080 |
| nginx | 80 |

EOF
chown dba:dba /home/dba/workspace/README.md

# Enable services
systemctl enable vncserver
systemctl enable xfce-session
systemctl enable chrome-cdp
systemctl enable novnc
systemctl enable code-server
systemctl enable nginx
systemctl enable dba-worker

log_info "Services enabled"

# -----------------------------------------------------------------------------
# Step 13/13: Start services and verify
# -----------------------------------------------------------------------------
log_step "Step 13/13: Starting and verifying services"

# Start services in order
systemctl start nginx
log_info "Started nginx"

systemctl start vncserver
sleep 2
log_info "Started vncserver"

systemctl start xfce-session
sleep 3
log_info "Started xfce-session"

systemctl start novnc
log_info "Started novnc"

systemctl start code-server
log_info "Started code-server"

systemctl start chrome-cdp
sleep 5
log_info "Started chrome-cdp"

systemctl start dba-worker
log_info "Started dba-worker"

# Wait for all services to fully initialize
log_info "Waiting for services to initialize..."
sleep 10

# -----------------------------------------------------------------------------
# Verification
# -----------------------------------------------------------------------------
echo ""
echo "=============================================="
echo "              VERIFICATION                    "
echo "=============================================="
echo ""

FAILED=0

check_service() {
    local name=$1
    if systemctl is-active --quiet "$name"; then
        echo -e "${GREEN}[OK]${NC} $name is running"
    else
        echo -e "${RED}[FAIL]${NC} $name is NOT running"
        FAILED=1
    fi
}

check_port() {
    local port=$1
    local name=$2
    if nc -z localhost "$port" 2>/dev/null; then
        echo -e "${GREEN}[OK]${NC} $name (port $port) is listening"
    else
        echo -e "${RED}[FAIL]${NC} $name (port $port) is NOT listening"
        FAILED=1
    fi
}

# Check systemd services
check_service "vncserver"
check_service "xfce-session"
check_service "chrome-cdp"
check_service "novnc"
check_service "code-server"
check_service "nginx"
check_service "docker"
check_service "dba-worker"

echo ""

# Check ports
check_port 80 "nginx"
check_port 5901 "VNC"
check_port 6080 "noVNC"
check_port 9222 "Chrome CDP"
check_port 10080 "code-server"
check_port 39377 "dba-worker"

echo ""

# Check Chrome CDP specifically
echo "Chrome CDP Version:"
CHROME_CDP=$(curl -s http://localhost:9222/json/version 2>/dev/null || echo "")
if [ -n "$CHROME_CDP" ]; then
    echo "$CHROME_CDP" | jq -r '.Browser // "Unknown"'
else
    echo -e "${RED}[FAIL]${NC} Chrome CDP not responding"
    FAILED=1
fi

echo ""

# Check Docker specifically
echo "Docker Version:"
DOCKER_VER=$(docker --version 2>/dev/null || echo "")
if [ -n "$DOCKER_VER" ]; then
    echo -e "${GREEN}[OK]${NC} $DOCKER_VER"
else
    echo -e "${RED}[FAIL]${NC} Docker not responding"
    FAILED=1
fi

# -----------------------------------------------------------------------------
# Create marker file
# -----------------------------------------------------------------------------
touch /dba_base_snapshot_valid
echo "DBA_SNAPSHOT_VERSION=1.0" > /dba_snapshot_info
echo "DBA_SNAPSHOT_DATE=$(date -Iseconds)" >> /dba_snapshot_info

echo ""
echo "=============================================="
if [ $FAILED -eq 0 ]; then
    echo -e "${GREEN}       SETUP COMPLETED SUCCESSFULLY!        ${NC}"
    echo "=============================================="
    echo ""
    echo "All services are running. You can now:"
    echo "  1. Save this VM as a snapshot"
    echo "  2. Use this snapshot as the base for DBA workspaces"
    echo ""
    echo "Marker file created: /dba_base_snapshot_valid"
else
    echo -e "${RED}       SETUP COMPLETED WITH ERRORS          ${NC}"
    echo "=============================================="
    echo ""
    echo "Some services failed to start. Please check:"
    echo "  journalctl -u <service-name> -n 50"
    echo ""
    exit 1
fi

echo "Completed at: $(date)"
