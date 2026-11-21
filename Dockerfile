# syntax=docker/dockerfile:1
# RumiReach in one image: dashboard + API + the Google Maps scraper (with Chromium).
# Not tested in CI yet — build with:  docker compose up -d --build
# The Google Maps scraper (binary + its Chromium/Playwright driver) is taken from the upstream image,
# so updating it is just a rebuild:  docker compose build --pull
# Pin a version by setting SCRAPER_IMAGE, e.g. gosom/google-maps-scraper:v1.12.1
ARG SCRAPER_IMAGE=gosom/google-maps-scraper:latest
FROM ${SCRAPER_IMAGE} AS scraper

# RumiReach API + web
FROM node:24-trixie AS app-build
WORKDIR /app
COPY package.json package-lock.json ./
COPY packages/shared/package.json packages/shared/
COPY apps/api/package.json apps/api/
COPY apps/web/package.json apps/web/
RUN npm ci --no-audit --no-fund
COPY packages packages
COPY apps apps
RUN npm run build

# Runtime
FROM node:24-trixie-slim
ENV NODE_ENV=production \
    PLAYWRIGHT_BROWSERS_PATH=/opt/browsers \
    PLAYWRIGHT_DRIVER_PATH=/opt/ms-playwright-go \
    HOST=0.0.0.0 \
    PORT=4317 \
    RUMIREACH_DATA_DIR=/data \
    RUMIREACH_SCRAPER_BIN=/usr/local/bin/google-maps-scraper
RUN apt-get update && apt-get install -y --no-install-recommends \
    ca-certificates libnss3 libnspr4 libatk1.0-0 libatk-bridge2.0-0 libcups2 libdrm2 libdbus-1-3 \
    libxkbcommon0 libatspi2.0-0 libx11-6 libxcomposite1 libxdamage1 libxext6 libxfixes3 libxrandr2 \
    libgbm1 libpango-1.0-0 libcairo2 libasound2 \
    && apt-get clean && rm -rf /var/lib/apt/lists/*
COPY --from=scraper /opt/browsers /opt/browsers
COPY --from=scraper /opt/ms-playwright-go /opt/ms-playwright-go
COPY --from=scraper /usr/bin/google-maps-scraper /usr/local/bin/google-maps-scraper

# The upstream scraper image already applies the required permissions to these
# directories. Preserve those modes instead of recursively chmod-ing thousands
# of browser/driver files in a second image layer.
WORKDIR /app
COPY --from=app-build /app /app
VOLUME /data
EXPOSE 4317
HEALTHCHECK --interval=30s --timeout=5s --start-period=30s --retries=3 \
  CMD ["node", "-e", "fetch('http://127.0.0.1:4317/api/health').then((r) => process.exit(r.ok ? 0 : 1)).catch(() => process.exit(1))"]
CMD ["node", "apps/api/dist/index.js"]
