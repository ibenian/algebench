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

### Loss Functions — What the Model Optimizes
A gallery of loss functions as interactive surfaces. Scene 1: **MSE** — a smooth
parabolic bowl, easy to optimize. Scene 2: **Cross-entropy** — steeper near wrong
predictions, flatter near correct ones (why it trains faster than MSE for
classification). Scene 3: **Huber loss** — MSE near zero, linear in the tails
(robust to outliers). Slider adds outliers to the data; watch MSE loss explode
while Huber stays calm. Connect to gradient descent: the loss surface shape
determines how the optimizer behaves.

---

## 3. Physics Domain Libraries

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
