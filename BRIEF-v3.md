# Agent Nexus v3 brief

You are building v3 of Agent Nexus: a live, animated view of every opencode session, subagent and herdr agent on Khalil's Mac, drawn with Skia (`@napi-rs/canvas`) in Node and shown in the terminal through the Kitty graphics protocol. You have full creative lead. `BRIEF-v2.md` in this folder holds the original brief: the operator's earlier words, the data sources, the measured terminal facts and the hard requirements. Everything in it still holds unless this file says otherwise. Read it after this one.

## What the operator said about v2 (verbatim)

> "its sharp yes but it misses that live interactiveness look and feel it somehow feels like ruby/rails performance charts which is ok maybe does not make sense in 2026 i want that AI live feel future stuff accurate but awesome and breath takingly impressive and performant"

> "keep v1 and v2 make a v3 that is above and beyond anything
> also make sure to check online what is out there and inspire"

And about v1, before v2 was built: "i feel its LCD quality ... not flicker and keep a lot of dark from the terminal ... way more than a radar with a solar system but great and enjoyable for a developer and si-fi fan but solid and good not cheese", "sharp cool awesome above and beyond impressive".

Read that together: v2 fixed sharpness, darkness, flicker and accuracy, and it is respected for that, but it reads as a monitoring dashboard (lanes, axes, panels, sparklines). v3 must feel alive: like watching intelligence at work, in real time, with motion that means something. Accurate (every visual driven by real data), breathtaking, performant, and not cheesy (no fake hacker text, no scanlines, no lens flares for their own sake, no random particles that encode nothing).

## Keep v1 and v2 untouched

- v1 runs from `v1/` (`node --no-warnings v1/nexus.mjs`), tag `v1`.
- v2 runs from the repo root (`node --no-warnings nexus.mjs`, with `src/`, `encoder.mjs`, `tools/`), tag `v2`.
- Build v3 in `v3/` with its own entry (`v3/nexus.mjs` or similar). Do not modify v2's files (`nexus.mjs`, `encoder.mjs`, `src/*`). If you want something from `src/` (the tile transport, the data model, the herdr and opencode readers), copy it into `v3/` and change the copy. `node_modules` at the root resolves from `v3/` as well.

## Phase 1: research online, then choose (time-box it)

Search the web for what exists and what the best people in this space have done, and let it raise the bar. Keep this phase short and purposeful: you are looking for ideas, techniques and a quality bar, not writing a survey. Places worth looking (not a required list, follow what is good):

- Film and game UI (FUI): Territory Studio, Perception, GMUNK (Tron: Legacy, Oblivion), Cantina Creative, Ash Thorp; the Iron Man / JARVIS interfaces; Blade Runner 2049, Arrival, Dune UI work. Note what makes the good ones feel *real*: restraint, typography, hierarchy, purposeful motion.
- Live data and AI-agent visualisations: agent-trace and observability tools (LangSmith, Langfuse, Arize Phoenix, Weights & Biases, Rerun.io), neural-net activation and attention visualisations (Distill.pub, the "transformer explainer" and LLM visualisation work, Anthropic's interpretability visuals), GitHub's globe, Stripe's and Vercel's live-data visuals, real-time flight and network maps.
- Terminal graphics at the edge: Kitty graphics protocol demos (including placements, z-index layering, unicode placeholders and the animation frames protocol), notcurses, Ghostty, chafa, Carbonyl, `ratatui` showcases, shader-like art in the terminal.
- Generative and shader art that encodes data: flow fields, reaction-diffusion, particle systems driven by signals (Inigo Quilez, Shadertoy, Refik Anadol's data sculptures, Zach Lieberman).

Write `v3/RESEARCH.md`: a short list of the references that actually moved you (with links), what you take from each, and then the direction you chose and why it beats v2 for this operator. One page, not more.

## Phase 2: build

Hard requirements (carried over from v2, still binding):

- Native resolution, 1:1 with the pane's pixel grid; crisp type.
- No flicker. Only what changes is sent; never erase before the replacement is in place.
- Transparent where nothing is drawn, so the terminal's own dark shows through.
- Every visual element is driven by real data from the sources in `BRIEF-v2.md` (and any new read-only source you add). A demo mode with simulated activity stays available (`d` key) and is labelled as such on screen.
- Performant: measure and report fps, CPU, bytes per second and frame timings. Target 30 fps where motion matters, low CPU when the machine is quiet, and graceful degradation (not a frozen screen) when the Mac is under load. Earlier tonight it ran at load 50 to 170 with swap nearly full; it is calm now.

Technical avenues worth probing in herdr inside Ghostty before you commit to a design, because "live" motion and "only send what changed" pull in opposite directions:

- Kitty placements: upload an image once, then move or re-stack its placements (`a=p` with cell position, `X`/`Y` pixel offsets and `z`) by sending a few bytes per frame instead of pixels. Sprites, glyph atlases and particles could move this way almost for free.
- z-index layering: a static high-resolution layer under small animated layers, each with its own image id.
- The animation frames protocol (`a=f` to add frames, `a=a` to play): the terminal animates by itself with no per-frame transfer.
- Whatever else you find in phase 1.

Probe each in herdr before relying on it; herdr is a Kitty-graphics re-emitter and may support some of these and not others. Report what you measured.

"Live interactiveness" may also mean real interaction: keyboard focus to dive into one thread, a live tail of what a model is doing, mouse if herdr forwards it. Your call, but if you add it, it must work.

Known data limits, so you design with them rather than against them: opencode 2 writes a step's text when the step ends (text arrives in bursts; tool calls show as they start and end); the plugin's `turn-progress.json` gives output tokens per API call; Claude Code's own transcripts under `~/.claude*/projects/<encoded cwd>/<session>.jsonl` are written per content block and may give you finer-grained activity (read-only, and read only what you need). Check what is actually available before promising it on screen.

## Process

- Look at your own output: render frames headless and Read the PNGs, and use the SIGUSR1-style snapshot of the live view. Screen capture commands may be declined by the operator's permissions; do not depend on them.
- Run v3 live in the right-hand herdr pane `wE:pQ1` (v2 is running there now; quit it with `q` first). Leave v3 running when you finish.
- Commit checkpoints in this repo as you go, short plain messages, no co-author trailer, never push (there is no remote). Commits are signed through 1Password; if signing hangs, leave the change staged and say so, never bypass signing.
- This runs on a shared account at high effort: stay focused on the deliverable, avoid long exploratory loops, and prefer looking at rendered frames over re-reading large files.
- Work only inside `~/code/Private/agent-nexus`. Read the data sources read-only. Never print credentials or secrets.
- Never use em dashes in anything you write (code comments, docs, commit messages, your report).

## Report back

When v3 runs live and you have checked it: what v3 is and the idea behind it (what you took from the research), how each of the operator's words is answered, the measurements (fps, CPU, bytes, timings, live and under stress), what you could not verify, how to run v1, v2 and v3, and the commits. Keep the report tight.
