// Builds the vendored Google Maps scraper (Go) into services/gmaps-scraper/bin/.
// Requires Go (see services/gmaps-scraper/go.mod for the version). Alternative without Go: install Docker Desktop;
// RumiReach then runs the gosom/google-maps-scraper image automatically.
import { spawnSync } from "node:child_process";
import { mkdirSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");
const dir = join(root, "services", "gmaps-scraper");
const out = join(dir, "bin", process.platform === "win32" ? "google-maps-scraper.exe" : "google-maps-scraper");
mkdirSync(dirname(out), { recursive: true });
const build = spawnSync("go", ["build", "-ldflags=-w -s", "-o", out, "."], { cwd: dir, stdio: "inherit", env: { ...process.env, CGO_ENABLED: "0" } });
if (build.error || build.status !== 0) {
  console.error("\nGo build failed. Install Go (https://go.dev/dl/) or use Docker Desktop instead.");
  process.exit(build.status || 1);
}
console.log("Built " + out);
// Playwright needs a Chromium download once; the scraper has a built-in installer mode.
const install = spawnSync(out, [], { cwd: dir, stdio: "inherit", env: { ...process.env, PLAYWRIGHT_INSTALL_ONLY: "1" } });
if (install.status !== 0) console.error("Playwright browser install did not finish; run it again with PLAYWRIGHT_INSTALL_ONLY=1.");
