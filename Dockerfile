# syntax=docker/dockerfile:1
# RumiReach in one image: dashboard + API + the bundled Google Maps scraper (with Chromium).
# Not tested in CI yet — build with:  docker compose up -d --build
ARG GO_VERSION=1.27.4

# Chromium + Playwright driver for the scraper (same approach as the upstream scraper image)
FROM golang:${GO_VERSION}-trixie AS playwright-deps
ENV PLAYWRIGHT_BROWSERS_PATH=/opt/browsers
ENV PLAYWRIGHT_DRIVER_PATH=/opt/ms-playwright-go
ARG PLAYWRIGHT_GO_VERSION=v0.6100.0
RUN apt-get update \
    && apt-get install -y --no-install-recommends ca-certificates \
    && apt-get clean && rm -rf /var/lib/apt/lists/* \
    && go install github.com/mxschmitt/playwright-go/cmd/playwright@${PLAYWRIGHT_GO_VERSION} \
    && mkdir -p /opt/browsers \
    && playwright install chromium --with-deps

# The scraper binary
FROM golang:${GO_VERSION}-trixie AS scraper-build
WORKDIR /src
COPY services/gmaps-scraper/go.mod services/gmaps-scraper/go.sum ./
RUN go mod download
COPY services/gmaps-scraper/ ./
RUN CGO_ENABLED=0 go build -ldflags="-w -s" -o /out/google-maps-scraper .

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
COPY --from=playwright-deps /opt/browsers /opt/browsers
COPY --from=playwright-deps /opt/ms-playwright-go /opt/ms-playwright-go
COPY --from=scraper-build /out/google-maps-scraper /usr/local/bin/google-maps-scraper
RUN chmod -R 755 /opt/browsers /opt/ms-playwright-go
WORKDIR /app
COPY --from=app-build /app /app
VOLUME /data
EXPOSE 4317
CMD ["node", "apps/api/dist/index.js"]
