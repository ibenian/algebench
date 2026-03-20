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
A gallery of probability distributions, each as an interactive curve or surface
with parameter sliders. Organized by family with animated transitions showing how
distributions relate to each other.

**Discrete distributions:**
- **Bernoulli(p)** — a single coin flip. The atomic building block. Slider for p.
  Just two bars: P(0) = 1−p, P(1) = p.
- **Binomial(n, p)** — number of successes in n independent Bernoulli trials.
  Sliders for n and p. Bar chart morphs as parameters change. Watch it approach
  normal as n grows (bridge to CLT).
- **Geometric(p)** — number of trials until first success. Slider for p. Show the
  memoryless property (unique among discrete distributions). The bars decay
  exponentially — connect to the exponential distribution as its continuous analog.
- **Negative Binomial(r, p)** — trials until r-th success. Generalizes geometric
  (r=1). Sliders for r and p. Show it approaching normal for large r.
- **Poisson(λ)** — rare event counts. Slider for λ. Show it emerging from
  binomial as n→∞, p→0, np→λ. Animate the transition: start with Binomial(100, 0.05)
  and increase n while decreasing p — the bars converge to Poisson(5).
- **Hypergeometric(N, K, n)** — sampling without replacement. Compare side by side
  with binomial (sampling with replacement): they diverge when n is large relative
  to N. Sliders for population size N, successes K, and sample size n.

**Continuous distributions:**
- **Uniform(a, b)** — the flat distribution. Sliders for a and b. Maximum entropy
  among distributions with bounded support. Starting point for many simulations.
- **Normal / Gaussian(μ, σ)** — the bell curve. Sliders for μ and σ. Shade the
  68-95-99.7 regions. Connect to sigma levels lesson. Show the PDF and CDF side
  by side.
- **Log-Normal(μ, σ)** — when the logarithm is normal. Common in finance (stock
  returns), biology (organism sizes), and income distributions. Show the rightward
  skew and how it emerges from exponentiating a normal variable.
- **Exponential(λ)** — waiting times between events. Slider for rate λ. Show the
  memoryless property: P(X > s+t | X > s) = P(X > t) by slicing the curve.
  Connect to Poisson: if events arrive as Poisson(λ), inter-arrival times are
  Exponential(λ).
- **Gamma(α, β)** — waiting time for the α-th event. Generalizes exponential
  (α=1). Sliders for shape α and rate β. Show how it approaches normal for large α.
  Special case: Chi-squared(k) = Gamma(k/2, 1/2).
- **Beta(α, β)** — the distribution on [0, 1]. The conjugate prior for binomial
  probability. Sliders for α and β produce an extraordinary range of shapes:
  uniform (1,1), U-shaped (<1,<1), skewed, symmetric, peaked. Show how it updates
  as a Bayesian prior: start with Beta(1,1), observe successes and failures, watch
  the posterior sharpen. Connect to the Bayesian update lesson.
- **Chi-Squared(k)** — sum of k squared standard normals. Slider for degrees of
  freedom k. Skewed at small k, approaches normal at large k. Used in hypothesis
  testing (goodness of fit, independence tests). Show it as a special case of Gamma.
- **Student's t(ν)** — like normal but with heavier tails. Slider for degrees of
  freedom ν. At ν=1 it's Cauchy (extremely heavy tails). At ν→∞ it converges to
  normal. Show why it matters: when σ is unknown and estimated from small samples,
  the test statistic follows t, not normal.
- **F(d₁, d₂)** — ratio of two chi-squared variables. Sliders for both degrees
  of freedom. Used in ANOVA and regression F-tests. Show it as a ratio: animate
  two independent chi-squared draws and their ratio.
- **Cauchy** — the pathological distribution. Looks like a normal but with tails
  so heavy that the mean doesn't exist. The average of n Cauchy samples doesn't
  converge — animate this failure of the LLN. A cautionary tale about assuming
  normality.
- **Weibull(k, λ)** — reliability and survival analysis. Shape parameter k controls
  failure rate: k<1 = infant mortality (decreasing hazard), k=1 = exponential
  (constant hazard), k>1 = wear-out (increasing hazard). Slider for k animates
  the transition between failure modes.

**Multivariate distributions:**
- **Bivariate Normal(μ, Σ)** — a 3D bell surface. Sliders for means, variances,
  and correlation ρ. Show the elliptical contours rotating as ρ changes. Project
  onto each axis to see the marginals. Condition on one variable: slice the surface
  and show the conditional distribution is also normal.
- **Multinomial** — generalization of binomial to k categories. Visualize as a
  simplex (triangle for k=3) with probability mass distributed over it.
- **Dirichlet(α)** — the conjugate prior for multinomial, lives on the simplex.
  Sliders for α parameters reshape the density over the triangle from uniform to
  peaked at corners or center.

**Distribution relationships map:** a visual graph connecting all distributions with
labeled edges ("limit of", "special case", "conjugate prior of", "sum of"). Clicking
any node loads that distribution's interactive scene. Animate transition paths:
Bernoulli → Binomial → Normal, or Exponential → Gamma → Chi-Squared.

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

### Sampling Theory — Sample vs Population
The fundamental distinction in statistics. Scene 1: a large population of dots
with a true mean μ and true variance σ². Draw a random sample of size n (slider)
— highlight the sampled dots. Compute the sample mean x̄ and sample variance s².
Repeat many times: the sample statistics scatter around the population values.
Show the sampling distribution of x̄ as a histogram — it's narrower than the
population (by √n). Scene 2: **sample vs population notation** side by side —
μ vs x̄, σ² vs s², N vs n. Show why we divide by (n−1) for sample variance
(Bessel's correction): animate n samples, compute variance with /n and /(n−1),
show that /n is biased low while /(n−1) hits the true variance on average.
Scene 3: **standard error** — the standard deviation of the sampling distribution.
SE = σ/√n. Slider for n: as n grows, SE shrinks, the sampling distribution
tightens. This is WHY larger samples give more precise estimates. Connect to
confidence intervals: CI width ∝ SE ∝ 1/√n.

### Monte Carlo Estimation
Visualize random sampling for estimating probabilities and integrals. Scatter random
points in a region; color by hit/miss. Show convergence of the estimate as sample
size increases. Connect to the law of large numbers.

### Likelihood vs Probability — The Same Formula, Two Questions
The most confusing distinction in statistics. Probability asks: "given a fixed
model, how probable is this data?" Likelihood asks: "given fixed data, how
plausible is this model?" Same formula P(data|θ), different variable.
Scene 1: fix θ, sweep over possible data values — the curve is a probability
distribution (integrates to 1). Scene 2: fix the observed data, sweep over θ —
the curve is a likelihood function (does NOT integrate to 1, and doesn't need to).
Show both views simultaneously: a 2D heatmap of P(x|θ) with a vertical slice
(probability for fixed θ) and a horizontal slice (likelihood for fixed x).
The MLE is the θ that maximizes the horizontal slice. Connect to Bayes:
likelihood × prior ∝ posterior.

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

### KL (Kullback-Leibler) Divergence — Distance Between Distributions
How different are two distributions? Visualize P (true) and Q (approximation) as
two overlaid curves. The KL divergence D_KL(P‖Q) = ∑P log(P/Q) is shown as the
shaded area of the ratio curve. Slider morphs Q toward or away from P; the
divergence value updates. Show key properties: KL ≥ 0, KL = 0 iff P = Q,
asymmetric (D_KL(P‖Q) ≠ D_KL(Q‖P)). Connect to MLE: minimizing KL divergence
from data to model is equivalent to maximizing likelihood.

### Huffman Coding — Optimal Symbol-by-Symbol Compression
Build a Huffman tree step by step. Start with a frequency table (e.g. letters in
English text) shown as a bar chart. The algorithm greedily merges the two lowest-
frequency nodes — animate each merge as the tree grows. The final tree assigns
short codes to common symbols and long codes to rare ones. Show the resulting
code table alongside Shannon entropy: Huffman's average bits/symbol approaches
the entropy lower bound but can't beat it. Slider adjusts the frequency
distribution — watch the tree restructure and the average code length track
entropy. Second scene: encode a sample string character by character, showing
the bit stream building up and the compression ratio updating.

### Run-Length & Lempel-Ziv — Pattern-Based Compression
Move beyond symbol-by-symbol coding to compression that exploits repeated patterns.
Scene 1: **Run-Length Encoding (RLE)** — a sequence of colored blocks with runs of
repeated values. Animate the encoder scanning left to right, replacing runs with
(count, value) pairs. Show compression ratio for different pattern densities (slider).
Works great for images with large flat regions, terrible for noisy data.
Scene 2: **LZ77 / LZ78** — the foundation of gzip, PNG, and most modern compressors.
Visualize the sliding window: the encoder finds the longest match in the recent
history and emits a (distance, length) pointer instead of raw symbols. Animate the
window sliding over a text string, highlighting matches as back-references. Show how
repeated phrases get compressed to tiny pointers. Connect to entropy: LZ approaches
the entropy rate for stationary sources as the window grows.

### Byte Pair Encoding & Tokenization — How LLMs Read Text
The bridge from compression to AI. Scene 1: **Byte Pair Encoding (BPE)** — start
with character-level tokens. Find the most frequent adjacent pair, merge it into a
new token, repeat. Animate each merge step: the vocabulary grows, the sequence
shrinks. Show the token count dropping with each iteration. Slider controls number
of merge steps — at 0 merges it's raw characters, at many merges common words become
single tokens. Scene 2: **Tokenization in practice** — paste a sentence (or use
presets) and show how GPT-style tokenizers split it. Common words ("the", "and")
are single tokens. Rare words get split into subwords. Numbers and code get split
character by character. Visualize the token boundaries with colored blocks.
Scene 3: **Why tokenization matters for LLMs** — the model sees token IDs, not
characters. Show the same sentence in different tokenizations (character, word, BPE)
and count the sequence length. Shorter sequences = less computation = longer context.
Connect back to entropy: BPE is a greedy approximation of the optimal encoding, and
the vocabulary size/sequence length tradeoff mirrors the entropy/code-length tradeoff
from Huffman.

### Arithmetic Coding — Approaching the Entropy Limit
The theoretically optimal compression method that Huffman can only approximate.
Visualize the unit interval [0, 1) being recursively subdivided: each symbol narrows
the interval proportionally to its probability. Animate encoding symbol by symbol —
the interval shrinks and the output precision grows. Show how the final interval
width equals the probability of the entire message: −log₂(width) = message length
in bits ≈ entropy × message length. Contrast with Huffman: arithmetic coding
achieves fractional bits per symbol where Huffman is stuck at whole bits.

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

## 2. Machine Learning

### Linear Regression — Fitting a Line
The simplest ML model. Scatter data points in 3D (x, y, residual on z-axis).
A plane (or line in 2D) slides through the cloud — sliders for slope and intercept.
The residuals are visible as vertical bars from each point to the line. The sum of
squared residuals updates live. Animate gradient descent: the line tilts and shifts
step by step toward the least-squares solution. Show the loss surface as a bowl-shaped
paraboloid in (slope, intercept, loss) space — gradient descent rolls downhill.

### Gradient Descent — Walking Downhill
The optimization engine behind all of ML. Scene 1: a 2D loss surface (contour plot
or 3D terrain). Drop a ball at a random point — it follows the negative gradient
downhill. Sliders for learning rate and starting position. Too large a learning rate
→ the ball overshoots and oscillates. Too small → it crawls. Scene 2: compare
variants side by side — vanilla GD, momentum (ball gains speed), Adam (adaptive
per-parameter rates). Scene 3: saddle points and local minima — show the ball
getting stuck, then escaping with momentum.

### Logistic Regression — Drawing a Boundary
Two classes of points in 2D. The decision boundary is a line (or curve in feature
space). Slider for the threshold — the sigmoid function stretches and compresses,
moving the boundary. Show the sigmoid curve alongside the scatter plot: each point's
predicted probability updates as the boundary shifts. Animate gradient descent on
the cross-entropy loss surface. Connect to probability: the sigmoid output IS a
conditional probability P(y=1|x).

### Bias-Variance Tradeoff — Underfitting vs Overfitting
The central tension in ML. Scene 1: fit polynomials of increasing degree to noisy
data. Degree slider: at degree 1 the line underfits (high bias). At degree 15 it
wiggles through every point (high variance, overfitting). Show train error decreasing
monotonically while test error forms a U-curve. Scene 2: visualize the decomposition
— total error = bias² + variance + irreducible noise. Three stacked area charts
that trade off as model complexity increases.

### k-Nearest Neighbors — Voting by Proximity
Scatter labeled points in 2D/3D. For a query point (draggable), highlight its k
nearest neighbors and show the majority vote. Slider for k: at k=1 the boundary is
jagged (overfitting). At k=n it's a single class everywhere (underfitting). Animate
the decision boundary as k changes — a Voronoi-like tessellation that smooths out
with larger k. Show how distance metric matters: toggle between Euclidean and
Manhattan distance, watch the boundary reshape.

### Decision Trees & Random Forests — Splitting the Space
Scene 1: a 2D feature space with labeled points. The tree makes axis-aligned splits
— animate each split as a line that partitions the space. Show the tree structure
growing alongside the spatial partitions. Slider for max depth: shallow tree
underfits, deep tree overfits. Scene 2: random forests — show 10 trees side by side,
each trained on a bootstrap sample with random feature subsets. Each tree makes
different splits; the ensemble vote smooths the boundary. Visualize the variance
reduction.

### Impurity Measures — Entropy vs Gini vs Misclassification
How does a decision tree decide where to split? Compare the three impurity measures
side by side as curves over class probability p ∈ [0, 1] for a binary classification:

- **Entropy** H(p) = −p log₂p − (1−p) log₂(1−p) — from information theory
- **Gini impurity** G(p) = 2p(1−p) — the probability of misclassifying a random
  sample if labeled according to the class distribution
- **Misclassification error** E(p) = 1 − max(p, 1−p) — the simplest measure

All three peak at p=0.5 (maximum uncertainty) and hit zero at p=0 and p=1 (pure
nodes). But their shapes differ: entropy is the most curved (most aggressive at
penalizing impurity), Gini is a close approximation, misclassification error is
a triangle (piecewise linear, insensitive to probability shifts away from 0.5).
Slider moves a split point through data; show the information gain (parent impurity
minus weighted child impurity) for all three measures simultaneously. Explain why
Gini and entropy usually agree but misclassification error can miss good splits.

### Classification Metrics — Precision, Recall, F1 & ROC
Scene 1: **The confusion matrix as a probability rectangle.** Four quadrants:
true positives, false positives, true negatives, false negatives. A threshold
slider moves the decision boundary — watch the four regions resize in real time.
Derive each metric geometrically from the rectangle areas:

- **Precision** = TP / (TP + FP) — "of those I called positive, how many are?"
- **Recall / Sensitivity** = TP / (TP + FN) — "of the actual positives, how many
  did I catch?"
- **Specificity** = TN / (TN + FP) — "of the actual negatives, how many did I
  correctly exclude?"
- **F1 Score** = 2 · (Precision · Recall) / (Precision + Recall) — harmonic mean,
  penalizes imbalance between precision and recall

Scene 2: **The precision-recall tradeoff.** As the threshold slider moves,
precision and recall trade off — plot both as curves against threshold. Show the
F1 score as a third curve peaking where the tradeoff is best balanced. Connect to
base rate: with rare positives (low prevalence), high precision is hard even with
high recall.

Scene 3: **ROC curve.** Plot True Positive Rate (recall) vs False Positive Rate
(1 − specificity) as the threshold sweeps. The diagonal is random guessing; a
perfect classifier hugs the top-left corner. Shade the AUC (Area Under Curve) —
the probability that the model ranks a random positive above a random negative.
Slider for model quality: watch the ROC curve bow upward and AUC increase.

### Support Vector Machines — The Widest Street
Two classes of points in 2D. The SVM finds the hyperplane that maximizes the margin
(the widest "street" between classes). Animate the margin as parallel lines that
push apart until they hit the nearest points (support vectors). Highlight the support
vectors — only they determine the boundary. Slider adds noise: some points cross
the margin, introducing slack variables. Second scene: the kernel trick — data
that's not linearly separable in 2D gets lifted to 3D where a plane separates it.
Animate the lift and show the nonlinear boundary projected back to 2D.

### Neural Networks — Layers of Functions
Scene 1: a single neuron — inputs x₁, x₂ as arrows, weights as slider-controlled
multipliers, summation, activation function (sigmoid/ReLU). Show the output surface
as a 3D landscape over (x₁, x₂) — the activation function shapes it. Scene 2: a
2-layer network with 2–4 hidden neurons. Each hidden neuron carves a linear boundary;
the output neuron combines them into a nonlinear boundary. Animate training: watch
the boundaries rotate and shift as weights update. Scene 3: the loss landscape of a
small network — a complex terrain with multiple minima, saddle points, and ridges.

### Backpropagation — The Chain Rule at Scale
How gradients flow backward through a neural network. Visualize a computation graph:
nodes are operations (multiply, add, ReLU), edges carry values forward and gradients
backward. Animate forward pass (values propagate left to right) then backward pass
(gradients flow right to left via the chain rule). Highlight how each node computes
its local gradient and multiplies by the upstream gradient. Show vanishing gradients:
in a deep sigmoid network, gradients shrink exponentially — color-code edge thickness
by gradient magnitude.

### Convolutional Neural Networks — Filters That See
Scene 1: **A single convolution filter** — a small 3×3 kernel slides across a 2D
input (image or feature map). At each position, element-wise multiply and sum.
Animate the kernel sliding; the output feature map builds up pixel by pixel. Show
classic hand-crafted filters: edge detector (Sobel), blur (Gaussian), sharpen.
Scene 2: **Learned filters** — in a trained CNN, filters learn to detect features.
Show a hierarchy: layer 1 detects edges, layer 2 detects textures, layer 3 detects
parts (eyes, wheels), deeper layers detect objects. Visualize the feature maps at
each layer as tiled images. Scene 3: **Pooling** — max pooling and average pooling
as downsampling. A 2×2 window slides across the feature map, keeping only the max
(or average). The spatial resolution halves, but the important features survive.
Scene 4: **Full architecture** — stack conv → ReLU → pool layers. Show the input
image shrinking spatially but growing in depth (more channels). Connect to the
signal processing convolution lesson: same math, different domain.

### Diffusion Models — Learning to Denoise
How DALL-E, Stable Diffusion, and Midjourney work. Scene 1: **The forward
process** — start with a clean image (or 2D point cloud for simplicity). Add
Gaussian noise step by step. Slider for timestep t: at t=0 the image is clean,
at t=T it's pure noise. Show the image degrading and the pixel distribution
converging to N(0,1). Scene 2: **The reverse process** — a neural network learns
to predict and remove the noise at each step. Start from pure noise, denoise step
by step, watch structure emerge from chaos. Animate the denoising: each step
sharpens the image slightly. Scene 3: **The noise schedule** — how much noise to
add at each step. Linear vs cosine schedule. Slider for schedule type: show how
the schedule affects generation quality. Scene 4: **Latent diffusion** — diffuse
in a compressed latent space instead of pixel space. Show the encoder compressing
the image, diffusion in the small latent space, then decoder expanding back.
Connect to: random walks (diffusion IS a random walk in pixel space), entropy
(noise increases entropy, denoising decreases it), and the heat equation (forward
process is literally heat diffusion).

### Generative Adversarial Networks — The Counterfeiter and the Detective
Scene 1: **The generator** — takes random noise z and produces a fake sample.
Visualize in 2D: noise from a circle gets warped through the network into a
distribution that tries to match real data. Scene 2: **The discriminator** — a
classifier that tries to distinguish real from fake. Show the decision boundary
in data space. Scene 3: **The adversarial game** — animate training alternation.
Generator improves (fakes get better), discriminator adapts (boundary shifts),
repeat. The generator's output distribution gradually converges toward the real
data distribution. Scene 4: **Mode collapse** — when the generator only produces
one type of output. Show the generated distribution collapsing to a single point
while the real distribution is multimodal.

### Autoencoders & Variational Autoencoders — Compress and Reconstruct
Scene 1: **Autoencoder** — an input (2D point or image) passes through an encoder
that compresses it to a low-dimensional bottleneck (latent code), then a decoder
reconstructs it. Animate: the input goes in, squeezes through the bottleneck, comes
out approximately reconstructed. Slider for bottleneck dimension: smaller = more
compression = more reconstruction error. Scene 2: **Variational Autoencoder
(VAE)** — the encoder outputs a mean and variance, not a single point. The latent
space is forced to be a smooth Gaussian. Sample from it and decode: nearby latent
points produce similar outputs. Animate interpolation: slide between two latent
codes, watch the output morph smoothly. Connect to: KL divergence (the VAE loss
includes KL between the encoder output and N(0,1)), and diffusion models (VAEs
are a precursor).

### Dimensionality Reduction — PCA & t-SNE
Scene 1: **PCA** — a 3D point cloud with an elongated shape. The first principal
component is the direction of maximum variance — show it as a vector through the
cloud. Project all points onto this vector (animate the collapse). The second PC is
perpendicular. Slider for number of components kept: at 1 it's a line, at 2 a plane,
at 3 the full space. Show reconstruction error vs components. Scene 2: **t-SNE** —
high-dimensional data (e.g. digit embeddings) mapped to 2D. Animate the optimization:
points repel and attract until clusters form. Slider for perplexity — low values
show local structure, high values show global structure.

### Clustering — k-Means & Beyond
Scene 1: **k-Means** — scatter points in 2D/3D. Place k centroids randomly.
Animate the two-step loop: assign each point to nearest centroid (Voronoi coloring),
then move centroids to cluster means. Repeat until convergence. Slider for k.
Show how different initializations lead to different solutions. Scene 2:
**Hierarchical clustering** — build a dendrogram by iteratively merging nearest
clusters. Animate the merges as connections forming in 3D space.

### Regularization — Keeping Models Honest
Start from linear regression with many features (high-dimensional). Without
regularization, weights grow large and the model overfits. Slider for regularization
strength λ. L2 (Ridge): visualize the weight vector shrinking toward zero — the
constraint is a sphere in weight space, the solution is where the loss ellipse
touches the sphere. L1 (Lasso): the constraint is a diamond — solutions hit the
corners, driving some weights exactly to zero (feature selection). Show the
coefficient paths as λ increases: all weights shrink (Ridge) vs some hit zero (Lasso).

### Cross-Validation — Honest Model Evaluation
Why you can't test on training data. Scene 1: train a flexible model on all data —
perfect fit, terrible generalization. Scene 2: k-fold cross-validation — animate
the data being split into k colored folds. For each fold, highlight it as the test
set while the rest trains. Show k different test scores and their average. Slider
for k: at k=n it's leave-one-out. Show how the variance of the estimate decreases
with more folds. Connect to the bias-variance tradeoff.

### Attention & Transformers — What the Model Looks At
Scene 1: **Self-attention** — a sequence of token embeddings as colored vectors in
3D. For a selected query token, visualize attention weights as lines to all other
tokens — line thickness proportional to attention score. Animate the Q, K, V
projections: query and key vectors determine attention, value vectors get weighted
and summed. Slider selects different query positions. Scene 2: **Multi-head
attention** — show 4 heads simultaneously, each attending to different patterns
(one head tracks position, another syntax, another semantics). Scene 3: the full
transformer block — attention → add & norm → FFN → add & norm, as a flow diagram
with data shapes annotated at each stage.

### Embeddings — Meaning as Geometry
Words (or tokens) as points in high-dimensional space, projected to 3D. Show
classic relationships: king − man + woman ≈ queen as vector arithmetic in the
embedding space. Slider morphs between different projections (PCA axes). Cluster
by semantic similarity — colors reveal groupings the model learned. Scene 2:
positional embeddings — show how position information is encoded as sinusoidal
patterns added to token embeddings. Connect to the tokenization lesson: the
journey from text → tokens → embeddings → attention.

### Softmax, Logits & Temperature — From Scores to Probabilities
The bridge from raw model outputs to decisions. Scene 1: **Logits** — a bar chart
of raw unnormalized scores (one per class). They can be any real number — positive,
negative, huge, tiny. These are what the last layer of a neural network produces.
Scene 2: **Softmax** — apply softmax(zᵢ) = eᶻⁱ / Σeᶻʲ to convert logits to
probabilities that sum to 1. Animate the transformation: bars rescale, the tallest
logit gets the most probability but doesn't take all of it. Show how softmax
preserves ranking but makes differences more extreme. Scene 3: **Temperature** —
divide logits by T before softmax. Slider for T: at T→0 it becomes argmax (winner
takes all, "greedy"). At T=1 it's standard softmax. At T→∞ it approaches uniform
(maximum randomness). Animate the probability bars sharpening and flattening as T
changes. Connect to: entropy (high T = high entropy = uncertain), Boltzmann
distribution in physics (softmax IS the Boltzmann distribution), and LLM sampling
(temperature controls creativity vs determinism).

### Loss Functions — What the Model Optimizes
A gallery of loss functions as interactive surfaces. Scene 1: **MSE** — a smooth
parabolic bowl, easy to optimize. Scene 2: **Cross-entropy** — steeper near wrong
predictions, flatter near correct ones (why it trains faster than MSE for
classification). Scene 3: **Huber loss** — MSE near zero, linear in the tails
(robust to outliers). Slider adds outliers to the data; watch MSE loss explode
while Huber stays calm. Connect to gradient descent: the loss surface shape
determines how the optimizer behaves.

---

## 3. Language Models & NLP

*Prerequisite: [Byte Pair Encoding & Tokenization](#byte-pair-encoding--tokenization--how-llms-read-text) in the Probability & Statistics section covers how text becomes tokens — the first step in any language model pipeline.*

### N-grams — Predicting the Next Word by Counting
The simplest language model. Scene 1: **Bigrams** — given a corpus of text,
count how often each word follows each other word. Visualize as a transition
matrix (heatmap): rows are current words, columns are next words, cell intensity
= probability. Click any row to see the conditional distribution P(next|current).
Scene 2: **Trigrams** — condition on two previous words. The matrix becomes a
cube (3D tensor). Slice it: fix the first two words, see the distribution over
the third. Slider for context length n: at n=1 (unigram) it's just word
frequency; at n=2 (bigram) local structure appears; at n=3+ phrases emerge but
data gets sparse. Scene 3: **The sparsity problem** — as n grows, most n-grams
are never observed. Show the fraction of zero entries in the matrix growing
exponentially. This motivates smoothing techniques and ultimately neural
approaches.

### Perplexity — How Surprised Is the Model?
The standard metric for language models. Perplexity = 2^H where H is the
cross-entropy of the model on test data. Scene 1: a language model assigns
probabilities to each next word in a sequence. Show the probability bars at each
position — confident predictions (tall bars) vs uncertain ones (flat bars).
Perplexity is the geometric mean of 1/P(correct word). Slider for model quality:
a good model has low perplexity (not surprised), a bad model has high perplexity
(constantly surprised). Scene 2: connect to entropy — perplexity = 2^(entropy).
A model with perplexity 100 is as uncertain as choosing uniformly among 100 words.
Scene 3: compare models — n-gram vs neural LM perplexity on the same text.

### Word2Vec — Learning Word Vectors from Context
The idea that sparked modern NLP: words that appear in similar contexts have
similar meanings. Scene 1: **Skip-gram** — given a center word, predict the
surrounding context words. Visualize the input (one-hot vector), the embedding
matrix (lookup), and the output probabilities over the vocabulary. The embedding
matrix rows ARE the word vectors. Scene 2: **CBOW** — predict the center word
from context (the reverse). Scene 3: **Trained embeddings in 3D** — project
learned word vectors to 3D. Show analogies as vector arithmetic: king − man +
woman ≈ queen. Show clusters: countries group together, verbs group together.
Connect to the Embeddings lesson.

### The Transformer Architecture — From Input to Output
A complete walkthrough of one transformer forward pass, layer by layer.
Scene 1: **Input processing** — text → tokens (BPE, connect to tokenization
lesson) → token embeddings + positional embeddings → input vectors. Show the
embedding lookup as a matrix slice. Scene 2: **Self-attention layer** — project
inputs to Q, K, V matrices. Compute attention scores QKᵀ/√d as a heatmap.
Apply softmax (connect to softmax lesson). Multiply by V to get weighted outputs.
Scene 3: **Multi-head attention** — run several attention heads in parallel, each
learning different patterns. Concatenate and project. Scene 4: **Feed-forward
network** — two linear layers with ReLU, applied independently to each position.
Scene 5: **Layer norm & residual connections** — show the skip connection adding
the input back, then normalizing. Scene 6: **Stack it** — repeat N times. Show
how representations evolve from surface features (early layers) to abstract
meaning (deep layers).

### Autoregressive Generation — One Token at a Time
How LLMs actually generate text. Scene 1: the model sees a prompt, produces a
probability distribution over the next token. Sample one token (connect to
temperature/softmax). Append it to the input. Repeat. Animate the sequence
growing token by token, showing the probability distribution at each step.
Scene 2: **Sampling strategies** — greedy (always pick max), top-k (sample from
the k most likely), top-p/nucleus (sample from the smallest set that covers
probability p). Slider for k and p: show how the candidate set changes.
Scene 3: **Beam search** — maintain multiple candidate sequences simultaneously.
Visualize as a tree: branches are alternative continuations, width = beam size.
Prune low-scoring branches at each step.

### Positional Encoding — Teaching Order to Attention
Attention is permutation-invariant — it doesn't know word order. Positional
encodings inject position information. Scene 1: **Sinusoidal encoding** — each
position gets a vector of sin/cos waves at different frequencies. Render the
encoding matrix as a heatmap: rows are positions, columns are dimensions. The
pattern is like a binary counter in continuous space. Scene 2: show why it
works — the dot product between position encodings at positions i and j depends
only on (i−j), giving the model relative position information. Scene 3:
**Rotary Position Embeddings (RoPE)** — rotate the Q and K vectors by
position-dependent angles. Show the rotation in 2D subspaces: nearby tokens
have similar rotations, distant tokens have different ones.

### Training an LLM — The Big Picture
A conceptual overview tying everything together. Scene 1: **Pretraining** — next
token prediction on massive text. Show the loss curve decreasing over billions of
tokens. The model learns grammar, facts, reasoning patterns — all from
prediction. Scene 2: **Fine-tuning / RLHF** — adjust the pretrained model on
curated data with human preferences. Show the distribution shifting: some
behaviors get upweighted, others suppressed. Scene 3: **Scaling laws** — plot
loss vs model size, dataset size, and compute. The power law relationships that
drive the race to larger models. Scene 4: **Emergent abilities** — capabilities
that appear suddenly at scale (few-shot learning, chain-of-thought reasoning).
Show the step function in capability vs model size.

### Attention Patterns — What Heads Actually Learn
Visualize real attention patterns from trained models. Scene 1: **Positional
heads** — some heads attend to the previous token, or to a fixed relative offset.
Show the attention matrix as diagonal stripes. Scene 2: **Syntactic heads** —
some heads connect verbs to their subjects or adjectives to their nouns. Show
attention lines overlaid on parsed sentences. Scene 3: **Induction heads** —
the mechanism behind in-context learning. Head A copies a previous token to a
later position; Head B uses it to predict the next token after a repeated pattern.
Animate the two-step circuit.

---

## 4. Physics Domain Libraries

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

---

### Classical Mechanics — Lagrangian & Hamiltonian

#### The Principle of Least Action
The most beautiful idea in physics: nature chooses the path that minimizes (or
extremizes) the action S = ∫L dt, where L = T − V (kinetic minus potential energy).
Scene 1: a ball thrown in a gravitational field. Show the actual parabolic
trajectory and several alternative paths. For each path, compute the action
(shade the area under L(t)). The actual path has the smallest action. Slider
perturbs the path: any deviation increases S. Scene 2: **Euler-Lagrange equation**
— the condition δS = 0 yields the equation of motion. Show how the variational
principle produces F = ma. Scene 3: **Fermat's principle of least time** — light
takes the fastest path. Show refraction at an interface: Snell's law falls out from
minimizing travel time. Animate light paths bending at different angles; the fastest
one obeys Snell's law.

#### Lagrangian Mechanics — Generalized Coordinates
Scene 1: a simple pendulum. In Cartesian coordinates the constraint (fixed length)
makes things messy. In the angle θ, the Lagrangian L = ½ml²θ̇² − mgl(1−cos θ) is
simple. Derive the equation of motion from the Euler-Lagrange equation. Animate
the pendulum; show L, T, and V as time-varying curves. Scene 2: **Double pendulum**
— two coupled angles, chaotic motion. Show the Lagrangian with both generalized
coordinates. Two initial conditions starting ε apart: animate the exponential
divergence. Scene 3: **Noether's theorem** — every symmetry gives a conservation
law. Time symmetry → energy conservation. Rotational symmetry → angular momentum
conservation. Show the conserved quantity staying constant as the system evolves.

#### Hamiltonian Mechanics — Phase Space
Scene 1: convert from Lagrangian to Hamiltonian via the Legendre transform.
H = T + V (total energy) for conservative systems. The equations of motion become
first-order: q̇ = ∂H/∂p, ṗ = −∂H/∂q. Scene 2: **Phase space** — plot position
vs momentum. A simple harmonic oscillator traces ellipses in phase space. Energy
contours are level curves of H. Animate trajectories: they never cross (uniqueness
of solutions). Scene 3: **Liouville's theorem** — phase space volume is conserved.
Animate a cloud of initial conditions: the cloud deforms but its area stays
constant. This is the classical root of quantum uncertainty and statistical
mechanics.

#### Path Integrals — Feynman's Sum Over Histories
The quantum version of least action. Scene 1: in classical mechanics, a particle
takes ONE path (the least action path). In quantum mechanics, it takes ALL paths
simultaneously. Render many paths from A to B — each path contributes a phase
e^(iS/ℏ). Animate the phases as rotating arrows (phasors). Scene 2: **Stationary
phase** — paths near the classical path have similar phases and add constructively.
Far-away paths have wildly different phases and cancel out. Show the cancellation:
arrows point in random directions and sum to zero. The classical path emerges as
the surviving contribution. Slider for ℏ: as ℏ → 0, only the classical path
survives (classical limit). At finite ℏ, nearby paths contribute (quantum
corrections). Scene 3: **Double slit revisited** — sum over two families of paths
(through each slit). The interference pattern IS the path integral. Connect to
the wave mechanics lesson in quantum.

---

## 4. Linear Algebra

### Vectors — Direction, Magnitude & Operations
Start with a single vector in 2D/3D. Show its components as projections onto axes.
Add a second vector — animate addition (tip-to-tail), subtraction, and scalar
multiplication. Sliders for each component. Show how the parallelogram law makes
addition commutative. Scene 2: dot product as projection — one vector's shadow on
another. The cosine formula falls out geometrically. Scene 3: cross product — the
perpendicular vector whose magnitude equals the parallelogram area. Animate the
right-hand rule.

### Linear Transformations — Matrices as Motion
The core visual insight: a 2×2 matrix IS a transformation of the plane. Start with
the unit square and a grid of points. Apply a matrix — watch the grid deform.
Sliders for each matrix entry. Categorize the zoo of transformations: rotation
(orthogonal), scaling (diagonal), shear (triangular), reflection (det < 0),
projection (singular). Scene 2: composition — apply two matrices sequentially,
show that the result equals their product. Matrix multiplication is function
composition.

### Determinant — The Volume Scaling Factor
The determinant measures how much a transformation scales area (2D) or volume (3D).
Start with the unit square; apply a matrix; shade the transformed parallelogram.
Its area = |det(A)|. Slider morphs the matrix: when det → 0 the parallelogram
collapses to a line (singular). When det < 0 the orientation flips (the grid
becomes a mirror image). Scene 2: 3D — the unit cube transforms to a parallelepiped.
Volume = |det(A)|. Show how row operations change the determinant.

### Eigenvalues & Eigenvectors — Vectors That Don't Turn
Apply a matrix to many vectors — most change direction. But eigenvectors only
stretch or shrink (scale by λ). Animate the transformation: all vectors rotate
except the eigenvectors, which stay on their lines. Sliders for matrix entries;
eigenvalues and eigenvectors update in real time. Scene 2: the characteristic
polynomial det(A − λI) = 0 as a curve — eigenvalues are its roots. Scene 3:
complex eigenvalues — the eigenvectors become spiral motions (rotation + scaling).

### Singular Value Decomposition — Rotate, Stretch, Rotate
Any matrix = UΣVᵀ. Animate the decomposition as three steps: first rotation (Vᵀ
aligns the input), then scaling along axes (Σ stretches), then final rotation (U
orients the output). Show the unit circle transforming through each step. Sliders
for singular values. Scene 2: low-rank approximation — keep only the top k singular
values, watch the transformation simplify. Apply to image compression: show a
photo at rank 1, 5, 20, full rank.

### Change of Basis — Same Vector, Different Coordinates
A vector doesn't change — only its description changes when you switch basis.
Show the same vector in the standard basis and a rotated basis simultaneously.
Sliders rotate the new basis; the coordinates update while the arrow stays fixed.
Scene 2: diagonalization — find the eigenvector basis where the transformation
is just scaling. The complicated matrix becomes diagonal in the right coordinates.

### Null Space, Column Space & Row Space
Visualize the four fundamental subspaces of a matrix. Scene 1: column space —
the set of all possible outputs Ax. For a 3×2 matrix, it's a plane through the
origin in ℝ³. Scene 2: null space — the set of inputs x where Ax = 0. It's the
"blind spot" of the transformation. Animate a vector sweeping through the null
space — all map to zero. Scene 3: rank-nullity theorem — dim(col space) +
dim(null space) = number of columns. Show the tradeoff: as the column space
shrinks, the null space grows.

### Systems of Linear Equations — Geometry of Solutions
Ax = b as intersecting planes. Scene 1: two equations in 2D — two lines
intersecting at a point (unique solution), parallel (no solution), or coincident
(infinite solutions). Scene 2: three equations in 3D — three planes intersecting
at a point, along a line, or not at all. Slider perturbs one equation: watch the
solution point move, then disappear when the system becomes inconsistent.
Scene 3: Gaussian elimination as geometric operations — each row operation tilts
a plane until the system is in echelon form.

### Orthogonality & Gram-Schmidt — Building Perpendicular Bases
Start with two non-orthogonal vectors. Gram-Schmidt step 1: keep v₁. Step 2:
subtract v₂'s projection onto v₁ — animate the projection being peeled off,
leaving the perpendicular component. The result is an orthogonal basis. Extend to
3 vectors in 3D: each step removes all components along previously orthogonalized
vectors. Show the QR decomposition emerging: Q = orthogonal basis, R = the
projection coefficients.

### Least Squares — The Best Wrong Answer
When Ax = b has no exact solution (overdetermined system), find the closest one.
Scatter points that don't lie on any line. The least squares solution minimizes
the sum of squared residuals. Visualize: the residual vector b − Ax̂ is
perpendicular to the column space of A. Animate the projection: b projects onto
the column space, and x̂ is the coordinates of that projection. Connect to linear
regression.

---

## 5. Calculus

### Limits & Continuity — Approaching a Value
Scene 1: a function with a hole at x = a. Animate a point sliding along the curve
toward a from both sides. The y-values converge to L even though f(a) may not
exist. Slider for ε draws a horizontal band around L; the corresponding δ band
on x appears — making the ε-δ definition visual. Scene 2: discontinuities —
jump, removable, and essential. Show what goes wrong at each: the left and right
limits disagree, or the limit doesn't exist at all.

### Derivatives — The Slope of Now
Scene 1: a curve f(x). Draw a secant line through two points. Slider brings the
second point closer to the first — the secant rotates toward the tangent line.
The difference quotient Δy/Δx converges to f'(x). Scene 2: show f(x) and f'(x)
simultaneously — when f is increasing, f' > 0; at maxima/minima, f' = 0; at
inflection points, f'' = 0. Slider moves x; both curves highlight the
corresponding point.

### Differentiation Rules — The Algebra of Derivatives
Scene 1: **Power rule** — animate d/dx(xⁿ) = nxⁿ⁻¹. Slider for n: show the
original curve and its derivative side by side. The derivative's degree drops by
one. Scene 2: **Product rule** — visualize (fg)' = f'g + fg' as areas. f and g
are the sides of a rectangle; the derivative is the rate of area change, which
comes from stretching each side independently. Scene 3: **Quotient rule** —
derive from the product rule visually. Scene 4: **Chain rule** — the key to
deep learning. f(g(x)): first g maps x to an intermediate value, then f maps
that to the output. The derivative multiplies the stretching at each stage.
Animate zooming into each stage: the local slope of g times the local slope of f.
Connect to backpropagation.

### Higher-Order Derivatives — Curvature & Acceleration
Scene 1: f(x), f'(x), and f''(x) displayed simultaneously. f' is velocity
(slope), f'' is acceleration (how the slope changes). At inflection points f'' = 0
— the curvature switches sign. Scene 2: **Curvature κ** — the osculating circle
at each point. Its radius = 1/κ. Slider moves along the curve: where the curve
bends sharply, the circle is small (high curvature). Where it's nearly straight,
the circle is huge. Scene 3: **Taylor's theorem revisited** — f'' determines the
quadratic correction to the linear approximation. Show the tangent line (1st
order), parabola (2nd order), and cubic (3rd order) stacking up.

### Implicit Differentiation — Curves Without y = f(x)
Not every curve can be written as y = f(x). Scene 1: the unit circle
x² + y² = 1. At any point, dy/dx = −x/y — differentiate both sides, solve for
dy/dx. Animate a point traveling the circle; the tangent line rotates, and
dy/dx blows up at the top and bottom (vertical tangents). Scene 2: more exotic
implicit curves — the folium of Descartes x³ + y³ = 3xy, lemniscate, cardioid.
Show how implicit differentiation finds the slope at every point, even where the
curve crosses itself.

### Related Rates — Everything Changes Together
Scene 1: a ladder sliding down a wall. The bottom slides out at a constant rate
— how fast does the top slide down? Show the triangle in real time: slider controls
dx/dt, the ladder length is fixed (constraint), and dy/dt is computed via
implicit differentiation of x² + y² = L². The top accelerates as it approaches
the ground. Scene 2: expanding balloon — radius grows, surface area and volume
grow faster. Show all three rates simultaneously. Scene 3: shadow problems — a
person walks away from a lamppost; animate the shadow lengthening with
similar triangles providing the constraint.

### Parametric Derivatives — Curves in Disguise
Scene 1: a parametric curve (x(t), y(t)). The parameter t is time — a point
traces the curve as t increases. The velocity vector (x'(t), y'(t)) is tangent
to the curve at every point. Show it as an arrow moving with the point.
dy/dx = (dy/dt)/(dx/dt) — the slope is the ratio of vertical to horizontal
speed. Scene 2: **Speed vs velocity** — speed |v| = √(x'² + y'²) is the
magnitude. The point moves fast where the velocity arrow is long, slow where
it's short. Scene 3: **Parametric acceleration** — the acceleration vector
(x''(t), y''(t)) points toward the center of curvature. Decompose into tangential
(speeding up/slowing down) and normal (turning) components. Scene 4: **Arc
length** — integrate speed: L = ∫|v| dt. Animate the arc length accumulating as
the point travels.

### Polar Derivatives — Rates of Change in r and θ
Scene 1: a polar curve r = f(θ). A point traces the curve as θ increases.
dr/dθ measures how fast the distance from the origin changes per radian of sweep.
Show dr/dθ as the radial component of the velocity. Scene 2: **Slope in polar
coordinates** — dy/dx in terms of r and θ. Not simply dr/dθ! Convert to
Cartesian: x = r cos θ, y = r sin θ, then differentiate parametrically. Show the
tangent line at each point of a cardioid or rose curve. Scene 3: **Area in polar
coordinates** — dA = ½r² dθ. Animate the area sweeping out sector by sector.
Compare with Cartesian area (rectangles vs pie slices).

### Partial Derivatives — Slopes in Multiple Directions
Scene 1: a surface z = f(x, y) in 3D. Slice it with a plane parallel to xz
(fixing y) — the cross-section is a curve, and its slope is ∂f/∂x. Slice with
a plane parallel to yz — that slope is ∂f/∂y. Animate the slicing planes
sweeping across the surface. Scene 2: **The gradient vector** ∇f = (∂f/∂x,
∂f/∂y) points uphill on the surface. Show gradient arrows at every point on a
contour plot — they're always perpendicular to level curves. Drop a ball — it
follows the negative gradient downhill (connect to gradient descent in ML).

### The Total Derivative — How Everything Changes at Once
Scene 1: for f(x, y) along a path (x(t), y(t)), the total derivative
df/dt = (∂f/∂x)(dx/dt) + (∂f/∂y)(dy/dt). Animate a point moving along a path
on the surface; show the contributions from each partial derivative separately
as colored arrows, then their sum as the actual rate of change. Scene 2: **The
Jacobian matrix** — for a vector-valued function F: ℝ² → ℝ², the Jacobian is
the matrix of all partial derivatives. Visualize as a local linear map: zoom
into a small region, the Jacobian transforms tiny circles into ellipses. The
determinant of the Jacobian = local area scaling (connect to the determinant
lesson in linear algebra).

### Directional Derivatives — Slopes in Any Direction
Scene 1: at a point on a surface, pick any direction (angle slider θ). The
directional derivative D_u f is the slope in that direction — a slice at angle θ.
Rotate θ through 360°: the directional derivative varies sinusoidally. It's
maximized in the gradient direction and zero perpendicular to it. Scene 2: show
the "derivative in every direction" as a polar plot centered at the point. The
shape is always an ellipse (for smooth functions) — its major axis points along
the gradient.

### The Hessian — Curvature of Surfaces
Scene 1: the matrix of second partial derivatives. For f(x, y), the Hessian is
2×2: [[f_xx, f_xy], [f_xy, f_yy]]. At a critical point (where ∇f = 0), the
Hessian determines the shape: both eigenvalues positive → local minimum (bowl),
both negative → local maximum (dome), opposite signs → saddle point. Animate
a surface morphing through all three cases. Scene 2: **Second derivative test**
— compute det(H) and f_xx to classify. Show the eigenvalues of the Hessian
as the principal curvatures — the surface curves at different rates in different
directions. Connect to optimization in ML: the Hessian determines whether a
critical point is a minimum or a saddle.

### Optimization — Finding Extrema
Scene 1: **Single variable** — find maxima and minima of f(x). First derivative
= 0 gives candidates. Second derivative classifies them. Animate: the tangent
line sweeps along the curve, pausing where it's horizontal. Scene 2:
**Multivariable unconstrained** — find the minimum of f(x, y). The gradient
points uphill; follow it downhill. Show gradient descent on a 3D surface with
contour lines. Scene 3: **Constrained optimization & Lagrange multipliers** —
minimize f(x, y) subject to g(x, y) = 0. The constraint is a curve on the
surface. The solution is where the constraint curve is tangent to a level curve
of f — where ∇f = λ∇g. Animate ∇f and ∇g as arrows: at the optimum they're
parallel.

### Integrals — Accumulated Area
Scene 1: Riemann sums. Rectangle bars approximate the area under f(x). Slider
for n (number of rectangles): at n=4 it's rough, at n=100 it's smooth, at n→∞
it's the integral. Show left, right, and midpoint sums converging. Scene 2: the
Fundamental Theorem — the integral function F(x) = ∫f(t)dt is the antiderivative.
Animate the area accumulating as x slides right; the height of F(x) tracks the
accumulated area. Scene 3: signed area — when f < 0, the integral subtracts.
Show cancellation between positive and negative regions.

### Integration Techniques — Tools of the Trade
Scene 1: **Substitution (u-sub)** — change variables to simplify. Show the
original integral as an area, apply the substitution as a coordinate stretch,
show the transformed (simpler) integral has the same area. Scene 2:
**Integration by parts** — ∫u dv = uv − ∫v du. Visualize as a rectangle:
the area under one function relates to the area under another via the
rectangle's geometry. Scene 3: **Partial fractions** — decompose a rational
function into simpler pieces. Show the original curve as the sum of simpler
curves, each easy to integrate.

### Multiple Integrals — Volume & Beyond
Scene 1: **Double integrals** — integrate f(x, y) over a region R. Visualize
as the volume under the surface above R. Show the iterated integral: first
integrate along x (stacking slices), then along y (stacking the slices).
Animate the slicing. Scene 2: **Change of variables** — polar, cylindrical,
spherical. Show how the integration region simplifies: a circle in Cartesian is
ugly, but in polar it's just r ≤ R. The Jacobian determinant (r for polar,
r² sin φ for spherical) scales the area element. Scene 3: **Triple integrals**
— volume of a 3D region. Animate the integration as nested slicing.

### Taylor Series — Polynomial Doppelgängers
Approximate any smooth function with polynomials. Start with f(x) = eˣ at x = 0.
Add terms one by one: constant (degree 0), linear (degree 1), quadratic (degree 2).
Slider for degree n: watch the polynomial hug the function over a wider interval
as n grows. Show the error region shrinking. Scene 2: functions with finite radius
of convergence — 1/(1−x) diverges at x = 1; the polynomials approximate well
inside the radius but go wild outside. Scene 3: Fourier series as the trig
version — approximate a square wave with sines. The Gibbs phenomenon: the
overshoot at discontinuities never goes away.

### Vector Calculus — Div, Grad, Curl
Scene 1: **Gradient** — a scalar field f(x,y) as a height surface. The gradient
∇f at each point is an arrow pointing uphill. Scene 2: **Divergence** — a 2D
vector field. Positive divergence = arrows spread out (source); negative = arrows
converge (sink). Animate tiny circles expanding or contracting to show divergence.
Scene 3: **Curl** — a 2D vector field with rotation. Place a tiny paddlewheel at
each point — it spins where curl is nonzero. Scene 4: connect them — gradient
feeds into divergence (Laplacian), curl of gradient is always zero.

### Stokes' & Green's & Gauss's Theorems — The Big Unifiers
The three theorems that connect local derivatives to global integrals. Scene 1:
**Green's theorem** — the circulation of a vector field around a closed curve
equals the double integral of curl over the enclosed region. Animate: show the
tiny paddlewheels inside the region; their net spin = the total circulation
around the boundary. Scene 2: **Stokes' theorem** — generalization to 3D
surfaces. The circulation around the boundary curve of a surface = the flux of
curl through the surface. Scene 3: **Gauss's divergence theorem** — the net flux
out of a closed surface = the triple integral of divergence inside. Animate
arrows piercing the surface; their net outflow equals the total source strength
inside.

### Line & Surface Integrals — Adding Up Along Paths
Scene 1: a vector field with a curve through it. The line integral ∫F·dr sums
the component of F along the path. Animate a particle traveling the curve; at each
point show the dot product of F and the tangent vector. Slider bends the path —
the integral changes (path-dependent) unless the field is conservative.
Scene 2: surface integrals — flux through a surface. Show vectors piercing a
mesh; the integral counts the net flow through.

---

## 6. Differential Equations

### First-Order ODEs — Slope Fields & Solution Curves
The slope field shows y' = f(x, y) as tiny line segments at every point. Drop an
initial condition (draggable point) — the solution curve threads through the
segments. Multiple initial conditions show the family of solutions. Slider changes
a parameter in f: the entire slope field and all solution curves update.
Scene 2: Euler's method — step along the slope field with finite steps. Slider for
step size h: large h → the numerical solution drifts from the true curve. Small h
→ convergence. Show the error accumulating.

### Phase Portraits — 2D Systems
Two coupled ODEs dx/dt = f(x,y), dy/dt = g(x,y). The phase portrait shows
trajectories in the (x, y) plane. Classify fixed points by eigenvalues of the
Jacobian: stable node (spiraling in), unstable node (spiraling out), saddle point
(attracts along one axis, repels along another), center (closed orbits). Sliders
for system parameters: watch the fixed point bifurcate — a stable node splits
into a saddle and an unstable node.

### Numerical Methods — Euler, RK2, RK4
Compare numerical ODE solvers side by side on the same initial value problem.
Euler (1st order) takes tangent-line steps — visible error accumulates. RK2
(midpoint method) corrects once — much better. RK4 (the workhorse) corrects four
times per step — nearly exact. Animate all three simultaneously with the same
step size. Slider for h: at large h only RK4 survives. Show order of convergence:
halving h reduces Euler error by 2×, RK2 by 4×, RK4 by 16×.

### Chaos & The Lorenz Attractor
The most famous chaotic system. Render the Lorenz butterfly in 3D — a trajectory
that never repeats, spiraling between two lobes. Two initial conditions starting
ε apart: animate them together, then diverging exponentially (sensitive dependence).
Sliders for σ, ρ, β: at ρ < 24.74 the system settles to fixed points; above it,
chaos emerges. Show the bifurcation diagram: plot long-term behavior vs ρ.
Connect to weather prediction: why forecasts degrade.

### Harmonic Oscillators — Springs, Pendulums & Resonance
Scene 1: **Simple harmonic motion** — a mass on a spring. Position x(t) = A cos(ωt).
Show the phase portrait as an ellipse in (x, ẋ) space. Sliders for amplitude and
frequency. Scene 2: **Damped oscillator** — add friction. The phase portrait spirals
inward. Slider for damping coefficient: underdamped (oscillates and decays),
critically damped (fastest return), overdamped (sluggish return). Scene 3:
**Driven oscillator** — add a periodic forcing term. Slider for driving frequency:
at resonance (driving = natural frequency) the amplitude explodes.
Show the frequency response curve.

### Bifurcations — When Systems Change Character
A single parameter controls qualitative behavior. Scene 1: **Saddle-node** — two
fixed points collide and annihilate as a parameter crosses a critical value.
Animate the phase line: two equilibria merge into none. Scene 2: **Pitchfork** —
one stable fixed point splits into two stable and one unstable (symmetry breaking).
Scene 3: **Hopf** — a stable fixed point loses stability and births a limit cycle
(steady state → oscillation). The logistic map bifurcation diagram: period
doubling cascade into chaos.

### The Heat Equation — Diffusion in Action
The prototypical PDE: ∂u/∂t = α ∂²u/∂x². Scene 1: start with a sharp temperature
spike (delta-like initial condition) on a 1D rod. Animate the solution: the spike
spreads out into a Gaussian that widens and flattens over time. Slider for
diffusivity α: higher = faster spreading. Scene 2: **2D heat diffusion** — a hot
spot on a plate. Render temperature as a 3D surface (height = temperature) or
heatmap. Watch it smooth out radially. Scene 3: **Connection to random walks** —
overlay a Monte Carlo simulation: release 1000 random walkers from the hot spot.
Their density distribution converges to the heat equation solution. Diffusion IS
random walks at scale. Scene 4: **Steady state** — when ∂u/∂t = 0, the heat
equation becomes Laplace's equation ∇²u = 0. Show the solution as a minimal
surface stretched between boundary conditions.

### Wave Equation — Propagation & Interference
∂²u/∂t² = c² ∂²u/∂x². Scene 1: pluck a string (initial displacement, zero
velocity). Animate the wave splitting into two pulses traveling in opposite
directions. Slider for wave speed c. Scene 2: **Standing waves** — fixed
boundary conditions (string tied at both ends). Only certain frequencies fit —
show the fundamental and first few harmonics. Connect to Fourier series: any
initial shape decomposes into these modes. Scene 3: **2D wave equation** — a
vibrating membrane. Render as a 3D surface. Drop a pebble (point impulse) and
watch circular waves propagate and reflect off boundaries. Scene 4:
**Interference** — two sources producing circular waves. Show constructive and
destructive interference patterns. Connect to the double-slit experiment in
quantum mechanics.

### Reaction-Diffusion — Patterns from Math
Turing patterns: two chemicals diffusing at different rates spontaneously form
spots, stripes, and spirals. Scene 1: start with a uniform mixture plus tiny
random perturbations. Animate the Gray-Scott or FitzHugh-Nagumo equations: watch
patterns emerge from noise. Sliders for feed rate and kill rate — different
parameter regimes produce spots, worms, or waves. Scene 2: connect to biology —
these equations model animal coat patterns (leopard spots, zebra stripes), coral
growth, and chemical oscillations. The math behind biological self-organization.

---

## 7. Complex Analysis

### Complex Numbers — Algebra Meets Geometry
Scene 1: the complex plane. A complex number z = a + bi is a point (or arrow).
Show addition as vector addition, multiplication as rotation + scaling. Slider for
a multiplier w: multiplying by w rotates by arg(w) and scales by |w|. Scene 2:
Euler's formula e^(iθ) = cos θ + i sin θ — a point traveling the unit circle.
Show how eⁱᵖ = −1 falls out. Scene 3: roots of unity — the n-th roots of 1 are
equally spaced on the unit circle. Slider for n.

### Conformal Mappings — Grids That Bend
Apply a complex function f(z) to a grid and watch it warp. Scene 1: f(z) = z² —
the grid folds over itself; right angles are preserved (conformal) but areas are
not. Scene 2: f(z) = eᶻ — horizontal lines become circles, vertical lines become
rays. Scene 3: f(z) = 1/z — inversion; circles and lines interchange. Animate
the deformation continuously: slider morphs from z to f(z). Show how conformal
maps preserve angles at every point.

### Riemann Surfaces — Multi-Valued Functions Made Single
f(z) = √z is two-valued — but on a Riemann surface, it's single-valued on a
double-sheeted surface. Render the two sheets in 3D, connected at the branch cut.
A path circling the origin crosses from one sheet to the other. Scene 2: f(z) = log(z)
— infinitely many sheets spiraling upward. Scene 3: analytic continuation —
extend a function beyond its original domain by hopping between sheets.

### Complex Integration & Residues
Scene 1: integrate f(z) along a path in the complex plane. The integral is a
complex number — show its real and imaginary parts accumulating along the path.
Scene 2: Cauchy's theorem — if the path encloses no singularities, the integral
is zero. Deform the path continuously; the integral stays constant. Scene 3:
residues — a pole inside the contour contributes 2πi times its residue. Animate
the contour shrinking around the pole.

---

## 8. Signal Processing

### Fourier Transform — Decomposing Signals into Frequencies
Scene 1: a compound wave (sum of sinusoids). Slider adds/removes frequency
components. Show the time-domain waveform and frequency-domain spectrum
simultaneously. Scene 2: the DFT as matrix multiplication — the Fourier matrix
applied to a signal vector. Each row is a different frequency's sinusoid;
the dot product measures how much of that frequency is present. Animate the
decomposition: peel off one frequency at a time from the signal until only
the residual remains.

### Convolution — The Sliding Integral
Scene 1: two functions f and g. Flip g, slide it across f, and at each position
compute the overlap integral. The output (f * g)(t) builds up as g slides.
Animate the sliding; shade the overlap area. Scene 2: convolution in the frequency
domain — multiplication! Show both domains side by side: convolving in time =
multiplying spectra. This is why FFT makes convolution fast. Scene 3: apply to
audio — convolve a signal with an impulse response (reverb). Hear the result.

### Filtering — Shaping the Spectrum
Scene 1: a signal with noise (high-frequency components). Apply a low-pass filter:
in the frequency domain, zero out high frequencies. Show the cleaned signal in
time domain. Slider for cutoff frequency. Scene 2: high-pass filter (keep only
high frequencies — edge detection). Scene 3: band-pass filter (keep a range).
Show the filter's frequency response curve (gain vs frequency) alongside the
signal's spectrum — the output spectrum is the product.

### Sampling & Aliasing — The Nyquist Limit
Scene 1: a continuous sinusoid sampled at discrete points. Slider for sampling
rate. When the rate is above 2× the signal frequency (Nyquist rate), the samples
faithfully represent the signal. Below it, aliasing: a completely different
lower-frequency sinusoid fits the same samples. Animate both the true signal and
the alias simultaneously. Scene 2: the sampling theorem in the frequency domain —
sampling creates spectral copies; if they overlap, information is lost (aliasing).

### Spectrogram — Time Meets Frequency
A 2D heatmap with time on the x-axis, frequency on the y-axis, and intensity as
color. Apply the Short-Time Fourier Transform (STFT) to a signal whose frequency
changes over time (chirp, speech, music). Slider for window size: short window =
good time resolution, poor frequency resolution. Long window = the opposite.
This is the uncertainty principle of signal processing — you can't have both.
Connect to Heisenberg's uncertainty principle in quantum mechanics.

---

## 9. Game Theory

### Payoff Matrices & Dominant Strategies
Scene 1: a 2×2 payoff matrix for two players. Each cell shows both players'
payoffs as a pair. Highlight dominant strategies (if they exist): a strategy that's
best regardless of what the opponent does. Scene 2: the prisoner's dilemma —
both players have a dominant strategy (defect), but mutual cooperation pays more.
The Nash equilibrium is inefficient. Sliders adjust payoffs: explore when
cooperation becomes dominant.

### Nash Equilibrium — Nobody Wants to Move
Scene 1: mixed strategy equilibrium. Player 1 randomizes with probability p,
Player 2 with probability q. Plot both players' expected payoffs as surfaces
over (p, q) space. The Nash equilibrium is the saddle point where neither player
can improve by changing strategy. Animate best-response dynamics: each player
adjusts toward their best response; the system spirals toward equilibrium.
Scene 2: multiple equilibria — a coordination game (Battle of the Sexes) with
two pure and one mixed Nash equilibrium. Show all three as fixed points.

### Iterated Prisoner's Dilemma — Strategy Evolution
Simulate a population of strategies playing repeated rounds. Start with a mix:
Always Cooperate, Always Defect, Tit-for-Tat, Random. Animate rounds: payoffs
accumulate, strategies reproduce proportionally to fitness. Watch Tit-for-Tat
dominate (Axelrod's tournament result). Slider for noise (probability of accidental
defection): Tit-for-Tat degrades; forgiving strategies rise. Show the evolutionary
dynamics as a flow on the strategy simplex.

### Auction Theory — Bidding Strategies
Scene 1: first-price sealed-bid auction. Each bidder has a private value (slider).
The optimal bid is below your value — bid your value and you win but gain nothing.
Animate the tradeoff: higher bid = more likely to win but lower surplus. Show the
Nash equilibrium bidding function. Scene 2: second-price (Vickrey) auction —
bidding your true value IS the dominant strategy. Show why: no matter what others
bid, truthful bidding maximizes your expected payoff. Scene 3: compare revenue
equivalence — both auctions yield the same expected revenue to the seller.

### Evolutionary Game Theory — Population Dynamics
Replicator dynamics on a 2D simplex (three strategies). Each vertex is a pure
strategy; interior points are mixed populations. Arrows show population flow:
strategies with above-average fitness grow, below-average shrink. Fixed points
are Nash equilibria. Animate trajectories from different starting populations.
Classic games: Rock-Paper-Scissors (cycling orbits, no stable equilibrium),
Hawk-Dove (stable mixed equilibrium), Stag Hunt (two stable equilibria with
basins of attraction).

---

## 10. Theory of Computation

### Finite Automata — Machines That Read
Scene 1: **Deterministic Finite Automaton (DFA)** — states as nodes, transitions
as directed edges labeled with input symbols. Animate processing a string:
a glowing token hops from state to state as each character is consumed. Accept
state glows green; reject state glows red. Slider steps through the input
character by character. Scene 2: **Nondeterministic Finite Automaton (NFA)** —
the token splits at nondeterministic branches, exploring all paths simultaneously.
If ANY path reaches an accept state, the string is accepted. Show the branching
tree of states. Scene 3: **NFA → DFA conversion** (subset construction) —
animate each DFA state as a set of NFA states. The DFA can be exponentially
larger, but it always exists. Connect to regular expressions: every regex
compiles to an NFA.

### Regular Expressions — Pattern Matching as Machines
Scene 1: a regex pattern and its equivalent NFA side by side. Type a test string
— the NFA animates processing it. Highlight matching substrings. Scene 2: build
up regex operations visually — **concatenation** (chain two automata),
**alternation** (fork into two paths), **Kleene star** (add a loop-back edge).
Each operation transforms the automaton graph. Scene 3: **The pumping lemma** —
show why some languages aren't regular. Animate: if a string is long enough,
it must loop through a state. That loop can be repeated (pumped) — if pumping
breaks membership, the language isn't regular. Visualize with aⁿbⁿ: the
automaton can't count.

### Pushdown Automata — Machines with Memory
Scene 1: a PDA — like a DFA but with a stack. Animate stack operations: push
symbols on transitions, pop to match. Process a string like aⁿbⁿ: push a's,
then pop for each b. If the stack empties exactly when the string ends → accept.
Show the stack growing and shrinking alongside state transitions. Scene 2:
**Context-free grammars** — parse trees for arithmetic expressions. The grammar
generates the language; the PDA recognizes it. Show both representations for the
same string. Scene 3: limitations — the pumping lemma for CFLs. aⁿbⁿcⁿ can't
be parsed by any PDA.

### Turing Machines — Universal Computation
Scene 1: the classic Turing machine — an infinite tape, a head that reads/writes
and moves left/right, a finite state controller. Animate processing: the head
scans, writes, moves, changes state. Show a simple computation: binary increment
or palindrome check. The tape contents and head position update at each step.
Scene 2: **Universality** — a Turing machine that simulates other Turing machines.
The input tape encodes both the program and the data. This is the foundation of
stored-program computers. Scene 3: **Church-Turing thesis** — anything
"computable" can be computed by a Turing machine. Show equivalent models: lambda
calculus, register machines, cellular automata — all simulate each other.

### The Halting Problem — The Limits of Computation
Scene 1: pose the question — can a program analyze another program and decide
whether it will halt or loop forever? Scene 2: **The diagonal argument** —
assume a halting oracle H exists. Construct a program D that calls H on itself
and does the opposite. If H says D halts, D loops. If H says D loops, D halts.
Contradiction. Animate the self-referential paradox as a flowchart that folds
back on itself. Scene 3: **Consequences** — undecidable problems are everywhere.
Can a program determine if two programs produce the same output? (No — Rice's
theorem.) Can a compiler determine if code has a bug? (Not in general.)

### Computational Complexity — P, NP & Beyond
Scene 1: **P** — problems solvable in polynomial time. Animate sorting (O(n log n))
and searching (O(log n)) — fast algorithms, the time bar stays manageable as input
grows. Scene 2: **NP** — problems where solutions are verifiable in polynomial time
but (maybe) not findable. Show SAT: given a boolean formula, try assignments
(exponential search) but verify a solution instantly. Scene 3: **NP-completeness**
— show reductions as transformations. A graph coloring problem transforms into a
SAT problem: if you can solve one, you can solve the other. Animate the reduction.
Scene 4: **P vs NP** — the million-dollar question. Show the Venn diagram of
complexity classes. If P = NP, every easily verifiable problem is easily solvable.
Slider for input size: polynomial vs exponential growth rates diverge dramatically.

### Lambda Calculus — Computation Without Machines
Scene 1: **Lambda expressions** — functions as first-class objects.
λx.x is identity, λx.λy.x selects the first argument. Animate β-reduction:
(λx.body)(arg) replaces x with arg in body. Step through reductions one at a time.
Scene 2: **Church numerals** — represent numbers as functions. 0 = λf.λx.x,
1 = λf.λx.f(x), 2 = λf.λx.f(f(x)). Addition and multiplication are function
compositions. Animate: applying the "3" function three times. Scene 3: **The
Y-combinator** — recursion without naming. Show how a lambda expression can call
itself through self-application. Animate the fixed-point unfolding: each step
peels off one layer of recursion.

### Cellular Automata — Simple Rules, Complex Behavior
Scene 1: **1D elementary automata** — a row of cells, each black or white. A
3-bit rule determines the next generation. Show all 256 rules; slider selects
one. Rule 110 produces complex, seemingly random patterns from a single black
cell — and it's Turing complete. Scene 2: **Conway's Game of Life** — 2D grid
with birth/survival/death rules. Start from classic patterns: gliders, oscillators,
glider guns. Animate generations. Show how simple local rules produce global
structure — spaceships, logic gates, even universal computation. Scene 3:
**Connection to computation** — a glider gun IS a clock signal. Glider collisions
implement logic gates. Life can simulate a Turing machine — and therefore compute
anything.
