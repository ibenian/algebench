"""Metric registration — one metric per expert, keyed by expert name.

Importing this module self-registers the metrics. The metric *logic* lives next
to its expert (e.g. ``proof_completion/metric.py``); this file just wires it
into ``METRIC_REGISTRY``.
"""

from __future__ import annotations

from .registry import register_metric
from .proof_completion.metric import proof_completion_metric

register_metric("proof_completion")(proof_completion_metric)
