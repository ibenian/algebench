# Expression-Analysis Expert — Predict / No-Thinking Report

*2026-07-24 · AlgeBench · branch `expression-analysis-expert` (commit `27e069f3`) · model `gemini-2.5-flash`*

## 1. Executive summary

The visualization-proposer LM call was benchmarked across **10 scenarios × 3 thinking configurations** (30 calls, temperature 0.7, cache off). The adopted configuration — **bare `dspy.Predict` with Gemini internal thinking disabled** — ran at **mean 3.7 s/call (2.6–4.7 s)** versus 11.2 s for a low thinking budget and 14.7 s (5.9–27.4 s!) for default thinking, **with output quality equal or better**. Full thinking showed *worse* contract adherence (duplicate rank entries; top-ranked features left unmarked in 4/10 cases) and wildly unpredictable latency. The CAS fingerprint carries the hard mathematics, so the LM call is structured *selection*, not derivation — thinking buys nothing here.

**Configuration adopted:** `dspy.Predict(VizProposalSig)` + `reasoning_effort="disable"`, scoped to this expert's LM only so the rest of the stack keeps full reasoning.

## 2. How the expert works

```
POST /api/expert/expression_analysis  { latex, variable?, context?, propose? }

  1. parse + normalize          (latex_to_sympy — same path as the chart pipeline)
  2. pick sweep variable        (caller's choice, else x, t, r, n, u, v)
  3. CAS behavior fingerprint   (~30 ms — 8 killable-guarded SymPy ops:
                                 zeros, extrema, singularities, inflections,
                                 limits at infinity, periodicity, parity, domain)
  4. ONE LM call                (Predict, thinking off: rank features 1–5,
                                 propose 1–3 viewports, 1–4 probes, or abstain)
  5. shape + guard              (pydantic ceilings; unknown view symbols flagged;
                                 any failure → abstain with CAS report intact)
```

The LM may only reference features the CAS detected — it proposes, but **never gets the last word on math**.

## 3. Performance

### Latency per scenario (seconds)

```chartjs
{
  "type": "bar",
  "data": {
    "labels": [
      "projectile",
      "crash-stop",
      "damped-osc",
      "logistic",
      "gaussian",
      "planck-ish",
      "lorentz",
      "ideal-gas",
      "oblique",
      "cubic"
    ],
    "datasets": [
      {
        "label": "Predict + no thinking (adopted)",
        "data": [
          3.91,
          3.06,
          4.11,
          3.23,
          4.06,
          3.66,
          4.74,
          2.6,
          3.48,
          3.92
        ],
        "backgroundColor": "#42a5f5"
      },
      {
        "label": "Predict + low thinking",
        "data": [
          11.12,
          11.27,
          12.84,
          10.4,
          11.84,
          10.59,
          11.07,
          12.43,
          11.27,
          9.25
        ],
        "backgroundColor": "#ffa726"
      },
      {
        "label": "Predict + default thinking",
        "data": [
          5.87,
          17.45,
          18.59,
          24.62,
          13.78,
          27.42,
          9.53,
          9.85,
          9.32,
          10.6
        ],
        "backgroundColor": "#ef5350"
      }
    ]
  },
  "options": {
    "scales": {
      "y": {
        "beginAtZero": true,
        "title": {
          "display": true,
          "text": "seconds"
        }
      }
    }
  }
}
```

### Aggregates

| Config | Mean | Min | Max | Std dev | Thinking tokens (mean) | Completion tokens (mean) |
|---|---|---|---|---|---|---|
| **no thinking (adopted)** | 3.7 s | 2.6 s | 4.7 s | 0.6 s | 0 | 719 |
| low | 11.2 s | 9.2 s | 12.8 s | 1.0 s | 832 | 1695 |
| default | 14.7 s | 5.9 s | 27.4 s | 6.8 s | 2309 | 3207 |

Latency for the no-thinking config tracks output length almost linearly — there is no deliberation phase to add variance. Default thinking chose anywhere from **434 to 5,065** thinking tokens for the *same kind of task* (5.9 s → 27.4 s), which makes batch prebake times unpredictable for zero measured quality gain.

End-to-end over HTTP (CAS ≈ 30 ms + transport + adapter) adds roughly 1–3 s to the pure LM time; a cold server start adds a one-time ≈ 4 s CAS pool spin-up.

## 4. Mechanical quality checks

Three checks computed per call against the CAS report: **symbols** (every view `x_var`/pinned key exists in the report's variable list), **coverage** (features ranked ≥ 4 are actually marked in some view), **range hits** (marked point-features fall inside the proposed x-range — did the model put the interesting bits *inside* the sweep?).

| Scenario | no-think cov / range | low cov / range | default cov / range |
|---|---|---|---|
| projectile | 100% / 4/4 | 100% / 2/2 | 100% / 2/2 |
| crash-stop | 100% / 1/1 | 100% / 2/2 | 100% / 1/1 |
| damped-osc | 100% / — | 100% / — | 67% / — |
| logistic | 100% / — | 100% / — | 50% / — |
| gaussian | 50% / 2/2 | 100% / 4/4 | 67% / 2/2 |
| planck-ish | 100% / 1/1 | 100% / 1/1 | 100% / 2/2 |
| lorentz | 100% / 2/2 | 100% / 1/1 | 100% / 1/1 |
| ideal-gas | 100% / 0/1 | 100% / 0/1 | 100% / 0/1 |
| oblique | 100% / 2/2 | 100% / 3/3 | 100% / 2/2 |
| cubic | 100% / 3/3 | 100% / 3/3 | 67% / 3/3 |

**Symbols: 30/30 valid across all configs** — the tightened contract ("use the report's variable names verbatim") held everywhere.

Reading the two apparent dings for no-thinking shows both are metric artifacts, not model errors: *gaussian 50 %* penalizes not "marking" **parity** — a symmetry, not a point you can put in a range; *ideal-gas 0/1* occurs in **all three configs** — every variant sensibly proposed V > 0 ranges that exclude the V = 0 pole, as physical volume demands. Default thinking's misses are real, though: in 4/10 cases it ranked a feature ≥ 4 and then marked it in no view (damped-osc: decay envelope ranked 5/5, marked nowhere), plus one duplicated rank entry.

## 5. The outputs — all 10 scenarios (adopted config)

### Projectile height vs time — $v_0 t - \frac{1}{2} g t^2$

*3.91 s · 764 tokens*

> **Story:** Starting at zero height, the projectile rises to a peak height before falling back to the ground.

| Ranked feature | Usefulness | Why |
|---|---|---|
| extrema | 5 | The maximum represents the peak height of the projectile, which is a key concept in projectile motion. |
| zeros | 4 | The zeros represent when the projectile is at ground level, which are important points in its trajectory. |
| limits_at_infinity | 2 | While mathematically true, the projectile's height is only relevant for positive time values, so the end behavior is less practically important. |

| View | x | Range | Pinned | Marks |
|---|---|---|---|---|
| 1 | `t` | [0, 2.5] | {'g': 1, 'v_0': 1} | extrema, zeros |
| 2 | `t` | [-0.5, 2.5] | {'g': 9.8, 'v_0': 10} | extrema, zeros |

**Probe 1:** At what time does the projectile reach its maximum height?  
$t = 0$, **$t = v_0/g$** ✓, $t = 2v_0/g$, $t = v_0^2/(2g)$  
*The maximum height occurs when the derivative of the height function with respect to time is zero. Solving $-gt + v_0 = 0$ for $t$ gives $t = v_0/g$.*

**Probe 2:** What is the maximum height the projectile reaches?  
$0$, $v_0/g$, **$v_0^2/(2g)$** ✓, $2v_0/g$  
*Substitute the time of maximum height, $t = v_0/g$, back into the original expression: $-g(v_0/g)^2/2 + (v_0/g)v_0 = -gv_0^2/(2g^2) + v_0^2/g = -v_0^2/(2g) + 2v_0^2/(2g) = v_0^2/(2g)$.*

**Probe 3:** When does the projectile return to the ground?  
$t = 0$, $t = v_0/g$, **$t = 2v_0/g$** ✓, Never  
*The projectile is at ground level when its height is zero. Factoring the expression gives $t(-gt/2 + v_0) = 0$, so $t=0$ (launch) or $-gt/2 + v_0 = 0$, which solves to $t = 2v_0/g$.*

### Average acceleration in a crash stop — $\frac{V_f - V_i}{\Delta t}$

*3.06 s · 593 tokens*

> **Story:** This expression describes an average rate of change which blows up as the time interval approaches zero and tends towards zero for very long time intervals.

| Ranked feature | Usefulness | Why |
|---|---|---|
| singularities | 5 | The singularity at $\Delta t = 0$ is crucial for understanding the concept of instantaneous change and the physical implications of an 'infinitely short' crash stop. |
| limits_at_infinity | 4 | The limits at infinity show that for very long time intervals, the average acceleration approaches zero, which is physically intuitive as the change in velocity becomes less significant over a long duration. |
| parity | 3 | The odd parity indicates a symmetrical behavior around the singularity, where the sign of the average acceleration flips if the time interval's sign flips. |

| View | x | Range | Pinned | Marks |
|---|---|---|---|---|
| 1 | `Delta` | [-5, 5] | {'V_f': 0, 'V_i': 10} | singularities, limits_at_infinity |
| 2 | `Delta` | [-50, 50] | {'V_f': 0, 'V_i': 10} | limits_at_infinity |

**Probe 1:** What happens to the average acceleration as the time interval $\Delta t$ gets very, very small (close to zero)?  
**It gets very large (either positive or negative).** ✓, It gets very close to zero., It stays constant., It becomes undefined and cannot be calculated.  
*As $\Delta t$ approaches zero, the denominator of the fraction approaches zero, causing the overall value of the expression to become very large (either positive or negative, depending on the sign of $V_f - V_i$ and the direction from which $\Delta t$ approaches zero). This represents an 'instantaneous' change.*

### Damped oscillation — $e^{-b t} \cos{\omega t}$

*4.11 s · 799 tokens*

> **Story:** This expression describes an oscillation that gradually fades away over time, like a sound dying out.

| Ranked feature | Usefulness | Why |
|---|---|---|
| limits_at_infinity | 5 | The damping effect is the core concept of damped oscillation, clearly shown by the limit as $t \to \infty$. This is the most crucial feature for understanding the 'dying away' aspect. |
| zeros | 4 | The zeros represent the points where the oscillation momentarily passes through equilibrium, which is fundamental to understanding oscillatory behavior. The infinite family of zeros highlights the continuous oscillation. |
| extrema | 3 | The extrema represent the peaks and troughs of the oscillation, showing the amplitude's decay. While important, the exact locations are more complex than the zeros and the overall damping trend. |
| inflections | 2 | Inflection points show changes in concavity, which contribute to the shape of the wave, but are less central to the primary concept of damped oscillation than the damping itself or the oscillations' crossings. |

| View | x | Range | Pinned | Marks |
|---|---|---|---|---|
| 1 | `t` | [0, 10] | {'b': 0.5, 'omega': 2} | limits_at_infinity, zeros, extrema |
| 2 | `t` | [0, 100] | {'b': 0.1, 'omega': 1} | limits_at_infinity |

**Probe 1:** What happens to the value of the expression as time $t$ gets very, very large?  
It oscillates with constant amplitude., It grows without bound., **It approaches zero.** ✓, It approaches a non-zero constant.  
*Because of the $e^{-bt}$ term, as $t \to \infty$, $e^{-bt} \to 0$, causing the entire expression to approach zero, representing the damping.*

**Probe 2:** At what points in time does the oscillation pass through zero?  
Only at $t=0$., **At regular intervals related to $\omega$.** ✓, Never, it only approaches zero., Only when $b=0$.  
*The $\cos(\omega t)$ term causes the expression to cross zero whenever $\cos(\omega t) = 0$, which occurs at regular intervals determined by $\omega$.*

### Logistic growth — $\frac{L}{1 + e^{-k x}}$

*3.23 s · 627 tokens*

> **Story:** This expression describes a quantity that starts near zero, grows exponentially, and then levels off at a maximum value.

| Ranked feature | Usefulness | Why |
|---|---|---|
| limits_at_infinity | 5 | The horizontal asymptotes represent the carrying capacity and the initial state of the population, which are central to understanding logistic growth. |
| inflections | 4 | The inflection point shows where the growth rate is maximized, a key concept in population dynamics. |
| singularities | 1 | The singularity is at a complex number, which is not relevant for real-world population growth models. |

| View | x | Range | Pinned | Marks |
|---|---|---|---|---|
| 1 | `x` | [-10, 10] | {'L': 10, 'k': 1} | limits_at_infinity, inflections |
| 2 | `x` | [-2, 2] | {'L': 10, 'k': 1} | inflections |

**Probe 1:** As $x$ gets very large (approaches positive infinity), what value does the population approach?  
0, **$L$** ✓, $L/2$, infinity  
*As $x \to \infty$, $e^{-kx} \to 0$, so the expression approaches $L/(1+0) = L$. This represents the carrying capacity.*

**Probe 2:** As $x$ gets very small (approaches negative infinity), what value does the population approach?  
**0** ✓, $L$, $L/2$, infinity  
*As $x \to -\infty$, $e^{-kx} \to \infty$, so the expression approaches $L/\infty = 0$. This represents the initial state.*

**Probe 3:** Where does the population growth rate appear to be the fastest?  
Near $x = -\infty$, **Near $x = 0$** ✓, Near $x = \infty$, The growth rate is constant  
*The inflection point, where the curve changes concavity from curving upwards to curving downwards, represents the point of maximum growth rate. For this function, that occurs at $x=0$.*

### Gaussian bell curve — $e^{- \frac{x^2}{2 \sigma^2}}$

*4.06 s · 865 tokens*

> **Story:** This function describes a bell-shaped curve that is symmetric around $x=0$, peaks at 1, and approaches 0 as $x$ moves away from the origin.

| Ranked feature | Usefulness | Why |
|---|---|---|
| extrema | 5 | The maximum at $x=0$ and its value of 1 is the most defining characteristic of the bell curve, representing the most probable outcome or the center of the distribution. |
| parity | 4 | The even parity indicates symmetry around the y-axis, which is a crucial visual and conceptual property of the bell curve, especially in the context of measurement noise around a true value. |
| inflections | 3 | The inflection points show where the curve changes its concavity, which is important for understanding the spread and shape of the bell curve, related to its standard deviation. |
| limits_at_infinity | 2 | The behavior as $x \to \pm\infty$ shows the tails of the distribution approaching zero, indicating that extreme values become very unlikely. |

| View | x | Range | Pinned | Marks |
|---|---|---|---|---|
| 1 | `x` | [-5, 5] | {'sigma': 1} | extrema, inflections |
| 2 | `x` | [-10, 10] | {'sigma': 2} | limits_at_infinity |

**Probe 1:** Where does the bell curve reach its highest point?  
At $x = \sigma$, **At $x = 0$** ✓, At $x = -\sigma$, As $x \to \infty$  
*The exponent $-x^2/(2\sigma^2)$ is always non-positive, so $e^{\text{exponent}}$ is maximized when the exponent is 0, which happens at $x=0$.*

**Probe 2:** What is the maximum value of the function?  
$0$, **$1$** ✓, $\sigma$, $e$  
*When $x=0$, the exponent is 0, so the function value is $e^0 = 1$.*

**Probe 3:** How does the curve behave as $x$ gets very large (positive or negative)?  
It goes to infinity., It oscillates., It approaches 1., **It approaches 0.** ✓  
*As $x$ gets very large, $x^2/(2\sigma^2)$ becomes very large and positive, making the exponent a very large negative number, so $e^{\text{large negative}}$ approaches 0.*

**Probe 4:** What kind of symmetry does the bell curve have?  
Symmetry about the x-axis, **Symmetry about the y-axis** ✓, Symmetry about the origin, No symmetry  
*Since $x^2 = (-x)^2$, the function $f(x) = e^{-x^2/(2\sigma^2)}$ is equal to $f(-x)$, indicating symmetry about the y-axis.*

### Blackbody-like spectrum — $\frac{x^3}{e^x - 1}$

*3.66 s · 746 tokens*

> **Story:** This function starts at zero, rises to a peak, and then decays back to zero as $x$ increases, while blowing up to infinity as $x$ decreases from zero.

| Ranked feature | Usefulness | Why |
|---|---|---|
| extrema | 5 | The peak is central to understanding the blackbody spectrum, which is the context for this expression. The problem explicitly asks about a 'peak wavelength'. |
| limits_at_infinity | 4 | The behavior as $x \to \infty$ and $x \to -\infty$ explains why the spectrum has a characteristic 'hump' shape, starting and ending at zero (or tending towards it). |
| singularities | 3 | Although $x=0$ is a removable singularity where the limit is 0, it's important to understand why the denominator is zero there and that the function approaches zero, not infinity, from both sides. However, in the blackbody context, we are usually interested in $x>0$. |

| View | x | Range | Pinned | Marks |
|---|---|---|---|---|
| 1 | `x` | [0, 10] | {} | extrema, limits_at_infinity |
| 2 | `x` | [-5, 5] | {} | extrema, singularities, limits_at_infinity |

**Probe 1:** What happens to the value of the function as $x$ gets very large and positive?  
It approaches infinity., It approaches a specific positive value., **It approaches zero.** ✓, It oscillates between positive and negative values.  
*The exponential $e^x$ grows much faster than $x^3$, so the denominator dominates, making the fraction approach zero.*

**Probe 2:** What happens to the value of the function as $x$ gets very large and negative?  
**It approaches infinity.** ✓, It approaches zero., It approaches a specific negative value., It oscillates.  
*As $x \to -\infty$, $e^x \to 0$, so the denominator approaches $-1$. The numerator $x^3$ approaches $-\infty$, making the fraction approach infinity (specifically, positive infinity since $x^3$ is negative and the denominator is negative).*

**Probe 3:** Based on the problem context (blackbody spectrum peak), what kind of feature would you expect to see for positive values of $x$?  
A vertical asymptote., A horizontal asymptote., **A maximum value.** ✓, A point where the function crosses the x-axis.  
*The term 'peak wavelength' directly implies the existence of a maximum value for the function.*

### Relativistic gamma factor — $\frac{1}{\sqrt{1 - \frac{v^2}{c^2}}}$

*4.74 s · 810 tokens*

> **Story:** This expression shows how the gamma factor remains positive, has a minimum at $v=0$, and blows up as $v$ approaches $c$ from either side, making speeds beyond $c$ impossible.

| Ranked feature | Usefulness | Why |
|---|---|---|
| singularities | 5 | The singularities at $v=\pm c$ are the most crucial features, directly explaining why an object's speed cannot reach or exceed the speed of light, which is the core concept of the lesson context. |
| extrema | 4 | The minimum at $v=0$ (where gamma is 1) represents the baseline relativistic effect (no effect at rest), which is important for understanding the *change* as speed increases. |
| parity | 3 | Even parity indicates that the relativistic effect is the same regardless of the direction of velocity, which is physically intuitive and simplifies understanding the graph. |
| limits_at_infinity | 1 | The limits at infinity are mathematically present but physically irrelevant in this context, as $v$ cannot exceed $c$. |

| View | x | Range | Pinned | Marks |
|---|---|---|---|---|
| 1 | `v` | [-1.5, 1.5] | {'c': 1} | singularities, extrema |
| 2 | `v` | [-1.1, 1.1] | {'c': 1} | singularities, extrema |

**Probe 1:** What is the value of the gamma factor when the velocity $v$ is zero?  
0, **1** ✓, infinity, undefined  
*When $v=0$, the expression simplifies to $1/\sqrt{1-0} = 1/1 = 1$, representing no relativistic effects for an object at rest.*

**Probe 2:** What happens to the gamma factor as the velocity $v$ approaches the speed of light $c$?  
It approaches 0., It approaches 1., **It approaches infinity.** ✓, It becomes negative.  
*As $v$ approaches $c$, the term $v^2/c^2$ approaches 1, making the denominator $\sqrt{1-1} = 0$, causing the expression to approach infinity.*

**Probe 3:** Can the velocity $v$ be greater than the speed of light $c$ in this expression?  
Yes, it just makes gamma negative., Yes, but gamma becomes imaginary., **No, because the square root becomes undefined.** ✓, No, it's just a very large positive number.  
*If $v > c$, then $v^2/c^2 > 1$, making $1 - v^2/c^2$ negative, which means the square root of a negative number is undefined in real numbers.*

### Ideal gas pressure vs volume — $\frac{n R T}{V}$

*2.6 s · 493 tokens*

> **Story:** As the container volume approaches zero, the pressure becomes infinitely large, while a very large volume results in the pressure approaching zero.

| Ranked feature | Usefulness | Why |
|---|---|---|
| singularities | 5 | This represents the physical impossibility of zero volume and the resulting infinite pressure, which is a key concept in ideal gas law. |
| limits_at_infinity | 4 | This describes the behavior of pressure as volume becomes very large, illustrating that pressure approaches zero, which is physically intuitive. |
| parity | 2 | While mathematically true, the concept of negative volume is not physically relevant in this context, making parity less useful for this specific lesson. |

| View | x | Range | Pinned | Marks |
|---|---|---|---|---|
| 1 | `V` | [0.1, 10] | {'R': 8.314, 'T': 298, 'n': 1} | singularities, limits_at_infinity |

**Probe 1:** What happens to the pressure of an ideal gas as the volume of its container approaches zero?  
It approaches zero., **It approaches infinity.** ✓, It remains constant., It becomes negative.  
*As $V \to 0$, the expression $\frac{RTn}{V}$ approaches $\infty$ because you are dividing by a number very close to zero.*

**Probe 2:** What happens to the pressure of an ideal gas as the volume of its container becomes very large?  
**It approaches zero.** ✓, It approaches infinity., It remains constant., It becomes negative.  
*As $V \to \infty$, the expression $\frac{RTn}{V}$ approaches $0$ because you are dividing by a very large number.*

### Rational fn with oblique asymptote — $\frac{x^2 - 1}{x}$

*3.48 s · 745 tokens*

> **Story:** This function approaches its oblique asymptote $y=x$ as $x$ goes to infinity, while also having zeros at $x=1$ and $x=-1$ and a vertical asymptote at $x=0$.

| Ranked feature | Usefulness | Why |
|---|---|---|
| singularities | 5 | The vertical asymptote at $x=0$ is a critical feature stemming from the denominator, leading to interesting behavior as $x$ approaches 0. |
| limits_at_infinity | 4 | The oblique asymptote $y=x$ reveals the long-term behavior of the function, which is a key concept for rational functions where the degree of the numerator is one greater than the denominator. |
| zeros | 3 | The zeros at $x=1$ and $x=-1$ are easily found from the numerator and represent where the function crosses the x-axis, providing important reference points. |

| View | x | Range | Pinned | Marks |
|---|---|---|---|---|
| 1 | `x` | [-5, 5] | {} | singularities, zeros, limits_at_infinity |
| 2 | `x` | [-10, 10] | {} | limits_at_infinity |

**Probe 1:** What happens to the function's value as $x$ gets very close to 0?  
It approaches 1, It approaches 0, **It becomes undefined and goes to positive or negative infinity** ✓, It approaches -1  
*The denominator $x$ becomes zero at $x=0$, causing the function to have a vertical asymptote there.*

**Probe 2:** Where does the function cross the x-axis?  
Only at $x=0$, **At $x=1$ and $x=-1$** ✓, At $x=1$ only, Nowhere  
*The numerator $x^2-1$ is zero when $x^2=1$, which means $x=1$ or $x=-1$.*

**Probe 3:** As $x$ gets very large (positive or negative), what line does the function's graph approach?  
The x-axis ($y=0$), The y-axis ($x=0$), **The line $y=x$** ✓, The line $y=x^2$  
*By polynomial division, $\frac{x^2-1}{x} = x - \frac{1}{x}$, so as $|x|$ gets large, the term $\frac{1}{x}$ goes to zero, leaving $y=x$ as the oblique asymptote.*

### Cubic with two turning points — $x^3 - 3 x$

*3.92 s · 750 tokens*

> **Story:** This cubic function wiggles through the x-axis three times, reaching a local peak before a local valley, and stretching to positive and negative infinity at its ends.

| Ranked feature | Usefulness | Why |
|---|---|---|
| extrema | 5 | The local maximum and minimum are key defining features of this cubic, explicitly mentioned in the context, and visually prominent. |
| zeros | 4 | The three real zeros show where the function crosses the x-axis, providing important reference points for understanding its shape. |
| limits_at_infinity | 3 | The end behavior indicates that the function grows without bound in both positive and negative directions, which is characteristic of odd-degree polynomials. |
| inflections | 2 | The inflection point at $x=0$ shows where the concavity changes, contributing to the overall shape, but is less immediately striking than the extrema or zeros. |
| parity | 1 | Odd parity means the function is symmetric about the origin, which is a mathematical property but less directly observable as a 'behavior' feature for a first look. |

| View | x | Range | Pinned | Marks |
|---|---|---|---|---|
| 1 | `x` | [-3, 3] | {} | extrema, zeros, inflections |
| 2 | `x` | [-5, 5] | {} | limits_at_infinity |

**Probe 1:** How many times does the graph of $x^3 - 3x$ cross the x-axis?  
One time, Two times, **Three times** ✓, Zero times  
*The expression $x^3 - 3x = x(x^2 - 3)$ shows factors $x$, $(x - \sqrt{3})$, and $(x + \sqrt{3})$, leading to three real zeros.*

**Probe 2:** What is the highest value the function reaches in its 'wiggle' before dropping?  
0, 1, **2** ✓, -2  
*The local maximum occurs at $x = -1$, where the function value is $2$. You can see this by plugging $x=-1$ into $x^3-3x$.*

**Probe 3:** As $x$ gets very large in the positive direction, what happens to the value of $x^3 - 3x$?  
**It gets very large and positive.** ✓, It gets very large and negative., It approaches zero., It oscillates between positive and negative values.  
*For large positive $x$, the $x^3$ term dominates, causing the function to go to positive infinity.*


## 6. Hard-case findings

- **Removable singularity** ($\frac{x^3}{e^x - 1}$): the trap. The CAS reported the $x=0$ singularity with `vertical_asymptote: false`; the no-thinking model correctly **demoted** it (usefulness 3 vs the other configs' 4) and told the right story — including the genuine blow-up toward $-\infty$. No deliberation needed to dodge the "singularity = blow-up" reflex, because the fingerprint carried the truth.
- **Lorentz factor**: all configs nailed the $v \to c$ pole; no-thinking additionally ranked the $\gamma(0)=1$ minimum higher (4 vs default's 3) — the pedagogically warmer entry point.
- **Damped oscillation**: no-thinking produced the best apparatus — a dual-scale view pair ([0, 10] for the wiggles, [0, 100] for the envelope's death). Default thinking ranked the envelope 5/5 and then marked it in no view.
- **Full thinking was sloppier, not sharper**: more elaborate prose, looser contract adherence. Consistent with the design: when the math arrives precomputed, extra deliberation only adds opportunities to wander.

## 7. Verdict & caveats

**Adopted: `Predict` + thinking disabled.** ~3× faster than a low thinking budget, ~4× faster than default, tight latency band, best-or-equal outputs on all 10 scenarios including the traps.

Caveats, held honestly: one run per cell (temperature 0.7, so single samples carry variance); quality judged by mechanical checks + human read, not a formal eval metric; all 10 expressions have ≤ 4 meaningful features — a 10-feature monster with subtle context trade-offs remains untested; and if the proposer's job ever grows real derivation (Phase E limiting expressions), thinking must return for that call — a one-line change to the `reasoning_effort` in `_proposer_lm()`.

**Known open issues:** `\Delta t` parses as the product `Delta·t` (upstream `parse_latex` quirk — the handler flags affected views via `unknown_symbols`); probe `feature` attribution field often left empty.