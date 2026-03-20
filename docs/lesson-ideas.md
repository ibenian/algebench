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

### Hypothesis Testing Visualizer
Interactive scene showing a null distribution with sliders for sample size, effect
size, and significance level (α). Shaded rejection regions update live; a second curve
shows the alternative distribution, making Type I / Type II errors and statistical
power directly visible as overlapping areas.

### Bayesian Update Visualizer — Continuous Distributions
Show prior, likelihood, and posterior as three overlaid distribution curves that
animate as new evidence arrives. Sliders control the prior parameters and the observed
data; the posterior updates live. Walk through each multiplication step of Bayes'
theorem geometrically.

### Monte Carlo Estimation
Visualize random sampling for estimating probabilities and integrals. Scatter random
points in a region; color by hit/miss. Show convergence of the estimate as sample
size increases. Connect to the law of large numbers.

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
