"""The proof-edit intent parser — a compilable DSPy module.

Lives under ``modules/`` (beside ``proof_completion``) because it is a
``dspy.Module`` with a compile target, not handler glue. The HTTP handler in
``backend/experts/handlers/proof_edit/`` imports from here.
"""
