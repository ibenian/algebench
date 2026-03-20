# AlgeBench — Lesson Ideas

A living document of lesson concepts and content ideas for AlgeBench. Each entry
describes a potential multi-scene lesson or domain library — specific mathematical
content rather than platform features.

See also: [feature-ideas.md](feature-ideas.md) for platform and UX feature ideas.

---

## 1. Probability & Statistics

### Conditional Probability & Bayes' Rule (exists)
The current `conditional-probability.json` lesson — three scenes covering probability
terms, conditional probability, and Bayes' rule using an interactive probability
rectangle with slider-driven joint distributions.

### Law of Total Probability
Extend the probability rectangle to partition the sample space into more than two
events. Show how P(B) decomposes as a weighted sum across the partition. Animate
the partition lines as sliders change marginals. Bridge naturally from the existing
conditional probability lesson.

### Independence vs Correlation
Start from the probability rectangle: when the horizontal divider is a straight line,
events are independent. Introduce correlation as a continuous measure of how far the
divider deviates from straight. Show examples where correlation ≠ 0 but events are
still conditionally independent given a third variable (Simpson's paradox territory).

### Bayesian Updating — Sequential Evidence
Build on Bayes' rule with sequential evidence: start with a prior, observe one piece
of evidence and update, then observe another. Show the posterior evolving step by step
as a stacked probability rectangle that grows a new Z-layer with each observation.
Connect to the existing Z-layer visualization in scene 2.

### Base Rate Neglect & The Prosecutor's Fallacy
A focused lesson on the most common Bayesian intuition failure. Start with a medical
test scenario: disease prevalence slider (very low), test sensitivity slider (high),
test specificity slider (high). Show why P(disease | positive test) is still low when
prevalence is low. Animate the probability rectangle to make the false positive
region visually dominant.

### Bayes Intuition Builder — Frequency Approach
Before any formula, build Bayesian intuition through concrete frequency scenarios.
A 2D grid of dots (e.g. 1000 people) is partitioned visually: first by disease
prevalence (prior), then by test accuracy (likelihood). The posterior falls out as a
visible count — "of these 50 highlighted dots, only 9 actually have the disease."
Sliders adjust prevalence and test sensitivity; the dot partition redraws in real time.

### Hypothesis Testing — The Geometry of Decisions
Interactive scene showing null and alternative distributions as two overlapping bell
curves in 3D. Sliders for sample size, effect size, and significance level (α).
Shaded rejection regions update live, making Type I error (α), Type II error (β),
and statistical power (1−β) directly visible as colored areas. A movable test
statistic marker shows where a specific observation falls and whether it crosses
the critical value. Walk through the logic: assume null → compute probability →
decide.

### p-Values — What They Actually Mean
The most misunderstood concept in statistics. Visualize the p-value as the shaded
tail area beyond the observed test statistic under the null distribution. Slider
moves the test statistic along the x-axis; the shaded area (p-value) updates in
real time. Contrast with common misinterpretations: the p-value is NOT the
probability the null is true. Show side-by-side: the frequentist tail area vs
the Bayesian posterior P(H₀|data) — they give different numbers. Connect back to
base rate neglect.

### Power Analysis — Designing Experiments
Before collecting data, how large a sample do you need? Start from the hypothesis
testing scene and add a third slider: sample size n. As n increases, both
distributions narrow, the overlap shrinks, and power increases. Animate the
tradeoff: more subjects → more power → more cost. Show the "power curve" as a
2D plot of power vs effect size for a fixed n and α.

### Confidence Intervals — The Interval That Covers
Visualize 100 confidence intervals from repeated sampling. Each sample generates
an interval; ~95 of 100 cover the true parameter (highlighted), ~5 miss (red).
Sliders for sample size and confidence level. Makes the frequentist interpretation
concrete: the interval is random, the parameter is fixed. Contrast with the
Bayesian credible interval where the parameter has a distribution.

### Multiple Testing & The False Discovery Problem
Run 20 independent hypothesis tests where the null is true for all of them.
At α=0.05, about 1 in 20 will be "significant" by chance. Visualize as a grid
of 20 test statistic distributions, each with its own rejection region. Highlight
the false positives in red. Then show corrections: Bonferroni (shrink α),
Benjamini-Hochberg (control false discovery rate). Sliders for number of tests
and α.

### Effect Size vs Statistical Significance
A large sample can make a tiny, meaningless effect "statistically significant."
Show two overlapping distributions where the effect size d is tiny (slider) but
the sample size is enormous — the p-value is small but the distributions are
nearly identical. Contrast with a large effect size at small n — clearly different
distributions but p-value is large. Drive home that significance ≠ importance.

### Sigma Levels — What "5σ" Means for Scientific Evidence
Visualize the normal distribution with shaded regions at 1σ, 2σ, 3σ, 4σ, and 5σ.
A slider sweeps the sigma level; the shaded tail area (p-value) and the "1 in N"
odds update in real time. At 1σ the tail is ~16% (not impressive). At 3σ the tail
is ~0.13% (evidence). At 5σ it's ~1 in 3.5 million (discovery).

Connect to real scientific thresholds:
- **2σ** (~95%) — social science convention, "statistically significant"
- **3σ** (~99.7%) — evidence threshold in many fields
- **5σ** (~99.99994%) — particle physics discovery threshold (Higgs boson, 2012)
- **6σ** — manufacturing quality (Six Sigma = 3.4 defects per million)

Show why physicists demand 5σ: with thousands of searches (the "look-elsewhere
effect"), a 3σ result is expected by chance. Animate a grid of 1000 independent
experiments under the null — show how many produce 2σ, 3σ, and 5σ flukes.

Second scene: the **sigma as effect size** interpretation. Two distributions
separated by dσ standard deviations. Slider for d. At d=1 the distributions
overlap heavily. At d=3 they're clearly distinct. At d=5 the overlap is invisible.
Makes the sigma notation tangible as "how many standard deviations away from
what we'd expect if nothing is happening."

### Frequentist vs Bayesian — The Same Data, Two Frameworks
Present a single dataset and analyze it both ways side by side. Left panel:
null distribution, test statistic, p-value, reject/fail-to-reject decision.
Right panel: prior distribution, likelihood from data, posterior distribution,
credible interval. Sliders for prior strength and data. Show when they agree
and when they diverge — especially with small samples and strong priors.

### Bayesian Update Visualizer — Continuous Distributions
Show prior, likelihood, and posterior as three overlaid distribution curves that
animate as new evidence arrives. Sliders control the prior parameters and the observed
data; the posterior updates live. Walk through each multiplication step of Bayes'
theorem geometrically.

### Expected Value & Variance — The Shape of Uncertainty
Start with a discrete distribution as colored bars on the probability rectangle.
The expected value E[X] is the "balance point" — show it as a fulcrum under the
distribution that keeps it level. Variance is the average squared distance from
that fulcrum — visualize as springs pulling each outcome toward the mean, with
spring length proportional to deviation. Slider adds/removes probability mass
from the tails; the fulcrum shifts and springs stretch in real time. Second scene:
continuous case — the balance point of a density curve, with variance as the
"width" of the distribution.

### The Distributions Zoo
A gallery of the most important probability distributions, each as an interactive
3D surface or curve with parameter sliders:

- **Binomial(n, p)** — bar chart of successes in n trials. Sliders for n and p.
  Watch it approach normal as n grows (bridge to CLT).
- **Poisson(λ)** — rare event counts. Slider for λ. Show it emerging from
  binomial as n→∞, p→0, np→λ.
- **Exponential(λ)** — waiting times. Slider for rate λ. Show the memoryless
  property: P(X > s+t | X > s) = P(X > t) by slicing the curve.
- **Normal(μ, σ)** — the bell curve. Sliders for μ and σ. Shade the 68-95-99.7
  regions. Connect to sigma levels lesson.
- **Uniform, Gamma, Beta** — show how they relate as special cases and
  conjugate priors.

Each distribution links to the others: animate the binomial morphing into normal,
Poisson emerging from binomial, exponential as the gap between Poisson events.

### Central Limit Theorem — Why Everything Becomes Normal
The most surprising theorem in statistics. Start with any ugly distribution
(uniform, exponential, bimodal — user picks). Draw samples of size n and plot the
sample mean. Slider for n. At n=1 the distribution of means looks like the
original. At n=5 it's smoother. At n=30 it's unmistakably normal. Animate the
convergence: each frame draws a new batch of samples and updates the histogram of
means. Overlay the theoretical normal curve √n(X̄ − μ)/σ ~ N(0,1). Second scene:
show *why* it works — convolution of distributions, each convolution smoothing out
the bumps.

### Law of Large Numbers — Convergence of the Average
Flip a biased coin (slider for p). Plot the running average of heads as n grows.
At small n the average bounces wildly. At large n it settles toward p. Show 50
independent sequences simultaneously — they all converge but at different rates.
Slider for p lets the student see convergence works for any probability. Connect
to Monte Carlo: the running average IS a Monte Carlo estimate of p.

### Monte Carlo Estimation
Visualize random sampling for estimating probabilities and integrals. Scatter random
points in a region; color by hit/miss. Show convergence of the estimate as sample
size increases. Connect to the law of large numbers.

### Maximum Likelihood Estimation — Finding the Best Fit
Given observed data points (shown as dots on a number line), slide the parameter θ
of a distribution. For each θ value, compute the likelihood L(θ) = ∏P(xᵢ|θ) —
visualize as a curve over θ-space. The MLE is the peak. Animate: as θ slides,
the distribution shifts and stretches to fit the data better or worse. The
likelihood curve builds up in real time. Show the log-likelihood as a second
curve (turns products into sums, easier to optimize). Second scene: 2D parameter
space (μ, σ) for a normal — the likelihood becomes a surface with a single peak.

### Regression to the Mean — Why Extreme Results Don't Last
One of the most misunderstood statistical phenomena. Scene 1: scatter plot of
"test 1" vs "test 2" scores with noise. Students who scored highest on test 1
tend to score lower on test 2 — not because they got worse, but because extreme
scores contain more luck. Highlight the top-10 performers on test 1 and show their
test 2 scores regressing toward the mean. Slider for noise level: more noise →
more regression. Scene 2: Galton's original quincunx (bean machine) — balls
bouncing through pegs naturally produce a normal distribution. Extreme balls on
one level are likely to be less extreme on the next.

### Sampling Bias & Survivorship Bias
Visualize what happens when you can only see part of the data. Scene 1: a full
population of dots with a true trend. Apply a selection filter (slider for
threshold) that removes dots below a cutoff — the visible trend changes direction
or disappears. Classic survivorship bias: only seeing the planes that returned.
Scene 2: selection bias in surveys — the responding population differs from the
full population. Shade the "missing" region to show what conclusions change when
you account for the unseen data.

### Entropy & Information — Measuring Uncertainty
Uncertainty as a number. Start with a discrete distribution (bars on the probability
rectangle). Shannon entropy H = −∑p log p measures how "spread out" the distribution
is. Slider redistributes probability mass; entropy updates in real time. A uniform
distribution maximizes entropy (maximum uncertainty). A spike at one outcome has
entropy zero (no uncertainty). Second scene: connect to information — observing an
event with probability p gives −log(p) bits of information. Rare events are more
informative. Bridge to Bayesian updating: evidence that updates your belief the most
is the most informative.

### KL Divergence — Distance Between Distributions
How different are two distributions? Visualize P (true) and Q (approximation) as
two overlaid curves. The KL divergence D_KL(P‖Q) = ∑P log(P/Q) is shown as the
shaded area of the ratio curve. Slider morphs Q toward or away from P; the
divergence value updates. Show key properties: KL ≥ 0, KL = 0 iff P = Q,
asymmetric (D_KL(P‖Q) ≠ D_KL(Q‖P)). Connect to MLE: minimizing KL divergence
from data to model is equivalent to maximizing likelihood.

### Random Walks — The Drunkard's Path
Scene 1: 1D random walk — a point steps left or right with equal probability.
Animate 50 simultaneous walkers from the origin. The cloud of positions spreads
as √t. Overlay the theoretical normal envelope. Slider for step bias (p ≠ 0.5)
adds drift. Scene 2: 2D random walk — points wander on a plane, leaving fading
trails. Show the diffusion pattern. Scene 3: 3D random walk in the viewport —
a particle traces a path through space. Connect to Brownian motion, diffusion,
and stock price models.

### Markov Chains — Memory-Free Processes
Render a state diagram as a directed graph with 3–5 nodes. Edge weights are
transition probabilities (must sum to 1 from each node). Animate a "random walker"
hopping between states according to the transition matrix. After many steps, show
the stationary distribution emerging — the fraction of time spent in each state
converges regardless of starting position. Sliders adjust transition probabilities;
the stationary distribution updates. Second scene: the transition matrix as a
heatmap, with eigenvalue decomposition revealing the convergence rate (second
largest eigenvalue).

### Causality — Correlation vs Causation
Start with two correlated variables shown as a joint distribution (reusing the
probability rectangle). Introduce a hidden confounder as a third axis — show how
the correlation disappears when you condition on (slice by) the confounder. Classic
examples: ice cream sales and drowning (confounder: temperature), shoe size and
reading ability (confounder: age). Sliders control confounder strength.

### Causal Graphs (DAGs) & d-Separation
Introduce directed acyclic graphs as the language of causality. Render 3–5 node
causal DAGs in 3D with directed edges. Highlight the three elemental structures:
chain (A → B → C), fork (A ← B → C), and collider (A → B ← C). Show how
conditioning on the middle node blocks or opens information flow — animate
"probability flow" along edges that dims when a path is d-separated.

### Interventions — do(X) vs observe(X)
The key insight from Pearl's do-calculus: observing X=x and *setting* X=x give
different answers. Visualize with the probability rectangle: observing slices the
distribution (conditional probability), while intervening *removes* incoming edges
and rebuilds the distribution. Show the same DAG before and after an intervention,
with the joint distribution updating to make the difference visceral. Connect back
to the Bayes' rule lesson — P(Y|X) ≠ P(Y|do(X)) when confounders exist.

### Simpson's Paradox
A trend that appears in several groups reverses when the groups are combined.
Visualize with stacked probability rectangles: each subgroup shows a positive
association, but the aggregate shows negative. Sliders control group sizes and
within-group rates. Reveal the confounder that explains the reversal. Bridge from
the independence vs correlation lesson.

### Counterfactuals — "What Would Have Happened?"
The third rung of Pearl's causal ladder. Given a specific observed outcome, ask
what *would* have happened under a different intervention. Visualize as two parallel
probability rectangles: the factual world and the counterfactual world. Animate the
transition between them to show which probabilities change and which are preserved
by the structural equations.

---

## 2. Physics Domain Libraries

### Quantum Mechanics Domain

A `quantum` domain library for visualizing wavefunctions and quantum phenomena — the
natural companion to the existing `astrodynamics` domain.

#### Atomic Orbitals
- **Hydrogen wavefunctions** — render |ψ|² as a 3D probability density cloud for
  s, p, d orbitals. Sliders for quantum numbers n, l, m. Color encodes phase angle
  (complex argument) using HSL mapping so interference patterns are visible.
- **Radial probability distribution** — 2D plot of r²|R(r)|² alongside the 3D cloud,
  highlighting radial nodes and the most probable radius.
- **Orbital transitions** — animate the electron "jumping" between energy levels;
  emit a colored photon whose hue corresponds to the transition frequency
  (E = hf = hc/λ). Connects spectroscopy to the orbital model directly.

**Slider contracts** (proposed):
| ID | Description | Default |
|---|---|---|
| `n` | Principal quantum number | 1 |
| `l` | Angular momentum quantum number | 0 |
| `m` | Magnetic quantum number | 0 |
| `r_scale` | Radial display scale (Bohr radii) | 10 |
| `iso_val` | Isosurface threshold for density cloud | 0.02 |

**Functions** (proposed):
- `psiR(r, n, l)` — radial wavefunction R_nl(r) via associated Laguerre polynomials
- `psiAng(theta, phi, l, m)` — real spherical harmonic Y_lm(θ, φ)
- `psiDensity(r, theta, phi, n, l, m)` — full |ψ|² probability density
- `energyLevel(n)` — E_n = -13.6 eV / n² (hydrogen energy levels)

#### Wave Mechanics
- **Particle in a box** — standing wave eigenstates ψ_n(x) = √(2/L) sin(nπx/L),
  energy levels E_n ∝ n². Sliders for n and box width L. Shows wavefunction,
  probability density, and energy eigenvalue simultaneously.
- **Quantum harmonic oscillator** — Hermite polynomial eigenstates; energy ladder
  visualization with equally spaced levels. Slider for n; overlay shows zero-point energy.
- **Double-slit interference** — 2D wave amplitude from two coherent sources; slider
  for slit separation d and wavelength λ. Overlay particle hit histogram to show
  wave-particle duality emerging statistically.
- **Quantum tunneling** — Gaussian wave packet incident on a rectangular potential
  barrier. Sliders for barrier width, barrier height, and incident energy. Animate
  transmitted vs. reflected probability current.

#### Spin & Measurement
- **Bloch sphere** — qubit state |ψ⟩ = cos(θ/2)|0⟩ + e^(iφ)sin(θ/2)|1⟩ on a
  Bloch sphere. Sliders θ and φ rotate the state vector; the scene labels |0⟩ and
  |1⟩ poles and shows the expectation values ⟨X⟩, ⟨Y⟩, ⟨Z⟩.
- **Stern-Gerlach** — visualize spin-up/spin-down beam splitting in a magnetic field
  gradient. Slider for field gradient; shows deflection proportional to m_s.

#### Implementation Notes
Atomic orbitals require associated Laguerre polynomials and real spherical harmonics —
both are closed-form polynomial evaluations, suitable for the expression sandbox.
The 3D density cloud is best rendered as a `surface` element on a spherical grid with
opacity driven by |ψ|², or as a `point_cloud` element with color-coded density.
Wavefunctions are unitless within the scene; physical units are noted in step descriptions.

---

### Orbital Mechanics Extensions (astrodynamics domain)

**New modes for the existing `astrodynamics` domain:**

- **Hohmann transfer** — two-burn transfer between two circular orbits.
  Phase 1: initial circular orbit. Phase 2: first burn raising apoapsis. Phase 3:
  coast on elliptical transfer orbit. Phase 4: second burn circularizing at target.
  Delta-v budget displayed as an overlay. Sliders for r_initial, r_target.
- **Gravity assist / slingshot** — extend to include a planet moving on its own orbit;
  the spacecraft's trajectory is deflected by the planet's gravity well. Slider for
  flyby altitude and approach angle.
- **Elliptical orbit parameters** — visualize semi-major axis a, eccentricity e,
  periapsis, apoapsis, argument of periapsis ω. Derive orbital period from Kepler's
  third law T² ∝ a³.

**New multi-body scenes (new domain or domain extension):**

- **Lagrange points** — compute L1–L5 equilibrium positions in a two-body system.
  Show effective potential landscape (gravity + centrifugal) as a height surface in
  the co-rotating frame. Slider for mass ratio.
- **Figure-8 three-body orbit** — the famous periodic choreography solution where
  three equal-mass bodies chase each other on a figure-8 path. Numerically integrated;
  demonstrates sensitivity to initial conditions.
- **Binary star system** — two bodies orbiting their common barycenter. Sliders for
  mass ratio and orbital separation. Connect to Kepler's laws.

---

### Bohr Model → Quantum Bridge Lesson

A multi-scene lesson tracing the conceptual evolution from classical to quantum:

1. **Classical orbit** — electron on a circular orbit around nucleus (astrodynamics
   domain, coast mode, scaled to atomic units). Stable but physically wrong.
2. **Quantized radii** — Bohr's rule L = nℏ selects discrete allowed radii r_n = n²a₀.
   Show only the orbits that "fit" whole wavelengths. Slider for n.
3. **de Broglie wave** — wrap a standing wave around each circular orbit; show how
   integer wavelength condition enforces quantization.
4. **Probability cloud** — replace the sharp orbit with a |ψ|² density cloud (quantum
   domain). The electron is not on a path — it has a probability distribution.
5. **Spectral lines** — connect energy level differences to photon colors; show the
   Balmer series in visible light.

This lesson explicitly bridges the classical (astrodynamics domain) and quantum (quantum
domain) libraries, demonstrating how domain libraries can be combined in a single lesson.
