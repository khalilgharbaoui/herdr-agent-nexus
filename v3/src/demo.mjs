// Simulated data with the same shape the live source produces, for --demo and for design work.

import { contextLimit, mulberry32 } from "./util.mjs"

const CAST = [
  { title: "Checkout: split payment intents per seller", agent: "build", model: "claude-opus-5-5", effort: "xhigh", account: "default", pane: "w2:p1", kids: ["implementor", "explore"] },
  { title: "Design system token audit", agent: "designer", model: "claude-fable-5-2", effort: "max", account: "appical", pane: "w2:p3", kids: ["designer"] },
  { title: "Move reporting queries to the read replica", agent: "plan", model: "claude-sonnet-5-5", effort: "high", account: "appical", pane: "w3:p1", kids: ["explore", "implementor"] },
  { title: "Flaky spec hunt in the onboarding suite", agent: "build", model: "claude-haiku-5-5", effort: "medium", account: "default", pane: "w3:p2", kids: [] },
  { title: "Sidebar progress estimator: calibration pass", agent: "build", model: "claude-opus-5-5", effort: "max", account: "default", pane: "w5:p1", kids: ["implementor", "implementor", "general"] },
  { title: "Local model eval: tool calling under load", agent: "build", model: "qwen3-coder-30b", effort: "", account: "local", pane: "w5:p4", kids: [] },
  { title: "Release notes and changelog for 0.74", agent: "writer", model: "claude-sonnet-5-5", effort: "medium", account: "appical", pane: "w6:p2", kids: [] },
]
const KID_MODEL = { implementor: "claude-opus-5-5", explore: "claude-haiku-5-5", designer: "claude-fable-5-2", general: "claude-sonnet-5-5" }
const KID_TITLES = [
  "Trace the webhook retry path",
  "Write the migration and its spec",
  "Map every caller of legacy_totals",
  "Contrast check across both themes",
  "Port the estimator to log space",
  "Reproduce the race under load",
  "Audit spacing tokens in the sidebar",
  "Find where the cache key is built",
]
const IDLE_TITLES = [
  "Rotate the staging credentials",
  "Why is the sidekiq queue backing up",
  "Draft the incident review",
  "Explain this flamegraph",
  "Upgrade to Rails 8.1",
  "Scan my zshrc for slow plugins",
  "Tune the Postgres autovacuum",
  "Review PR 2989",
  "Spike: streaming exports",
  "Worklog for Thursday",
  "Shader for the hero background",
  "Bisect the slow boot",
  "Sketch the billing data model",
  "Kubernetes cost report",
  "Fix the i18n fallback chain",
  "Compare vector stores",
  "Notes on the read-only MCP",
  "Trim the Docker image",
  "Audit feature flags",
  "Onboarding copy pass",
  "Benchmark the new parser",
  "Clean up the dotfiles",
]
const TOOLS = [
  ["read", 30, [8, 60]],
  ["grep", 14, [10, 120]],
  ["glob", 6, [8, 60]],
  ["edit", 16, [8, 40]],
  ["write", 5, [8, 40]],
  ["shell", 22, [300, 42000]],
  ["webfetch", 4, [900, 7000]],
  ["todowrite", 3, [5, 20]],
]
const LABELS = {
  read: ["src/turn-model.ts", "app/models/order.rb", "spec/requests/checkout_spec.rb", "docs/accounts.md", "src/progress-line.ts"],
  grep: ["legacy_totals", "sessionTag\\(", "def refund", "TODO|FIXME", "cacheKey"],
  glob: ["**/*.test.ts", "app/services/**/*.rb", "db/migrate/*.rb"],
  edit: ["src/turn-model.ts", "app/services/payments/split.rb", "src/account-sidebar.ts", "config/routes.rb"],
  write: ["spec/services/payments/split_spec.rb", "db/migrate/20261114_add_seller_ref.rb", "docs/estimator.md"],
  shell: ["npm test", "bundle exec rspec spec/services", "npm run typecheck", "git diff --stat", "bin/rails db:migrate", "rg -n webhook app/", "docker compose up -d"],
  webfetch: ["docs.stripe.com/payments/payment-intents", "postgresql.org/docs/current/hot-standby", "github.com/opencode-ai/opencode/releases"],
  todowrite: ["4 todos", "6 todos"],
}

// What the simulated models think and say. Demo only: none of this is real output.
const THINK = [
  "The spec fails only when the worker and the web process both touch the row, so the lock order matters more than the query.",
  "Before changing the estimator I should read how the sidebar consumes it, otherwise the units will drift apart.",
  "Two callers pass a cents integer and one passes a decimal string. That is the bug, not the rounding.",
  "The replica lags by a few hundred milliseconds under load, so anything that reads its own write has to stay on the primary.",
  "If the token is renamed the dark theme inherits it for free, the light theme has an override that will go stale.",
  "The retry path swallows the first error and reports the second, which is why the logs point at the wrong line.",
  "A migration that adds the column with a default locks the table on this Postgres version. Add it nullable, backfill, then constrain.",
  "The simplest thing that could work is a guard at the seam, with a spec for both sides of it.",
  "This looks like a race but the timestamps say otherwise: the second request starts after the first one has committed.",
  "Reading the caller first. If nothing else uses the old signature, the change is three lines and a spec.",
]
const SAY = [
  "Found it: the idempotency key is built before the seller is known, so two sellers in one cart share a key.",
  "The audit is done. Eleven tokens are unused, four are duplicated under two names, and the spacing scale has one stray value.",
  "Moved the three reporting queries to the replica and left the dashboard counts on the primary, because they read their own writes.",
  "The spec was flaky because it asserted on the order of an unordered relation. It passes 200 runs in a row now.",
  "Calibration is in: the estimate now covers 81 of 100 held-out turns inside its band, up from 62.",
  "All green. Typecheck, 1,412 examples, 0 failures. The diff is 64 lines across three files.",
  "I split the payment intent per seller and kept the old path behind the flag, so it can be rolled back without a deploy.",
  "The changelog entry is written and the upgrade note calls out the one renamed option.",
]
const ASK = [
  "split the payment intent per seller and keep the old path behind a flag",
  "audit the design tokens and tell me what is unused or duplicated",
  "move the reporting queries to the read replica, carefully",
  "find out why the onboarding suite is flaky and fix the cause, not the symptom",
  "calibrate the progress estimator against the last month of turns",
  "run the tool calling eval under load and summarise the failures",
  "write the release notes for 0.74",
]

export class DemoSource {
  constructor(options) {
    this.options = options
    this.mode = "DEMO"
    this.random = mulberry32(20261114)
    this.sessions = []
    this.clock = 0
    this.serial = 0
  }

  pick(list) {
    return list[Math.floor(this.random() * list.length)]
  }

  between(low, high, skew = 1) {
    return low + (high - low) * this.random() ** skew
  }

  async open() {
    const now = Date.now()
    const start = now - this.options.historyMs - 4 * 60e3
    CAST.forEach((role, index) => {
      const session = this.spawn(role, null, start)
      session.nextAt = start + this.between(0, 150e3) + index * 9000
      session.context = this.between(0.12, 0.7) * contextLimit(role.model || "") || 60e3
      session.cost = this.between(2, 60)
    })
    this.idlePanes = IDLE_TITLES.map((title, index) => ({
      id: `w${[1, 1, 2, 3, 3, 4, 4, 4, 5, 6, 6, 7, 7, 7, 7, 8, 8, 9, 9, 9, 9, 9][index]}:p${index + 5}`,
      title,
      status: index === 3 || index === 12 ? "blocked" : index === 8 ? "done" : "idle",
      kind: index % 7 === 6 ? "claude" : "opencode",
      since: now - this.between(40e3, 900e3),
    }))
    this.accounts = [
      { name: "appical", tier: "Team", five: 31, seven: 44, fiveReset: now + 2.2 * 3600e3, sevenReset: now + 3.1 * 86400e3 },
      { name: "default", tier: "Max 5x", five: 68, seven: 27, fiveReset: now + 1.1 * 3600e3, sevenReset: now + 5.4 * 86400e3 },
    ]
    this.clock = start
    this.advance(now)
    // --demo-quiet: the same cast with nobody working and nobody waiting, to see a still machine
    if (this.options.quiet) {
      for (const session of this.sessions) {
        session.phase = "idle"
        session.nextAt = Infinity
        session.blockedUntil = 0
        session.idleSince ??= now - 120e3
        for (const step of session.steps) {
          step.endAt ??= now
          for (const tool of step.tools) if (!(tool.endAt <= now)) tool.endAt = now
        }
      }
      for (const pane of this.idlePanes) pane.status = "idle"
    }
  }

  close() {}

  spawn(role, parent, at) {
    this.serial += 1
    const session = {
      id: `ses_demo${String(this.serial).padStart(4, "0")}`,
      parentId: parent?.id ?? null,
      title: role.title,
      agent: role.agent,
      model: role.model,
      effort: role.effort ?? "",
      account: role.account,
      pane: role.pane ?? "",
      kids: role.kids ?? [],
      created: at,
      phase: "idle",
      nextAt: at,
      steps: [],
      marks: [],
      stepsLeft: 0,
      seq: 0,
      context: 40e3,
      cost: 0,
      turnOut: 0,
      turnStart: 0,
      outcome: "",
      blockedUntil: 0,
      liveKids: 0,
      done: false,
    }
    this.sessions.push(session)
    return session
  }

  startStep(session, at) {
    const duration = this.between(1400, 16000, 1.7)
    const step = { seq: (session.seq += 7), start: at, genEnd: at + duration, endAt: null, chars: Math.round((duration / 1000) * this.between(40, 520)), reasoning: [], tools: [], out: 0, final: session.stepsLeft <= 0 }
    if (this.random() < 0.7) {
      step.reasoning.push([at + 200, at + duration * this.between(0.25, 0.7)])
      step.think = `${this.pick(THINK)} ${this.pick(THINK)}`
    }
    if (step.final || this.random() < 0.25) step.say = step.final ? `${this.pick(SAY)} ${this.pick(SAY)}` : this.pick(SAY)
    step.out = Math.round(step.chars / 3.6)
    session.steps.push(step)
    session.phase = "gen"
    session.nextAt = step.genEnd
    session.current = step
  }

  endGeneration(session, at) {
    const step = session.current
    session.turnOut += step.out
    session.context += step.out + this.between(200, 4000)
    session.cost += step.out * 0.00004 + 0.01
    if (step.final) {
      step.endAt = at
      const failed = this.random() < 0.06
      session.outcome = failed ? "failed" : "succeeded"
      session.marks.push({ at, kind: "idle", outcome: session.outcome })
      session.phase = "idle"
      session.idleSince = at
      if (session.parentId) {
        session.done = true
        session.nextAt = Infinity
        const parent = this.sessions.find((candidate) => candidate.id === session.parentId)
        const tool = parent?.current?.tools.find((candidate) => candidate.child === session.id)
        if (tool) {
          tool.endAt = at + 150
          tool.fail = failed
          parent.liveKids -= 1
          parent.nextAt = Math.max(...parent.current.tools.map((candidate) => candidate.endAt))
        }
      } else {
        if (this.random() < 0.22) session.blockedUntil = at + this.between(25e3, 110e3)
        session.nextAt = at + this.between(12e3, 150e3, 1.4)
      }
      return
    }
    const count = this.random() < 0.72 ? 1 : this.random() < 0.7 ? 2 : 3
    let latest = at
    for (let index = 0; index < count; index += 1) {
      const canDispatch = !session.parentId && session.kids.length && session.liveKids < 2 && this.random() < 0.16
      if (canDispatch) {
        const agent = this.pick(session.kids)
        const child = this.spawn({ title: this.pick(KID_TITLES), agent, model: KID_MODEL[agent], effort: agent === "explore" ? "low" : "high", account: session.account }, session, at)
        child.nextAt = at + 400
        session.liveKids += 1
        step.tools.push({ id: `tool_${child.id}`, name: "subagent", label: child.title, start: at, endAt: Infinity, child: child.id })
        latest = Infinity
        continue
      }
      let roll = this.random() * TOOLS.reduce((sum, tool) => sum + tool[1], 0)
      const tool = TOOLS.find((candidate) => (roll -= candidate[1]) < 0) ?? TOOLS[0]
      const endAt = at + this.between(tool[2][0], tool[2][1], tool[0] === "shell" ? 3 : 1.5)
      step.tools.push({ id: `tool_${session.id}_${step.seq}_${index}`, name: tool[0], label: this.pick(LABELS[tool[0]]), start: at, endAt, fail: this.random() < 0.045 })
      latest = Math.max(latest, endAt)
    }
    session.phase = "tools"
    session.nextAt = latest
  }

  transition(session, at) {
    if (session.phase === "idle") {
      session.marks.push({ at, kind: "user", outcome: "", text: session.parentId ? session.title.toLowerCase() : this.pick(ASK) })
      session.turnStart = at
      session.turnOut = 0
      session.blockedUntil = 0
      session.stepsLeft = Math.round(session.parentId ? this.between(4, 22, 1.3) : this.between(3, 16, 1.5))
      this.startStep(session, at)
    } else if (session.phase === "gen") {
      this.endGeneration(session, at)
    } else {
      session.current.endAt = at
      session.stepsLeft -= 1
      this.startStep(session, at + 40)
    }
  }

  advance(to) {
    for (let at = this.clock; at <= to; at += 200) {
      for (let index = 0; index < this.sessions.length; index += 1) {
        const session = this.sessions[index]
        let guard = 0
        while (session.nextAt <= at && guard++ < 8) this.transition(session, session.nextAt)
      }
    }
    this.clock = to
    const horizon = to - this.options.historyMs - 60e3
    for (const session of this.sessions) {
      session.steps = session.steps.filter((step) => (step.endAt ?? Infinity) > horizon)
      session.marks = session.marks.filter((mark) => mark.at > horizon)
    }
    this.sessions = this.sessions.filter((session) => !(session.done && session.idleSince < horizon))
  }

  // One step as the live source would report it at `now`: reasoning lands when its span closes,
  // text and tool calls when generation ends.
  stepView(step, now) {
    const done = step.genEnd <= now
    const tools = done
      ? step.tools.map((tool) => ({
          id: tool.id,
          name: tool.name,
          label: tool.label,
          status: tool.endAt <= now ? (tool.fail ? "error" : "completed") : "running",
          start: tool.start === step.start ? step.genEnd : Math.max(tool.start, step.genEnd),
          end: tool.endAt <= now ? tool.endAt : null,
        }))
      : []
    const items = []
    const span = step.reasoning[0]
    if (step.think && span && span[1] <= now) items.push({ key: `${step.seq}:0`, kind: "think", text: step.think, length: step.think.length, at: span[0], end: span[1] })
    if (step.say && done) items.push({ key: `${step.seq}:1`, kind: "say", text: step.say, length: step.say.length, at: step.genEnd, end: step.genEnd })
    tools.forEach((tool, index) => items.push({ key: `${step.seq}:${index + 2}`, kind: "tool", tool, at: tool.start }))
    return {
      seq: step.seq,
      start: step.start,
      streamed: done ? step.genEnd : null,
      end: step.endAt !== null && step.endAt <= now ? step.endAt : null,
      finish: step.final ? "stop" : "tool-calls",
      out: done ? step.out : 0,
      chars: done ? step.chars : 0,
      reasoning: step.reasoning.filter((range) => range[0] <= now).map((range) => [range[0], range[1] <= now ? range[1] : null]),
      tools,
      items,
    }
  }

  poll(now) {
    this.advance(now)
    const sessions = this.sessions.map((session) => {
      const busy = session.phase !== "idle"
      const limit = contextLimit(session.model)
      const steps = session.steps.filter((step) => step.start <= now).map((step) => this.stepView(step, now))
      const tail = []
      for (const step of steps.slice(-5)) for (const item of step.items) tail.push(item)
      let prompt = ""
      for (const mark of session.marks) if (mark.kind === "user" && mark.at <= now && mark.text) prompt = mark.text
      return {
        lastOut: session.turnOut,
        tail: tail.slice(-14),
        prompt,
        id: session.id,
        parentId: session.parentId,
        title: session.title,
        agent: session.agent,
        model: session.model,
        provider: session.account === "local" ? "local" : "claude-code",
        effort: session.effort,
        account: session.account,
        busy,
        blocked: !busy && session.blockedUntil > now,
        outcome: busy ? "" : session.outcome,
        compacting: false,
        cost: session.cost,
        tokens: { input: 400, output: Math.round(session.cost * 9000), reasoning: 0, cacheRead: Math.round(session.context * 22), cacheWrite: Math.round(session.context * 1.4) },
        created: session.created,
        updated: busy ? now : (session.idleSince ?? session.created),
        busySince: session.turnStart,
        idleSince: session.idleSince ?? 0,
        context: { used: limit ? Math.min(session.context, limit * 0.97) : session.context, limit },
        turn: busy ? { start: session.turnStart, out: session.turnOut } : null,
        expect: session.account === "local" ? null : session.parentId ? { p25: 150e3, p50: 300e3, p75: 520e3, n: 24 } : { p25: 50e3, p50: 120e3, p75: 260e3, n: 48 },
        pane: session.pane,
        paneStatus: busy ? "working" : session.blockedUntil > now ? "blocked" : "idle",
        directory: "",
        steps,
        marks: session.marks.filter((mark) => mark.at <= now),
      }
    })
    const panes = []
    for (const session of sessions) {
      if (!session.pane) continue
      panes.push({ id: session.pane, workspace: session.pane.split(":")[0], status: session.paneStatus, kind: "opencode", title: session.title, sessionId: session.id, since: session.blocked ? session.idleSince : 0 })
    }
    for (const pane of this.idlePanes) panes.push({ ...pane, workspace: pane.id.split(":")[0], sessionId: null })
    panes.sort((a, b) => (a.id < b.id ? -1 : 1))
    const drift = (now % 3600e3) / 3600e3
    return {
      mode: this.mode,
      now,
      sessions,
      panes,
      accounts: this.accounts.map((account) => ({
        name: account.name,
        tier: account.tier,
        five: { used: Math.min(99, account.five + drift * 6), status: "allowed", resetsAt: account.fiveReset, span: 5 * 3600e3 },
        seven: { used: account.seven, status: "allowed", resetsAt: account.sevenReset, span: 7 * 86400e3 },
      })),
      cost24h: { cost: 212.4 + sessions.reduce((sum, session) => sum + session.cost, 0), sessions: 86 },
    }
  }
}
