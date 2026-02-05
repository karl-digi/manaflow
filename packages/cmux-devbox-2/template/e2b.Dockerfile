# E2B Dockerfile for cmux devbox template
# Simplified version without Docker and nginx (E2B handles port exposure)

FROM ubuntu:22.04

# Prevent interactive prompts during package installation
ENV DEBIAN_FRONTEND=noninteractive

# Install system packages (no Docker, no nginx)
RUN apt-get update && apt-get install -y \
    curl \
    wget \
    git \
    build-essential \
    ca-certificates \
    gnupg \
    lsb-release \
    jq \
    netcat-openbsd \
    sudo \
    python3 \
    python3-pip \
    unzip \
    openssl \
    rsync \
    openssh-server \
    # VNC and desktop environment
    xfce4 \
    xfce4-goodies \
    dbus-x11 \
    tigervnc-standalone-server \
    # Fonts for proper rendering
    fonts-liberation \
    fonts-dejavu-core \
    fonts-noto-color-emoji \
    && rm -rf /var/lib/apt/lists/*

# Configure SSH server on port 10000 (since 22 may not be exposed by E2B)
RUN mkdir -p /var/run/sshd \
    && sed -i 's/#Port 22/Port 10000/' /etc/ssh/sshd_config \
    && echo "PermitRootLogin no" >> /etc/ssh/sshd_config \
    && echo "PasswordAuthentication yes" >> /etc/ssh/sshd_config \
    && echo "PubkeyAuthentication yes" >> /etc/ssh/sshd_config

# Install Node.js 20
RUN curl -fsSL https://deb.nodesource.com/setup_20.x | bash - \
    && apt-get install -y nodejs \
    && npm install -g npm@latest

# Install Bun
RUN curl -fsSL https://bun.sh/install | bash
ENV BUN_INSTALL="/root/.bun"
ENV PATH="$BUN_INSTALL/bin:$PATH"

# Install GitHub CLI
RUN curl -fsSL https://cli.github.com/packages/githubcli-archive-keyring.gpg | dd of=/usr/share/keyrings/githubcli-archive-keyring.gpg \
    && chmod go+r /usr/share/keyrings/githubcli-archive-keyring.gpg \
    && echo "deb [arch=$(dpkg --print-architecture) signed-by=/usr/share/keyrings/githubcli-archive-keyring.gpg] https://cli.github.com/packages stable main" | tee /etc/apt/sources.list.d/github-cli.list > /dev/null \
    && apt-get update \
    && apt-get install -y gh \
    && rm -rf /var/lib/apt/lists/*

# Install OpenVSCode Server
RUN wget -q https://github.com/gitpod-io/openvscode-server/releases/download/openvscode-server-v1.96.4/openvscode-server-v1.96.4-linux-x64.tar.gz \
    && tar -xzf openvscode-server-v1.96.4-linux-x64.tar.gz \
    && mv openvscode-server-v1.96.4-linux-x64 /opt/openvscode-server \
    && rm openvscode-server-v1.96.4-linux-x64.tar.gz \
    && chmod -R 755 /opt/openvscode-server

# Install noVNC for web-based VNC access
RUN git clone --depth=1 https://github.com/novnc/noVNC.git /opt/noVNC \
    && git clone --depth=1 https://github.com/novnc/websockify.git /opt/noVNC/utils/websockify \
    && ln -s /opt/noVNC/vnc.html /opt/noVNC/index.html \
    && chmod -R 755 /opt/noVNC

# Install Chrome for headless browser automation
RUN wget -q -O - https://dl.google.com/linux/linux_signing_key.pub | gpg --dearmor -o /usr/share/keyrings/google-chrome.gpg \
    && echo "deb [arch=amd64 signed-by=/usr/share/keyrings/google-chrome.gpg] http://dl.google.com/linux/chrome/deb/ stable main" > /etc/apt/sources.list.d/google-chrome.list \
    && apt-get update \
    && apt-get install -y google-chrome-stable \
    && rm -rf /var/lib/apt/lists/*

# Create user account (E2B expects a 'user' account)
RUN useradd -m -s /bin/bash -u 1000 user \
    && echo "user:user" | chpasswd

# Setup for user
RUN mkdir -p /home/user/workspace /home/user/.vnc /home/user/.chrome-data /home/user/.chrome-visible /home/user/.config /home/user/.local/share/applications \
    && mkdir -p /home/user/.openvscode-server/data/User \
    && mkdir -p /home/user/.openvscode-server/data/User/profiles/default-profile \
    && mkdir -p /home/user/.openvscode-server/data/Machine \
    && mkdir -p /home/user/.openvscode-server/extensions \
    && chown -R user:user /home/user

# Configure OpenVSCode Server settings (disable workspace trust, good defaults)
RUN echo '{ \
  "workbench.colorTheme": "Default Dark Modern", \
  "workbench.startupEditor": "none", \
  "workbench.welcomePage.walkthroughs.openOnInstall": false, \
  "workbench.tips.enabled": false, \
  "editor.fontSize": 14, \
  "editor.tabSize": 2, \
  "editor.minimap.enabled": false, \
  "files.autoSave": "afterDelay", \
  "files.autoSaveDelay": 1000, \
  "terminal.integrated.fontSize": 14, \
  "terminal.integrated.defaultProfile.linux": "bash", \
  "terminal.integrated.shellIntegration.enabled": false, \
  "security.workspace.trust.enabled": false, \
  "security.workspace.trust.startupPrompt": "never", \
  "security.workspace.trust.untrustedFiles": "open", \
  "security.workspace.trust.emptyWindow": false, \
  "git.openDiffOnClick": true, \
  "scm.defaultViewMode": "tree", \
  "settingsSync.ignoredSettings": [] \
}' > /home/user/.openvscode-server/data/User/settings.json \
    && cp /home/user/.openvscode-server/data/User/settings.json /home/user/.openvscode-server/data/User/profiles/default-profile/settings.json \
    && cp /home/user/.openvscode-server/data/User/settings.json /home/user/.openvscode-server/data/Machine/settings.json \
    && chown -R user:user /home/user/.openvscode-server

# Set up VNC password (empty)
RUN echo "" | vncpasswd -f > /home/user/.vnc/passwd \
    && chmod 600 /home/user/.vnc/passwd \
    && chown user:user /home/user/.vnc/passwd

# Create VNC xstartup script
COPY worker/xstartup /home/user/.vnc/xstartup
RUN chmod +x /home/user/.vnc/xstartup \
    && chown user:user /home/user/.vnc/xstartup

# Create the start services script
COPY worker/start-services.sh /usr/local/bin/start-services.sh
RUN chmod +x /usr/local/bin/start-services.sh

# Create the worker daemon script and install dependencies
COPY worker/worker-daemon.js /usr/local/bin/worker-daemon.js
COPY worker/browser-agent-runner.js /usr/local/bin/browser-agent-runner.js
RUN cd /usr/local/bin && npm install ws puppeteer-core ssh2

# Create the VNC auth proxy (token-based auth like VSCode)
COPY worker/vnc-auth-proxy.js /usr/local/bin/vnc-auth-proxy.js

# Make sure user can run services - add to sudoers
RUN echo "user ALL=(ALL) NOPASSWD:ALL" >> /etc/sudoers

# Set working directory
WORKDIR /home/user/workspace

# Environment variables
ENV DISPLAY=:1
ENV HOME=/home/user

# Expose ports (E2B handles exposure, no nginx needed)
EXPOSE 39377 39378 39380 5901 9222 10000

# Default command
CMD ["/usr/local/bin/start-services.sh"]
