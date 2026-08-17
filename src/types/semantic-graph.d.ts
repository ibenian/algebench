/* eslint-disable */
/**
 * GENERATED FILE — DO NOT EDIT BY HAND.
 *
 * Source:    schemas/semantic-graph.schema.json
 * Generator: scripts/generate_ts_types.mjs
 * Regenerate: npm run types:generate
 *
 * Edit the schema, then regenerate. CI fails if this file is out of date.
 */

/**
 * The semantic role of the node. ``differential`` is the integration differential of an integral (``dv`` in ``∫ 1/v dv``) — a leaf node carrying the integration variable in ``with_respect_to`` and connected to its integral by a ``wrt`` edge. ``ket`` / ``bra`` are Dirac-notation state vectors (``|ψ⟩`` / ``⟨ψ|``); ``braket`` is reserved for legacy graphs — newer parses emit inner products as ``type=operator`` with ``op=inner_product``.
 */
export type NodeType =
  | 'scalar'
  | 'vector'
  | 'constant'
  | 'number'
  | 'operator'
  | 'function'
  | 'relation'
  | 'expression'
  | 'text'
  | 'annotation'
  | 'differential'
  | 'ket'
  | 'bra'
  | 'braket';

/**
 * Schema for the semantic graph produced by latex_to_graph.py. Represents a LaTeX expression as a directed graph of typed nodes (variables, operators, numbers) connected by edges.
 */
export interface SemanticGraph {
  /**
   * Ordered list of graph nodes. Each node represents a symbol, operator, number, or composite expression.
   */
  nodes: Node[];
  /**
   * Directed edges connecting nodes. Direction flows from operand to operator (e.g. m → multiply).
   */
  edges: Edge[];
  classification?: Classification;
  /**
   * The mathematical or scientific domain of this expression (e.g. "thermodynamics", "electromagnetism", "linear_algebra", "topology"). Declared once for the whole graph; disambiguates symbols like P (power vs pressure) and informs how variables should be interpreted.
   */
  domain?: string;
}
export interface Node {
  /**
   * Unique node identifier. Variables use their symbol name (e.g. "m"); generated nodes use a prefix with counter (e.g. "__multiply_1").
   */
  id: string;
  type: NodeType;
  /**
   * Human-readable descriptive name (e.g. "mass", "acceleration"). Present on symbols and numbers.
   */
  label?: string;
  /**
   * Emoji representing the physical or mathematical concept (e.g. "⚖️" for mass).
   */
  emoji?: string;
  /**
   * LaTeX rendering of the symbol (e.g. "\\psi", "\\hbar"). Present on symbols; may differ from the id when the symbol has a special LaTeX command.
   */
  latex?: string;
  /**
   * Operation name for operator, function, relation, and expression nodes. Standard operators use values from the operatorOp enum; expressions use the SymPy class name (e.g. "Tuple"); relations use the relation name (e.g. "equals", "greater_than").
   */
  op?: string;
  /**
   * Literal exponent value, present only on power operators with a constant exponent (e.g. "2" for x²). The exponent is absorbed into the operator node rather than represented as a separate number child.
   */
  exponent?: string;
  /**
   * Comma-separated node ID(s) of the variable(s) of operation for derivative, integral, sum, product, and tends_to operators (e.g. "x" for d/dx, "x, y" for ∂²/∂x∂y, "x" for lim x→a). On a ``differential`` node it holds the single integration variable id (e.g. "v" for the ``dv`` differential). For an ``integral`` node it is summary metadata mirroring its differential nodes' variables; the authoritative variables are the differential children. Each ID references a node in the graph.
   */
  with_respect_to?: string;
  /**
   * Node ID of the lower bound for definite integrals, sums, and products. References a node in the graph (e.g. "a" for a variable node, "__num_4" for a number node). Present only when bounds are specified.
   */
  lower_bound?: string;
  /**
   * Node ID of the upper bound for definite integrals, sums, and products. References a node in the graph (e.g. "b" for a variable node, "__const_5" for an infinity node). Present only when bounds are specified.
   */
  upper_bound?: string;
  /**
   * Node ID of the point being approached (e.g. "__num_3" for lim x→0, "__const_5" for lim x→∞). References a node in the graph. Present only on tends_to operator nodes (the approach specification inside a limit, not on the limit node itself).
   */
  limit_point?: string;
  /**
   * Direction of approach for one-sided limits: "+" for right-hand (x→a⁺), "-" for left-hand (x→a⁻). Omitted for bilateral limits (the default). Present only on tends_to operator nodes.
   */
  limit_direction?: '+' | '-';
  /**
   * Modulus value for congruence relations (e.g. "p" for a ≡ b (mod p)). Present only on relation nodes with op="congruent".
   */
  modulus?: string;
  /**
   * LaTeX sub-expression reconstructed by sympy.latex() for the SymPy expression rooted at this node. Used for interactive hover tooltips.
   */
  subexpr?: string;
  /**
   * Human-readable explanation of what this node represents in context (e.g. "rest mass times speed of light squared — the mass-energy equivalence term"). Can be author-provided via overrides or AI-generated.
   */
  description?: string;
  /**
   * Physical quantity from a controlled vocabulary (e.g. "pressure", "velocity", "energy"). Enables semantic matching — two variables with the same quantity represent the same physical concept regardless of symbol name.
   */
  quantity?: string;
  /**
   * SI dimensional formula using the 7 base dimension symbols: M (mass), L (length), T (time), I (electric current), Θ (temperature), N (amount of substance), J (luminous intensity). Use '1' for dimensionless. Exponents use Unicode superscripts (e.g. "M·L⁻¹·T⁻²" for pressure, "L·T⁻¹" for velocity). Separator is middle dot '·'.
   */
  dimension?: string;
  /**
   * Default SI unit (e.g. "Pa", "m/s", "kg"). Informational; does not imply the expression is in these units.
   */
  unit?: string;
  /**
   * Known numerical value for constants (e.g. 299792458, "6.674e-11"). Use string for values that need scientific notation or exact representation.
   */
  value?: number | string;
  /**
   * The role this variable plays in the equation. Distinguishes constants from variables, independent from dependent quantities, etc.
   */
  role?:
    | 'state_variable'
    | 'parameter'
    | 'constant'
    | 'coefficient'
    | 'index'
    | 'dependent'
    | 'independent'
    | 'observable'
    | 'field';
  /**
   * Optional presentation override for the node's text color (any CSS color, e.g. "#0d47a1"). When present, the mermaid renderer prefers this over the role-based palette. Also used by the server-side highlight overlay to mirror step highlight colors onto matched nodes.
   */
  color?: string;
  /**
   * Name of the proof-step highlight that matched this node — the key used in ``proofStep.highlights`` (e.g. "m" for the highlight authored as ``\htmlClass{hl-m}{...}``). Informational only at render time; reserved for downstream visualizations that want to cross-reference graph nodes with their originating highlight.
   */
  highlight?: string;
  /**
   * Optional proportionality variant for the node, mirroring the edge ``semantic`` values (direct, inverse, neutral).
   */
  variant?: 'direct' | 'inverse' | 'neutral';
}
export interface Edge {
  /**
   * Source node id (operand).
   */
  from: string;
  /**
   * Target node id (operator or result).
   */
  to: string;
  /**
   * Optional edge label displayed on the diagram.
   */
  label?: string;
  /**
   * Proportionality of the edge: direct (more input → more output), inverse (more input → less output), or neutral.
   */
  semantic?: 'direct' | 'inverse' | 'neutral';
  /**
   * Strength of the relationship. For a base→power edge, this is the absolute value of the exponent (e.g. 2 for x², 3 for x⁻³). Renderers multiply this by a base stroke width and clamp to [1, 8] so very large exponents stay visually sane. Omit for edges where strength is undefined (addition, structural).
   */
  weight?: number;
  /**
   * Operand position or relationship. 'lhs'/'rhs' for asymmetric operators (comparisons, tends_to). 'wrt' for the variable-of-operation edge: the differentiation variable into a derivative node, the index variable into a sum/product node, and the 'differential' node (e.g. the 'dv' of ∫ 1/v dv) into its integral node. 'exp' for the exponent edge into a power node with symbolic exponent. 'base' for the base argument edge into a log function node. 'lb'/'ub' for lower/upper bound edges into sum/product nodes. 'value'/'condition' for piecewise branch nodes — 'value' is the branch result, 'condition' is the guard predicate. 'modulus' for the modulus operand of a congruence relation. 'assertion' for an assertion-form relation (e.g. X=k) feeding into a probability function P(X=k). Omit for symmetric operators (add, multiply, equals).
   */
  role?: 'lhs' | 'rhs' | 'wrt' | 'exp' | 'base' | 'lb' | 'ub' | 'value' | 'condition' | 'modulus' | 'assertion';
}
/**
 * Expression classification metadata (algebraic, ODE, PDE).
 */
export interface Classification {
  /**
   * Expression type: algebraic (no derivatives), ODE (single independent variable), PDE (multiple independent variables), statements (top-level comma-separated clauses — each clause is an independent statement emitted as its own subtree; see issue #144), or piecewise (expression defined by cases/branches via \begin{cases}...\end{cases}).
   */
  kind: 'algebraic' | 'ODE' | 'PDE' | 'statements' | 'piecewise';
  /**
   * Number of independent statements in the graph. Present only when kind = "statements". Redundant with clauses.length but kept for quick access.
   */
  count?: number;
  /**
   * Number of case branches in a piecewise expression. Present only when kind = "piecewise".
   */
  branches?: number;
  /**
   * Per-clause classifications. Each entry is a full classification object for one comma-separated clause — lets downstream consumers see that, e.g., statement 0 is a PDE while statement 1 is algebraic, without re-walking the clause subtrees. Present only when kind = "statements".
   *
   * @minItems 2
   */
  clauses?: [Classification1, Classification1, ...Classification1[]];
  /**
   * Highest derivative order. Present only for ODE/PDE.
   */
  order?: number;
  /**
   * Variables being differentiated (e.g. ["psi"]). Present only for ODE/PDE.
   */
  dependent_variables?: string[];
  /**
   * Variables differentiated with respect to (e.g. ["t", "x"]). Present only for ODE/PDE.
   */
  independent_variables?: string[];
  /**
   * SymPy classify_ode hint strings (e.g. ["separable", "1st_linear"]). Present only for single-variable ODEs.
   */
  sympy_hints?: string[];
  /**
   * Whether the ODE is linear. Present only for single-variable ODEs.
   */
  linear?: boolean;
  /**
   * Whether the ODE is homogeneous. Present only for single-variable ODEs.
   */
  homogeneous?: boolean;
  /**
   * Whether the ODE has constant coefficients. Present only for single-variable ODEs.
   */
  constant_coefficients?: boolean;
}
export interface Classification1 {
  /**
   * Expression type: algebraic (no derivatives), ODE (single independent variable), PDE (multiple independent variables), statements (top-level comma-separated clauses — each clause is an independent statement emitted as its own subtree; see issue #144), or piecewise (expression defined by cases/branches via \begin{cases}...\end{cases}).
   */
  kind: 'algebraic' | 'ODE' | 'PDE' | 'statements' | 'piecewise';
  /**
   * Number of independent statements in the graph. Present only when kind = "statements". Redundant with clauses.length but kept for quick access.
   */
  count?: number;
  /**
   * Number of case branches in a piecewise expression. Present only when kind = "piecewise".
   */
  branches?: number;
  /**
   * Per-clause classifications. Each entry is a full classification object for one comma-separated clause — lets downstream consumers see that, e.g., statement 0 is a PDE while statement 1 is algebraic, without re-walking the clause subtrees. Present only when kind = "statements".
   *
   * @minItems 2
   */
  clauses?: [Classification1, Classification1, ...Classification1[]];
  /**
   * Highest derivative order. Present only for ODE/PDE.
   */
  order?: number;
  /**
   * Variables being differentiated (e.g. ["psi"]). Present only for ODE/PDE.
   */
  dependent_variables?: string[];
  /**
   * Variables differentiated with respect to (e.g. ["t", "x"]). Present only for ODE/PDE.
   */
  independent_variables?: string[];
  /**
   * SymPy classify_ode hint strings (e.g. ["separable", "1st_linear"]). Present only for single-variable ODEs.
   */
  sympy_hints?: string[];
  /**
   * Whether the ODE is linear. Present only for single-variable ODEs.
   */
  linear?: boolean;
  /**
   * Whether the ODE is homogeneous. Present only for single-variable ODEs.
   */
  homogeneous?: boolean;
  /**
   * Whether the ODE has constant coefficients. Present only for single-variable ODEs.
   */
  constant_coefficients?: boolean;
}
