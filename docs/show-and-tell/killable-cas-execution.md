# The Math That Wouldn't Stop — Killable CAS Execution (a Show & Tell)

Two of our dev servers were sitting at **99% CPU**. One had been there for
**twenty-nine minutes** — longer than any request, any LLM call, any human's
patience. Nothing was crashing. No errors in the logs. Just a core, pinned, hot,
and a process that refused to let it go.

This is the story of chasing that down: why a computer-algebra system can wander
off and never come back, why our timeout *said* it worked but didn't, why you
**cannot kill a Python thread**, and how we ended up running math in a pool of
disposable, killable subprocesses that we're happy to `SIGKILL` without remorse.

> **See it live:** the example that runs through this post is the
> [Allen–Eggers maximum-deceleration derivation](https://algebench.org/?builtin=atmospheric-entry-physics&view=math&pp=1&sc=trajectory-and-the-entry-corridor&st=live-g-load-history&pf=allen_eggers_deceleration&ps=maximum-deceleration&nodes=__equals_1&sl=s2_t~363.125)
> on algebench.org — open the *maximum deceleration* step and hit derive.

---

## The big picture

The fix is an escalation ladder. The caller waits a short, bounded time and then
gives up — but giving up on *waiting* is decoupled from *stopping the work*. The
work runs in a separate process, and if it won't stop politely, we end it.

<svg viewBox="0 0 940 360" xmlns="http://www.w3.org/2000/svg" font-family="system-ui, sans-serif">
  <defs>
    <marker id="arr" markerWidth="10" markerHeight="10" refX="8" refY="3" orient="auto">
      <path d="M0,0 L8,3 L0,6 Z" fill="#7c83ff"/>
    </marker>
    <style>
      .lbl{fill:#e8eaf6; font-size:14px; font-weight:600;}
      .sub{fill:#aab0d6; font-size:11px;}
      .edge{stroke:#7c83ff; stroke-width:2; fill:none; marker-end:url(#arr);}
      .rung{rx:10; ry:10; stroke-width:1.5;}
      .r1{fill:#2a2150; stroke:#8b7cff;}
      .r2{fill:#3a2a14; stroke:#d4a017;}
      .r3{fill:#3a1414; stroke:#e05656;}
      .ok{fill:#14352a; stroke:#4cc38a;}
      .tag{fill:#8b93c9; font-size:11px; font-style:italic;}
    </style>
  </defs>

  <rect class="rung r1" x="30" y="40" width="250" height="78"/>
  <text class="lbl" x="48" y="70">Rung 1 · client timeout</text>
  <text class="sub" x="48" y="92">caller stops WAITING (~2s),</text>
  <text class="sub" x="48" y="108">returns "unverified", moves on</text>

  <rect class="rung r2" x="30" y="150" width="250" height="78"/>
  <text class="lbl" x="48" y="180">Rung 2 · SIGTERM</text>
  <text class="sub" x="48" y="202">polite: handler unwinds the</text>
  <text class="sub" x="48" y="218">sympy call; worker exits clean</text>

  <rect class="rung r3" x="30" y="260" width="250" height="78"/>
  <text class="lbl" x="48" y="290">Rung 3 · SIGKILL</text>
  <text class="sub" x="48" y="312">unconditional: kernel reclaims</text>
  <text class="sub" x="48" y="328">the core, no matter what</text>

  <path class="edge" d="M155,118 L155,150"/>
  <path class="edge" d="M155,228 L155,260"/>

  <rect class="rung ok" x="430" y="95" width="270" height="70"/>
  <text class="lbl" x="450" y="125">Worker pool (1 per core)</text>
  <text class="sub" x="450" y="147">separate processes — killable,</text>
  <text class="sub" x="450" y="163">resource-bounded, recycled</text>

  <rect class="rung ok" x="430" y="215" width="270" height="70"/>
  <text class="lbl" x="450" y="245">Fresh worker respawned</text>
  <text class="sub" x="450" y="267">pool self-heals; the runaway's</text>
  <text class="sub" x="450" y="283">memory dies with the process</text>

  <path class="edge" d="M280,79 L360,79 L360,130 L430,130"/>
  <path class="edge" d="M280,299 L360,299 L360,250 L430,250"/>
  <text class="tag" x="296" y="71">dispatch op</text>
  <text class="tag" x="296" y="321">reap + replace (background)</text>

  <text class="tag" x="735" y="130">caller already</text>
  <text class="tag" x="735" y="146">has its answer —</text>
  <text class="tag" x="735" y="162">this happens off</text>
  <text class="tag" x="735" y="178">its thread</text>
</svg>

The punchline up front: **a wall-clock budget now means the computation actually
stops**, not just that we stopped listening for its answer.

---

## A symptom with no error

It started as a footnote during other work. The proof-animation pipeline asks an
LLM to derive a result step by step, then **verifies every step with sympy** (our
[grounded proof completion](grounded-proof-completion.md)). Mostly this is fast —
the *authored* expressions in our lessons verify in well under a tenth of a
second.

But every so often a dev server would just... stay hot. Long after the request
that triggered it had returned a perfectly good animation, a core kept burning.
On a beefy laptop you might not notice. On our **hosting targets — Render and a
Hugging Face Space, both with few cores and tight memory** — it's the difference
between "responsive" and "the whole service is wedged." And because there was no
exception and no crash, it was the kind of bug that quietly rots a deployment:
rising CPU, slow responses, eventually an OOM'd worker, and nobody the wiser.

The first instinct — "it's deadlocked" — was wrong, and that mattered.

## It's not stuck — it's *thinking*

A quick `sample` of the live process told the real story. The hot frames were
all sympy internals: `PyObject_RichCompareBool`, `tuple_richcompare`,
`tuple_hash`, `_Py_dict_lookup`. That's not a deadlock. That's a CAS **recursively
comparing and hashing an enormous expression tree** — the signature of
`Basic.__eq__` plus sympy's `@cacheit` memoization, where the cache keys
themselves are huge and hashing them is `O(tree-size)`.

So the computation was *alive and working* — it had simply been handed an
expression where the work doesn't terminate in human-relevant time.

Then the gut-punch. We had a timeout guard. We even tested it:

```text
_guard(..., timeout=2.0) returned 'TIMED_OUT' after 2.02s
guard worker threads still alive: 1
runaway STILL running after timeout?  True  (+20,774,967 iters in 1s)
```

The timeout "fired" at 2 seconds. The worker kept going — twenty million more
iterations in the next second alone. Our 2-second budget bounded **how long we
waited for the answer**, not **how long the answer took**. The guard's own
docstring had quietly admitted the truth all along: *"Python cannot kill a
thread."*

## Why you can't just kill a thread

This is the crux, and it's worth saying plainly. CPython has a **Global
Interpreter Lock**: only one thread runs Python bytecode at a time. A
CPU-bound loop *does* hand the GIL off every few milliseconds (so other
threads — including the one waiting on our timeout — still run), but it
immediately grabs it back and keeps going. There is **no API to stop a running
thread** from outside; you can ask politely (signals only reach the main thread),
but a thread spinning in `Basic.__eq__` will not check for your request and will
not stop. It runs until the function returns. If the function never returns in
human time, the core is gone — for the life of the process.

A `ThreadPoolExecutor`, then, is exactly the wrong tool for *bounding* hostile
CPU work. A timed-out task doesn't get cancelled; it becomes a permanently busy
worker thread. With a shared pool, those accumulate. One bad expression per hour
and your "32-worker" pool is quietly down to 31, then 30...

## The monsters hide in the intermediates

Here's the subtle part: **our lesson content is fine.** The formulas a human
authored verify instantly. The danger is in the *intermediate steps an LLM
invents* while deriving — and those can be pathological even when the start and
end are tame.

Take the **Allen–Eggers peak-deceleration** derivation from our atmospheric-entry
lesson. The physics is gorgeous: a capsule falling through an exponential
atmosphere, velocity decaying as a double exponential, and a clean closed form
for the altitude and magnitude of peak g-load. The authored result is a tidy
expression. But the *path* there is full of `e^{-h/H}` terms nested inside other
exponentials, and "find where the deceleration is maximal" means **solving a
transcendental equation**.

Ask sympy to solve one of those intermediates for the altitude `h` over the
complex domain and it can't give a finite answer — it returns an *infinite
parametric family*. Then a later step asks "is this step's solution set contained
in the previous one's?", and the CAS sets off comparing a `ConditionSet` against
an `ImageSet`.

And here's a payoff of the new design: the guard's **timeout logging — code we
added as part of the CAS isolation** — now captures the exact op and arguments at
the instant it gives up. The pathological input that used to vanish into a silent
99%-CPU hang is now a single attributable log line. This is a real one our
`_log_timeout` emitted (pid/timing will vary):

```text
🧬 CAS 🖥️ worker pid=48213 timeout after 2.00s:
  _op_is_subset(
    ConditionSet(h, Eq(V*sin(γ) + Derivative(h, t), 0), Complexes),
    ImageSet(Lambda(_n, -H*(I*(2*_n*pi + arg(B*a/(V**2*ρ₀)))
                            + log(2*Abs(B*a/(V**2*ρ₀))))), Integers))
```

`arg`, `log`, `2·n·π`, an unsolved `ConditionSet`, an integer-indexed image set —
this is precisely the kind of object whose subtree comparison balloons
super-linearly. Multiply that by the fact that grounding runs **~3× per derive**
(refinement reward × attempts, plus the animation render pass), over **every
transition**, and a single hostile intermediate gets a lot of chances to wander
off a cliff.

The expressions are immutable and hashable, so `@cacheit` *should* be a free
speed-up — but when the trees explode, the **hashing and comparison the cache
depends on** become the bottleneck, and the cache becomes a memory sink. The very
mechanism that makes sympy fast on normal input is what melts the core on
pathological input.

## The options on the table

We laid out the candidates honestly:

- **A. Process isolation.** Run heavy sympy in a separate process and `SIGKILL`
  it on timeout. The *only* approach that genuinely bounds CPU. Costs: IPC
  (pickle expressions across the boundary), process startup, and careful sizing
  for small cloud boxes.
- **B. Complexity pre-gate.** Before calling the heavy routines, cheaply bound
  the input (atom/op count); if it's obviously too big, skip it. Near-zero
  overhead, but heuristic — a small-looking expression can still be slow.
- **C. SIGALRM.** Can interrupt the *main* thread — but it's unsafe under a
  threaded server and useless on worker threads. Only viable *inside* a
  single-threaded worker process (i.e. inside option A).
- **D. Mitigations.** Daemon threads, lower the timeout, cache grounding so it
  isn't recomputed 3×. All reduce the blast radius; none of them make a runaway
  *stop*.

Only **A** satisfies the actual requirement: *a budget must reclaim the core*.
We made A the spine, layered **B** in front of it as cheap defense, and kept **D**
as good hygiene.

## The fix: a killable process pool

Heavy sympy now runs through one choke point — `guard(fn, *args)` — backed by a
pool of **separate worker processes**. A process, unlike a thread, can be killed.
So a wall-clock budget finally bites.

The escalation ladder (each rung independently configurable):

1. **Client timeout** — the caller waits ~2s, then returns "unverified" and moves
   on. Crucially, **this is decoupled from cleanup**: the caller is unblocked
   immediately while killing/respawning happens in the background.
2. **SIGTERM** — the worker has a handler that raises into the running sympy call,
   unwinding it cleanly. This interrupts anything executing Python bytecode (which
   sympy overwhelmingly is).
3. **SIGKILL** — if the worker is wedged in an uninterruptible C routine and
   ignores SIGTERM past a grace window, the kernel ends it unconditionally. The
   core comes back no matter what.

A killed worker is **never reused** — a fresh one replaces it. That also contains
memory blow-ups (the bloated child dies with its RSS) and keeps a pathological
expression's sympy cache out of the long-lived server. The whole transport is a
private parent↔worker pipe with an exclusive checkout per call, so we need no
correlation IDs: the next message on your pipe *is* your reply.

When the CAS can't finish in time, the step doesn't fail — it degrades to
"plausible / unverified," the honest neutral. A timeout can never produce a false
"verified" or a false "refuted." The animation still renders; the badge just
admits the CAS couldn't decide.

And there's a knock-on win for **responsiveness**. A derive used to be able to
stall on a single doomed sympy step; now every step is bounded by the client
timeout, so a slow or undecidable step **gives up in ~2s instead of hanging** —
the whole derivation comes back faster. Better still, giving up isn't a dead end:
a CAS-undecided step is exactly the candidate our inference-time **LLM "domain
judge"** picks up (the rescue pass from [grounded proof
completion](grounded-proof-completion.md)). So rather than a learner waiting on a
symbolic comparison that was never going to terminate, the CAS bows out quickly
and the judge chimes in with a domain-justified verdict. The tight budget doesn't
just protect the box — it **hands the baton to a faster, complementary checker**.

The practical effect is the one that matters most: the feature went from
*occasionally unusable* to *dependable*. Before, a single unlucky expression
could stall a derivation — or silently degrade the whole server for everyone
after it. Now every derive comes back **promptly**, with an honest confidence
badge on each step, no matter what the LLM dreams up in the middle. Bounding the
worst case is what made the common case feel reliable — and a feature you can
trust to respond is a feature people will actually use.

## Why two seconds?

The budget isn't a guess. We measured the *authored* expressions in our lessons
verifying in **under 0.12 seconds** — so a 2-second client timeout is a **>16×
safety margin** over any legitimate single CAS call. That's the whole design
intent: real math, even slightly slow real math, finishes comfortably inside the
budget and is **never** degraded; only genuinely pathological work — the stuff
that would otherwise run for minutes or forever — gets cut.

Two seconds also fits the *interactive* envelope from both ends. A single derive
fires many guarded calls (grounding is recomputed ~3× per derive, across every
transition), so the per-call budget has to be small enough that even a handful of
timeouts stays well inside the overall derive budget — the UI gives up on a whole
derivation at 360s. And it sits right at the threshold where a human stops feeling
"it's thinking" and starts feeling "it's stuck." Big enough to never punish real
work; small enough to keep the experience snappy.

And it's a default, not a law: `ALGEBENCH_CAS_CLIENT_TIMEOUT` (falling back to the
legacy `ALGEBENCH_VERIFY_TIMEOUT`) tunes it per environment — drop it on a busy
single-core box to fail faster, raise it for a domain that legitimately needs
heavier symbolic work.

## Three modes, and why we prefer the expensive one

The guard supports three isolation modes, selectable per environment:

| Mode | What it does | Bounds CPU? | Where we use it |
| --- | --- | --- | --- |
| **`process`** *(default)* | Killable worker processes — the full ladder | **Yes** | Production. The real fix. |
| **`thread`** | Legacy shared thread pool; bounds only the *wait* | No | The test suite (keeps sympy monkeypatchable in-process, no spawn cost); trusted offline batch jobs |
| **`inline`** | Direct call, no isolation, no timeout | No | Pure-logic unit tests |

We **prefer `process`** despite it being the heaviest, for reasons the other two
structurally cannot match:

- **It's the only one that actually stops the work.** `thread` and `inline` both
  inherit the original sin — a runaway runs forever. `process` reclaims the core.
- **It contains memory, not just CPU.** A blow-up that would bloat the server's
  RSS instead bloats a child that we then discard.
- **It self-heals.** Crashed, killed, or cache-bloated workers are recycled; the
  long-running server stays clean.
- **It degrades gracefully under load** instead of wedging — if the pool is
  saturated, calls return "unverified" rather than blocking.

The price is real — pickling expressions across the boundary, worker startup —
which is why the other modes exist for contexts where that price isn't worth it
(tests, trusted batch). But for a public, unattended, small-box deployment,
"never melts" beats "slightly faster."

## Speed, scale, and one worker per core

The instinct on hearing "pool" is to make it big. On this workload that's exactly
wrong, and the reason is the GIL again — from the other side.

sympy is **CPU-bound**, and the GIL means threads can't run it in parallel.
**Processes** can — each has its own interpreter and its own GIL — but only up to
the number of **physical cores**. Two sympy computations sharing one core don't
finish faster; they time-slice and both finish *later*, plus context-switch
overhead, plus they're now fighting the web server for the CPU. So the pool is
capped at **cores − 1**: enough to parallelize independent grounding work, with
one core always left for the event loop so the server stays responsive even while
workers grind.

On a typical small cloud instance (1–2 vCPUs) that means **one worker**. And
that's the right answer: with one core there is *no* parallelism to be had — the
pool's value there isn't speed, it's **killability** (you can reclaim the one core
a runaway grabbed, which a thread could never give back).

A few consequences worth naming:

- **Throughput vs. safety.** Under heavy concurrency on a tiny box, grounding
  serializes through the small pool; some steps degrade to "unverified" rather
  than blocking. That's a deliberate trade — the server stays up.
- **IPC isn't the bottleneck you'd fear.** A derive's wall-clock is dominated by
  the *LLM network call*, not sympy; the per-call pickle cost is in the noise, and
  the complexity pre-gate keeps the genuinely huge expressions from ever being
  sent.
- **Why not async?** Async overlaps *I/O waits*; it adds zero CPU parallelism (one
  thread, one GIL). It would be a viral refactor of a sync, CPU-bound,
  process-offloaded pipeline for *identical* performance. The I/O concurrency we
  do want — overlapping LLM calls across requests — we already get from the
  server's thread pool, because the GIL is released during network and pipe
  waits.
- **Multiple web workers multiply the pool.** Run `uvicorn --workers W` and you
  get W independent pools; size so `W × pool_size ≤ cores − 1`.

## Proving it actually dies

The acceptance test is blunt, and it's the one that matters: hand the guard a
**non-terminating** function and assert that (1) the caller gets its fallback in
about the client timeout, (2) **no worker process survives**, and (3) the pool
serves the next call correctly from a fresh worker. We test the graceful path
(SIGTERM-interruptible loop exits clean) and the hard path (a worker that
deliberately *ignores* SIGTERM still gets SIGKILLed and the core reclaimed),
plus recycling, saturation, and concurrent mixed load.

The thing the old design could never pass — "after a derive completes or errors,
there is no persistent >1-core CPU" — now holds by construction.

## What we took away

- **A timeout on a thread is a comforting lie for CPU-bound work.** It bounds
  your patience, not the computation. If you must be able to *stop* arbitrary CPU,
  you need a process.
- **The fast path and the hostile path can share code.** `@cacheit` is a gift on
  normal expressions and a trap on exploded ones; the same recursion that makes
  sympy quick makes it dangerous. Bound the input *and* bound the execution.
- **Decouple "give up waiting" from "clean up."** Users should never wait on your
  kill-and-respawn. Return the fallback now; reap in the background.
- **Match concurrency to the physical resource.** Threads for I/O waits, one
  process per core for CPU, and don't oversubscribe a box that's already small.

The result: the LLM can emit whatever baroque intermediate it likes while
deriving Allen–Eggers peak deceleration, sympy can wander into an infinite image
set trying to verify it — and two seconds later the core is back, the badge says
"plausible," the animation plays, and the server never noticed.

> **Try it yourself:** [derive Allen–Eggers maximum deceleration live](https://algebench.org/?builtin=atmospheric-entry-physics&view=math&pp=1&sc=trajectory-and-the-entry-corridor&st=live-g-load-history&pf=allen_eggers_deceleration&ps=maximum-deceleration&nodes=__equals_1&sl=s2_t~363.125)
> — the gnarly intermediate earns its confidence badge in a couple of seconds
> instead of pinning a core.

---

*Design reference: [cas-execution-model.md](../cas-execution-model.md). Related:
[grounded proof completion](grounded-proof-completion.md) ·
[the refinement loop](proof-refinement-loop.md).*
