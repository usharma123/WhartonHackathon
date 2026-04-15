"""experiment_config.py — THE ONLY FILE THE AGENT SHOULD MODIFY.

Hyperparameters for the ReviewGap ML training pipeline and rules layer export.

See program.md for the full autoresearch ratchet loop instructions:
  - Run `python3 EDA/scripts/train_review_classifier.py` after any change here.
  - Run `python3 EDA/scripts/export_runtime_artifacts.py` to rebuild the rules layer.
  - Run `python3 EDA/scripts/evaluate.py` to score the result.
  - Commit if combined_score improves; revert otherwise.
"""

# ---------------------------------------------------------------------------
# ML Training — train_review_classifier.py
# ---------------------------------------------------------------------------

# Label confidence margins.
# A review is a positive training example only if its semantic score >=
# semantic_threshold + POSITIVE_MARGIN, and a negative example only if
# its score <= semantic_threshold - NEGATIVE_MARGIN.
# Tighter margins = fewer but cleaner labels.
POSITIVE_MARGIN: float = 0.05
NEGATIVE_MARGIN: float = 0.05

# Minimum character length of review text to include in training.
# Short reviews tend to be noisy ("great hotel!") and hurt precision.
MIN_TEXT_LEN: int = 40

# Logistic regression regularization.
# Higher C = less regularization (more capacity, more risk of overfitting).
# Try: 0.5, 1.0, 2.0 (default), 5.0
C: float = 2.0

# Maximum number of TF-IDF features (vocabulary size).
# Higher values capture more hotel-specific bigrams but slow inference.
MAX_FEATURES: int = 2500

# Minimum document frequency for a term to enter the vocabulary.
# MIN_DF=2 removes hapax legomena (words appearing once).
MIN_DF: int = 2

# TF-IDF n-gram range: (1, 2) includes unigrams and bigrams.
# Try (1, 3) for trigrams at the cost of a larger feature space.
NGRAM_RANGE: tuple[int, int] = (1, 2)

# Class weighting for imbalanced labels.
# "balanced" weights inverse to class frequency.
# None applies no weighting (majority class dominates).
CLASS_WEIGHT: str | None = "balanced"

# Maximum solver iterations (increase if solver warns of non-convergence).
MAX_ITER: int = 1500

# Random seed for reproducible train/val splits and model initialization.
RANDOM_STATE: int = 42

# ---------------------------------------------------------------------------
# Shipping Gate — minimum metrics for a model to be accepted
# ---------------------------------------------------------------------------

# Primary facets: check_in, check_out, amenities_breakfast, amenities_parking
PRIMARY_MIN_ROC_AUC: float = 0.78
PRIMARY_MIN_F1: float = 0.52

# Secondary facets: know_before_you_go, amenities_pool
SECONDARY_MIN_ROC_AUC: float = 0.72
SECONDARY_MIN_F1: float = 0.42

# ---------------------------------------------------------------------------
# Rules Layer — Importance Values (export_runtime_artifacts.py)
# These also propagate to the TypeScript scoring layer.
# After finding a winner, sync to: src/backend/facets.ts FACET_POLICIES[*].importance
# ---------------------------------------------------------------------------

IMPORTANCE: dict[str, float] = {
    "check_in": 0.95,
    "check_out": 0.84,
    "amenities_breakfast": 0.90,
    "amenities_parking": 0.92,
    "know_before_you_go": 0.70,
    "amenities_pool": 0.68,
    "pet": 0.30,
    "children_extra_bed": 0.28,
    "amenities_wifi": 0.26,
    "amenities_gym": 0.24,
}

# ---------------------------------------------------------------------------
# Rules Layer — Reliability Classification (export_runtime_artifacts.py)
# Controls which (property, facet) pairs are eligible for auto-selection.
# ---------------------------------------------------------------------------

# matched_review_rate threshold — above this value → "high" reliability
RELIABILITY_HIGH_MATCHED_RATE: float = 0.03

# mean cosine similarity threshold for the "medium" reliability band
RELIABILITY_MEDIUM_COS: float = 0.32

# secondary matched_review_rate threshold for "medium" reliability
RELIABILITY_MEDIUM_MATCHED_RATE: float = 0.01

# mention_rate threshold that alone qualifies for "medium" reliability
RELIABILITY_MEDIUM_MENTION_RATE: float = 0.02

# ---------------------------------------------------------------------------
# Rules Layer — Staleness Normalization (export_runtime_artifacts.py)
# days_since / STALENESS_NORM_DAYS, clamped to [0, 1].
# Lower values make the system more sensitive to recent data gaps.
# Try: 180, 270, 365 (default)
# ---------------------------------------------------------------------------

STALENESS_NORM_DAYS: int = 365
