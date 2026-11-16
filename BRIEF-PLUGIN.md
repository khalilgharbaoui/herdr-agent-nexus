# Brief: herdr-agent-nexus as an installable herdr plugin

Date: 2026-11-16. Directed from the AAV session (pane wE:pP0).

## The operator's words (verbatim)

> get rid of it and maybe i want to make my agent nexus similar as herdr-subagent-streamer
> maybe i want my nexus as herdr-agent-nexus on that store as well and be very usefull
> i want it on there and i want the streamer gone it sucks
> and we should use my nexus going forward from the packages
> and we continue building it

"it" = the herdr-subagent-streamer (gone: local checkout deleted, opencode launcher
removed; its packaging kept as reference in scratch/streamer-reference/).
"that store" = herdr's plugin install mechanism: installed plugins live under
~/.config/herdr/plugins/github/<id>-<hash>/ with a herdr-plugin.toml manifest,
registered in ~/.config/herdr/plugins.json. The one installed example on this
machine is Collie 1.10.2 (manifest with build + actions arrays).

## Goal

Agent Nexus becomes a herdr plugin named herdr-agent-nexus that anyone (first of
all the operator) installs through herdr's plugin mechanism and launches from
herdr itself, instead of running it from a checkout by hand. The GitHub repo is
already renamed: https://github.com/khalilgharbaoui/herdr-agent-nexus (private
for now; public is the operator's call when it is ready).

## Hard requirements

1. Research first, in this order, and write what you find to scratch/plugin-research.md:
   - the Collie manifest at ~/.config/herdr/plugins/github/herdr.collie-*/herdr-plugin.toml
     and ~/.config/herdr/plugins.json (what herdr actually reads);
   - the streamer reference in scratch/streamer-reference/ (manifest shape, bin layout);
   - how a plugin is INSTALLED from GitHub (herdr --help, herdr integration --help,
     herdr api --help, any plugin/store subcommand; herdr.dev docs if they exist).
     Do not guess the store mechanism: find the real install path.
2. A herdr-plugin.toml at the repo root: id khalilgharbaoui.agent-nexus, name
   "Agent Nexus", min_herdr_version from what we actually use (agent list JSON,
   pane send-text, placements: 0.9.5 is what we measured), platforms macos/linux,
   build and actions modelled on Collie's working manifest.
3. An action that launches the CURRENT version (v5) in a new herdr pane or tab and
   a way to stop it. The installed copy must not assume the dev checkout exists:
   it runs from wherever herdr installed it. node >= 22 with @napi-rs/canvas is a
   dependency the build step must handle (npm install in the plugin dir).
4. The operator's running v5 in wE:p1QF is never killed by install or test.
   Test launches go to their own pane and are cleaned up.
5. Prove it end to end on this machine: install through herdr's real mechanism
   (from the GitHub repo or a local path if that is what herdr supports), launch
   from the installed copy, see the live view render, stop it, and record the
   exact commands in scratch/plugin-research.md.
6. The dev workflow stays: running from the checkout keeps working.
7. Commit in small signed steps as always; if signing is refused use .git/step.sh.

## Out of scope for this brief

Making the repo public, store listing/submission to any central index (record in
scratch/plugin-research.md what submission would take, if a central store exists),
and the v5 feature backlog (landscape layout, 8+ thread minute), which continues
separately after this.
