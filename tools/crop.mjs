// Cuts a region out of a PNG at full size, for looking at detail: crop.mjs in.png x y w h out.png
import { createCanvas, loadImage } from "@napi-rs/canvas"
import fs from "node:fs"
const [input, x, y, w, h, output] = process.argv.slice(2)
const image = await loadImage(input)
const canvas = createCanvas(Number(w), Number(h))
canvas.getContext("2d").drawImage(image, -Number(x), -Number(y))
fs.writeFileSync(output, canvas.toBuffer("image/png"))
