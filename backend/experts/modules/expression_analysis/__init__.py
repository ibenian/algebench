"""Expression analysis: CAS feature detection + pedagogical viz proposal.

``features``  — SymPy-only behavior-feature catalog detection (§6.1 of the
equation-behavior pedagogy proposal); no LM.
``proposer``  — DSPy module ranking the detected features pedagogically and
proposing viewports + predict-before-reveal probes.

No ``@register_expert`` here — like ``proof_edit.intent``, the module is
reached through its handler (``handlers/expression_analysis``), which owns
the orchestration.
"""
