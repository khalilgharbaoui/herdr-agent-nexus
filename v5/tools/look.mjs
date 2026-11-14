// Cuts a region out of one or more PNGs and scales it, for looking at detail or at motion.
//   look.mjs out.png x y w h scale in.png [in2.png ...]
// Several inputs are set side by side as a strip (wrapped to rows of four), so a short sequence
// of frames can be read in one picture.
import { createCanvas, loadImage } from "@napi-rs/canvas"
import fs from "node:fs"

const [output, x, y, w, h, scale, ...inputs] = process.argv.slice(2)
const [X, Y, W, H, S] = [x, y, w, h, scale].map(Number)
const perRow = Math.min(4, inputs.length)
const rows = Math.ceil(inputs.length / perRow)
const tileW = Math.round(W * S)
const tileH = Math.round(H * S)
const gap = inputs.length > 1 ? 6 : 0
const canvas = createCanvas(perRow * tileW + (perRow - 1) * gap, rows * tileH + (rows - 1) * gap)
const context = canvas.getContext("2d")
context.fillStyle = "#000000"
context.fillRect(0, 0, canvas.width, canvas.height)
for (const [index, input] of inputs.entries()) {
  const image = await loadImage(input)
  const left = (index % perRow) * (tileW + gap)
  const top = Math.floor(index / perRow) * (tileH + gap)
  context.drawImage(image, X, Y, W, H, left, top, tileW, tileH)
}
fs.writeFileSync(output, canvas.toBuffer("image/png"))
console.log(`${output}  ${canvas.width}x${canvas.height}`)
