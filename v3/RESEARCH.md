# Agent Nexus v3: research and direction

One page. What I looked at on 2026-11-14, what I took from each, and what v3 is because of it.

## References that moved the design

- **Territory Studio, Blade Runner 2049** ([case study](https://territorystudio.com/project/blade-runner-2049/), [AWN](https://www.awn.com/vfxworld/communicating-abstract-user-interfaces-blade-runner-2049), [Design Week](https://www.designweek.co.uk/issues/30-april-6-may-2018/graphic-design-blade-runner-2049-film-dad-festival/)). Villeneuve's four words were "abstract, organic, optical, physical", filler screens were banned, and the motion comes out of the asset instead of sitting on top of it. Taken: nothing moves in v3 unless an event made it move, and the picture is one physical system, not panels with an overlay.
- **GMUNK, Oblivion light table** ([project page](https://gmunk.com/OBLIVION-GFX/TRON-Concepts), [AWN interview](https://www.awn.com/vfxworld/crushing-the-user-interface-designs-of-oblivion)). Tools first, one bright palette over dark, one shared visual language across every screen, and the realism lives in small functional details. Taken: one grammar (cell body, axon, synapse) at every scale, and exact numbers set in type next to every form.
- **The GitHub globe** ([how it was built](https://github.blog/engineering/engineering-principles/how-we-built-the-github-globe/)). The team feared the arcs would read as decoration, so each arc is one real pull request you can open: "proof of life". Taken: every pulse is one real model call or tool call, and focusing a thread shows the actual words and commands behind it.
- **Flow as the picture**: the token-centric Sankey of [Transformer Explainer](https://arxiv.org/html/2408.04619v2), Brendan Bycroft's [LLM visualization](https://bbycroft.net/llm), and wind maps such as [earth.nullschool.net](https://earth.nullschool.net) (this last one from memory, not from today's search). Taken: draw the computation as matter moving through a structure. Here: quota flows from an account into a model, the model acts on the world, the result flows back.
- **Distill, The Building Blocks of Interpretability** ([article](https://distill.pub/2018/building-blocks/)). Separate content from presentation and let one mark be one unit whose size is its strength. Taken: unit marks. One dot in the focus instrument is a fixed number of output tokens, one tick on an axon is one model call.
- **A warning**: a critique of Refik Anadol's data sculptures ([Granular Material](https://dallascard.github.io/granular-material/post/refik-anadol/)) notes that the particle wave looks the same whatever the data is. Taken as the rule that keeps v3 from being cheese: no ambient particles, ever. An idle machine is a still, dark picture.
- **What exists for agents today** ([agent-visualization on GitHub](https://github.com/topics/agent-visualization), [VisualAgents](https://github.com/kaih06-hub/VisualAgents), [Graph of Trace](https://arxiv.org/abs/2606.15116)): swimlanes, Mermaid graphs, browser dashboards. Nobody draws the agent loop itself, live, at native pixels in the terminal. That is the gap.
- **The terminal itself**: the [Kitty graphics protocol](https://sw.kovidgoyal.net/kitty/graphics-protocol/) (placements, source rectangles, z, animation), [Ghostty 1.4.0](https://ghostty.org/docs/install/release-notes/1-4-0) (first complete implementation outside kitty; the host here is 1.4.0), and herdr 0.9.5's own re-emitter, read at its tag ([src/kitty_graphics.rs](https://github.com/herdrdev/herdr/blob/v0.9.5/src/kitty_graphics.rs)).

## What the terminal can do (measured in pane wE:pQ1, `v3/probe.json`)

- herdr keeps the pane's images in a Ghostty VT and re-emits to the host only three actions: upload (`a=t`), place (`a=p`) and delete. A placement whose image is unchanged but whose cell, source rectangle or z changed goes to Ghostty as one `a=p` of about 70 bytes. So: **upload an atlas once, then move sprites for free.** Moving 300 sprites costs 18 kB a frame and the pane answers in 2.0 ms (600 sprites: 37 kB, 2.5 ms; 60 frames of 300 back to back: 44 ms in total).
- herdr always sends the host a whole-cell box (`c`, `r`) for a placement, so a sprite is pixel exact only when its source window is a whole number of cells and it uses no cell offset. v3 therefore positions a sprite by sliding a cell-sized source window over a padded atlas tile. That is exact under both readings of the offset rule.
- z is forwarded, so a still layer (tiles, z 0) under a moving layer (sprites, z 1) costs nothing extra.
- **Animation frames are a dead end here.** The pane accepts `a=f` (it answers OK) but herdr never forwards `a=f` or `a=a`, so the host would not play anything. Feature queries (`e=`) are not answered either.
- Mouse mode 1000 is accepted by the pane; whether herdr forwards real clicks could not be tested from here, so v3 stays keyboard driven.

## The direction: a living circuit

v2 is a flight recorder: lanes on a time axis. It is exact, and it reads as a monitoring chart because it shows that work happened. v3 shows the work happening. **Every thread is drawn as a neuron, and the swarm is the circuit.**

- The cell body is the model. A pulse runs into it from its account's rail each time a model call lands.
- The axon carries the thread's own words (the live tail of what it is thinking or running) and a drifting train of ticks, one per model call.
- Synapses fan out to ports for what the model acts on: shell, read, write, web, you. A tool call is a pulse out, a stream that stays lit for exactly as long as the call runs, and a pulse back into the cell body when the result returns. Subagents hang off their parent the same way.
- One thread is always in focus (it follows the action unless you lock it with the keyboard) and is shown large: a ring for the turn against what such turns usually take, a ring for the context window, a bloom of dots for the output tokens of the turn, and the live text.

Why this beats v2 for this operator: the motion is the data (think, act, observe is literally visible as a loop of light), an idle machine goes dark and costs nothing, and because the moving parts are sprites the liveliest frame is a few kilobytes instead of re-sent pixels. v2 stays the tool for "what happened in the last quarter hour"; v3 is the thing you watch.
