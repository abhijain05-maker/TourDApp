// Draws the extension's icons (a rounded square with a gradient and a white "T") into extension/icons/*.png.
// Plain Node, no image library: the PNG is written by hand. Run: node scripts/make-extension-icons.mjs
import { mkdirSync, writeFileSync } from 'node:fs'
import { deflateSync } from 'node:zlib'
import { fileURLToPath } from 'node:url'

const root = fileURLToPath(new URL('..', import.meta.url))

const crcTable = Array.from({ length: 256 }, (_, n) => {
  let c = n
  for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1
  return c >>> 0
})
const crc32 = (buf) => {
  let c = 0xffffffff
  for (const b of buf) c = crcTable[(c ^ b) & 0xff] ^ (c >>> 8)
  return (c ^ 0xffffffff) >>> 0
}
const chunk = (type, data) => {
  const out = Buffer.alloc(12 + data.length)
  out.writeUInt32BE(data.length, 0)
  out.write(type, 4, 'ascii')
  data.copy(out, 8)
  out.writeUInt32BE(crc32(out.subarray(4, 8 + data.length)), 8 + data.length)
  return out
}

function png(size) {
  const raw = Buffer.alloc((size * 4 + 1) * size)
  const radius = size * 0.22
  const A = [10, 110, 209]
  const B = [106, 79, 216]
  // the "T": a bar on top and a stem
  const bar = { x0: size * 0.24, x1: size * 0.76, y0: size * 0.24, y1: size * 0.4 }
  const stem = { x0: size * 0.43, x1: size * 0.57, y0: size * 0.24, y1: size * 0.78 }
  const inside = (r, x, y) => x >= r.x0 && x <= r.x1 && y >= r.y0 && y <= r.y1
  for (let y = 0; y < size; y++) {
    raw[y * (size * 4 + 1)] = 0
    for (let x = 0; x < size; x++) {
      // coverage of the rounded square (anti-aliased by 4x4 supersampling)
      let cover = 0
      let white = 0
      for (let sy = 0; sy < 4; sy++)
        for (let sx = 0; sx < 4; sx++) {
          const px = x + (sx + 0.5) / 4
          const py = y + (sy + 0.5) / 4
          const cx = Math.min(Math.max(px, radius), size - radius)
          const cy = Math.min(Math.max(py, radius), size - radius)
          if ((px - cx) ** 2 + (py - cy) ** 2 <= radius ** 2) {
            cover++
            if (inside(bar, px, py) || inside(stem, px, py)) white++
          }
        }
      const t = (x + y) / (2 * size)
      const o = y * (size * 4 + 1) + 1 + x * 4
      const w = cover ? white / cover : 0
      for (let i = 0; i < 3; i++) raw[o + i] = Math.round((A[i] + (B[i] - A[i]) * t) * (1 - w) + 255 * w)
      raw[o + 3] = Math.round((cover / 16) * 255)
    }
  }
  const header = Buffer.alloc(13)
  header.writeUInt32BE(size, 0)
  header.writeUInt32BE(size, 4)
  header[8] = 8 // bit depth
  header[9] = 6 // RGBA
  return Buffer.concat([
    Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
    chunk('IHDR', header),
    chunk('IDAT', deflateSync(raw)),
    chunk('IEND', Buffer.alloc(0)),
  ])
}

mkdirSync(root + 'extension/icons', { recursive: true })
for (const size of [16, 32, 48, 128]) writeFileSync(root + `extension/icons/icon-${size}.png`, png(size))
console.log('wrote extension/icons/icon-{16,32,48,128}.png')
