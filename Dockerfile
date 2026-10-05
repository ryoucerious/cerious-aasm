# Cerious AASM - Linux Docker image.
# Targets: base (Debian Bookworm packages: Electron libs, xvfb, SteamCMD i386 libs),
# build (npm ci, Angular and Electron compile, native rebuild),
# runtime (headless app with the web UI, non-root), test (Electron Jest tests).

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

FROM base AS build

COPY package.json package-lock.json ./
# npm ci runs preinstall/postinstall before the rest of the source is copied.
COPY scripts/check-platform.js scripts/safe-postinstall.js scripts/

# Lifecycle scripts download Electron and attempt a native rebuild. The explicit
# electron-rebuild below is what must succeed; safe-postinstall exits 0 on failure.
RUN npm ci

COPY . .

# Optional CurseForge key, a build secret rather than an ARG so it stays out of
# image history. If unset the placeholder remains and the image still builds.
# See docs/DOCKER.md.
RUN --mount=type=secret,id=curseforge_api_key \
    if [ -s /run/secrets/curseforge_api_key ]; then \
      node -e " \
        const fs = require('fs'); \
        const p = 'src/environments/environment.prod.ts'; \
        const key = fs.readFileSync('/run/secrets/curseforge_api_key', 'utf8').trim(); \
        fs.writeFileSync(p, fs.readFileSync(p, 'utf8').replaceAll('CURSEFORGE_KEY_PLACEHOLDER', key)); \
      "; \
    fi

RUN NODE_OPTIONS=--max-old-space-size=4096 npm run build \
    && npx tsc -p tsconfig.electron.json \
    && npx electron-rebuild --force --only node-pty,bcrypt

RUN chown -R aasm:aasm /app /home/aasm

FROM build AS test

USER aasm

CMD ["npm", "run", "test:electron"]

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

# start-period covers Xvfb plus Electron startup before the web server is up.
HEALTHCHECK --interval=30s --timeout=5s --start-period=40s --retries=3 \
    CMD curl -fsS "http://127.0.0.1:${AASM_PORT:-3000}/api/auth-status" || exit 1

VOLUME ["/home/aasm/.local/share/cerious-aasm", "/home/aasm/.config"]

# Starts as root so the entrypoint can apply PUID/PGID and fix folder ownership;
# it then runs the app as aasm.
ENTRYPOINT ["/usr/local/bin/docker-entrypoint.sh"]
