# =============================================================================
# Cerious AASM — Linux Docker image
# =============================================================================
# Targets:
#   base    — Debian Bookworm system packages (Electron, xvfb, SteamCMD i386)
#   build   — npm ci, Angular production build, Electron TypeScript, native rebuild
#   runtime — Headless app with the web UI, launched as a non-root user
#   test    — Electron Jest tests
# =============================================================================

# ---------------------------------------------------------------------------
# Stage: base — system dependencies
# ---------------------------------------------------------------------------
FROM node:22-bookworm AS base

ENV DEBIAN_FRONTEND=noninteractive

# Electron runtime libs, xvfb, SteamCMD 32-bit libs, and native-module build tools.
# libasound2 is the real ALSA library on Bookworm (there is no libasound2t64).
RUN dpkg --add-architecture i386 && apt-get update && apt-get install -y --no-install-recommends \
    curl wget tar gzip unzip p7zip-full ca-certificates \
    python3 python-is-python3 build-essential \
    xvfb xauth \
    fontconfig fonts-dejavu-core \
    procps \
    libasound2 libnss3 libatk1.0-0 libatk-bridge2.0-0 libcups2 libdrm2 \
    libxkbcommon0 libxcomposite1 libxdamage1 libxrandr2 libgbm1 \
    libpango-1.0-0 libcairo2 libgtk-3-0 libx11-xcb1 libxss1 \
    libc6:i386 libstdc++6:i386 lib32gcc-s1 \
    && rm -rf /var/lib/apt/lists/* \
    && fc-cache -f

RUN groupadd -r aasm && useradd -r -g aasm -m -d /home/aasm -s /bin/bash aasm

ENV PYTHON=/usr/bin/python3 \
    npm_config_python=/usr/bin/python3 \
    ELECTRON_DISABLE_SANDBOX=1 \
    HOME=/home/aasm

WORKDIR /app

# ---------------------------------------------------------------------------
# Stage: build — application compile and native modules
# ---------------------------------------------------------------------------
FROM base AS build

COPY package.json package-lock.json ./
# npm ci runs preinstall/postinstall before the rest of the source is copied.
COPY scripts/check-platform.js scripts/safe-postinstall.js scripts/

# Lifecycle scripts download Electron and attempt a native rebuild. The explicit
# electron-rebuild below is what must succeed; safe-postinstall exits 0 on failure.
RUN npm ci

COPY . .

# Optional. Leave the placeholder when unset so the image still builds.
ARG CURSEFORGE_API_KEY=
RUN if [ -n "$CURSEFORGE_API_KEY" ]; then \
      node -e "const fs=require('fs'); const p='src/environments/environment.prod.ts'; const key=process.env.CURSEFORGE_API_KEY; fs.writeFileSync(p, fs.readFileSync(p,'utf8').replaceAll('CURSEFORGE_KEY_PLACEHOLDER', key));"; \
    fi

RUN NODE_OPTIONS=--max-old-space-size=4096 npm run build \
    && find electron -name '*.js' -delete \
    && npx tsc -p tsconfig.electron.json \
    && npx electron-rebuild --force --only node-pty,bcrypt

RUN chown -R aasm:aasm /app /home/aasm

# ---------------------------------------------------------------------------
# Stage: test — electron-side Jest tests
# ---------------------------------------------------------------------------
FROM build AS test

USER aasm

CMD ["npx", "jest", "--config", "jest.config.js", "--testPathPatterns", "\\.test\\.ts$", "--forceExit"]

# ---------------------------------------------------------------------------
# Stage: runtime — headless web UI
# ---------------------------------------------------------------------------
FROM base AS runtime

ENV NODE_ENV=production
ENV AASM_DOCKER=1

RUN mkdir -p /tmp/.X11-unix /home/aasm/.local/share/cerious-aasm /home/aasm/.config \
    && chmod 1777 /tmp/.X11-unix \
    && chown -R aasm:aasm /home/aasm

COPY --from=build --chown=aasm:aasm /app/package.json /app/package-lock.json ./
COPY --from=build --chown=aasm:aasm /app/node_modules ./node_modules
COPY --from=build --chown=aasm:aasm /app/dist ./dist
COPY --from=build --chown=aasm:aasm /app/electron ./electron
COPY scripts/docker-entrypoint.sh /usr/local/bin/docker-entrypoint.sh
RUN sed -i 's/\r$//' /usr/local/bin/docker-entrypoint.sh \
    && chmod 755 /usr/local/bin/docker-entrypoint.sh

EXPOSE 3000

VOLUME ["/home/aasm/.local/share/cerious-aasm", "/home/aasm/.config"]

USER aasm

ENTRYPOINT ["/usr/local/bin/docker-entrypoint.sh"]
