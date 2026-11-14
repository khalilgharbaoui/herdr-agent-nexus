#!/usr/bin/env node
// Writes synthetic input into the pane that runs v5, to test its own handling of the mouse and
// the keys without a hand on the mouse. The bytes are the reports a terminal would send (SGR
// with pixels, counted from 1 as herdr does), written with `herdr pane send-text`.
//
//   node v5/tools/poke.mjs wE:p1Q1 "move:420,1055;wait:400;click:420,1055;key:i"
//   node v5/tools/poke.mjs wE:p1Q1 --sweep 400     400 moves along a diagonal, as fast as herdr takes them
//
// Verbs: move:x,y  click:x,y  middle:x,y  wheel:x,y,1 (down) or -1 (up)  key:<char or name>  wait:ms
// This tests v5, not herdr's forwarding of a real mouse: for that, use the mouse.

import { execFileSync } from "node:child_process"
import { sgr } from "../src/input.mjs"

const [pane, ...rest] = process.argv.slice(2)
if (!pane || !rest.length) {
  console.error('usage: poke.mjs <pane id> "move:x,y;click:x,y;key:?;wait:300" | --sweep <count>')
  process.exit(1)
}
const NAMED = { enter: "\r", tab: "\t", escape: "\x1b", space: " ", up: "\x1b[A", down: "\x1b[B", left: "\x1b[D", right: "\x1b[C", pageup: "\x1b[5~", pagedown: "\x1b[6~", backtab: "\x1b[Z" }
const send = (text) => execFileSync("herdr", ["pane", "send-text", pane, text], { stdio: "ignore" })
const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms))
const options = { pixels: true, origin: 1 }

if (rest[0] === "--sweep") {
  const count = Number(rest[1] ?? 300)
  const started = Date.now()
  for (let index = 0; index < count; index += 1) send(sgr("move", 200 + ((index * 5) % 1400), 900 + ((index * 3) % 900), options))
  console.log(`${count} moves in ${Date.now() - started} ms`)
} else {
  for (const part of rest.join(" ").split(";").map((entry) => entry.trim()).filter(Boolean)) {
    const [verb, value = ""] = part.split(":")
    const [x, y, amount] = value.split(",").map(Number)
    if (verb === "wait") await sleep(x)
    else if (verb === "key") send(NAMED[value] ?? value)
    else if (verb === "move") send(sgr("move", x, y, options))
    else if (verb === "click" || verb === "middle") {
      const button = verb === "click" ? "left" : "middle"
      send(sgr("down", x, y, { ...options, button }))
      send(sgr("up", x, y, { ...options, button }))
    } else if (verb === "wheel") send(sgr(amount < 0 ? "wheel-up" : "wheel-down", x, y, options))
    else console.error(`unknown verb ${verb}`)
    await sleep(120)
  }
}
