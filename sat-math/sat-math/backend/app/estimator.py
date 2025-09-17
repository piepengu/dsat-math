from typing import Tuple

try:
    from scipy.stats import beta
except Exception:  # optional fallback if scipy not installed
    beta = None


def estimate_math_sat(
    correct: int,
    total: int,
    alpha: float = 2.0,
    beta_prior: float = 2.0,
) -> Tuple[int, Tuple[int, int], float]:
    correct = max(0, min(correct, total))
    post_a = alpha + correct
    post_b = beta_prior + (total - correct)
    p_mean = post_a / (post_a + post_b)

    if beta is None:
        lo, hi = p_mean, p_mean
    else:
        lo, hi = beta.ppf([0.16, 0.84], post_a, post_b)

    score = 200 + round(600 * p_mean)
    ci = (200 + round(600 * lo), 200 + round(600 * hi))
    return score, ci, p_mean
