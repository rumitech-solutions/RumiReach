# Upstream notice

This directory is a vendored copy of **gosom/google-maps-scraper** (https://github.com/gosom/google-maps-scraper), distributed upstream under the MIT License.
The source is unmodified except that demo images, the project banner and local test SSH keys were removed to keep the repository small.
Before redistributing, add the upstream `LICENSE` file here (it was not included in the supplied archive).

RumiReach runs it as a local child process (see `apps/api/src/scraper.ts`). Build it with `npm run build:scraper` (needs Go) or just install Docker Desktop and RumiReach will use the `gosom/google-maps-scraper` image.
