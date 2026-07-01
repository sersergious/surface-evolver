/**
 * Generate app icons from assets/icon.svg:
 *   - assets/icon.iconset/  (macOS; electrobun runs iconutil → .icns)
 *   - assets/icon.ico       (Windows; PNG-in-ICO container)
 *
 * Uses macOS `sips` to rasterize + resize. Re-run after editing icon.svg.
 */
import { $ } from "bun";
import { mkdirSync, rmSync, readFileSync, writeFileSync } from "fs";
import { join } from "path";

const SVG = "assets/icon.svg";
const MASTER = "/tmp/se-icon-1024.png";

// 1. Rasterize the SVG to a 1024 master PNG.
await $`sips -s format png -Z 1024 ${SVG} --out ${MASTER}`.quiet();

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

// 3. Windows .ico — PNG-in-ICO container (Vista+).
const icoSizes = [16, 24, 32, 48, 64, 128, 256];
const pngs = await Promise.all(icoSizes.map(async (s) => {
  const p = `/tmp/se-ico-${s}.png`;
  await resize(s, p);
  return { size: s, data: readFileSync(p) };
}));

const count = pngs.length;
const header = Buffer.alloc(6 + 16 * count);
header.writeUInt16LE(0, 0);      // reserved
header.writeUInt16LE(1, 2);      // type: icon
header.writeUInt16LE(count, 4);  // image count
let offset = 6 + 16 * count;
const blobs: Buffer[] = [];
pngs.forEach(({ size, data }, i) => {
  const e = 6 + i * 16;
  header.writeUInt8(size >= 256 ? 0 : size, e);      // width  (0 = 256)
  header.writeUInt8(size >= 256 ? 0 : size, e + 1);  // height
  header.writeUInt8(0, e + 2);                        // palette
  header.writeUInt8(0, e + 3);                        // reserved
  header.writeUInt16LE(1, e + 4);                     // color planes
  header.writeUInt16LE(32, e + 6);                    // bits per pixel
  header.writeUInt32LE(data.length, e + 8);           // data size
  header.writeUInt32LE(offset, e + 12);               // data offset
  offset += data.length;
  blobs.push(data);
});
writeFileSync("assets/icon.ico", Buffer.concat([header, ...blobs]));

console.log(`icons: ${ISET} (${iconset.length} pngs) + assets/icon.ico (${count} sizes)`);
