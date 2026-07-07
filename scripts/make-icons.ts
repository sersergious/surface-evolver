/**
 * Generate app icons from assets/icon.svg:
 *   - assets/icon.iconset/  (macOS iconset source)
 *   - assets/icon.png       (Linux; desktop entry / window icon)
 *
 * Uses macOS `sips` to rasterize + resize, so this only runs on a Mac.
 * Outputs are committed — CI/Linux builds never regenerate icons.
 * Re-run after editing icon.svg:  bun run icons
 */
import { $ } from "bun";
import { mkdirSync, rmSync, existsSync, statSync } from "fs";
import { join } from "path";

if (process.platform !== "darwin")
  throw new Error("make-icons needs macOS (sips). Icons are committed; regenerate on a Mac.");

const SVG = "assets/icon.svg";
const MASTER = "/tmp/se-icon-1024.png";

// 1. Rasterize the SVG to a 1024 master PNG.
await $`sips -s format png -Z 1024 ${SVG} --out ${MASTER}`.quiet();
if (!existsSync(MASTER) || statSync(MASTER).size === 0)
  throw new Error(`make-icons: sips produced no output for ${SVG}`);

async function resize(size: number, out: string) {
  await $`sips -z ${size} ${size} ${MASTER} --out ${out}`.quiet();
}

// 2. macOS .iconset (Apple's required names/sizes).
const ISET = "assets/icon.iconset";
rmSync(ISET, { recursive: true, force: true });
mkdirSync(ISET, { recursive: true });
const iconset: [string, number][] = [
  ["icon_16x16.png", 16], ["icon_16x16@2x.png", 32],
  ["icon_32x32.png", 32], ["icon_32x32@2x.png", 64],
  ["icon_128x128.png", 128], ["icon_128x128@2x.png", 256],
  ["icon_256x256.png", 256], ["icon_256x256@2x.png", 512],
  ["icon_512x512.png", 512], ["icon_512x512@2x.png", 1024],
];
for (const [name, size] of iconset) await resize(size, join(ISET, name));

// 3. Linux desktop/window icon (single PNG).
await resize(512, "assets/icon.png");

console.log(`icons: ${ISET} (${iconset.length} pngs) + assets/icon.png`);
