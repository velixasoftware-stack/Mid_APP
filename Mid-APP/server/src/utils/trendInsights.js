/**
 * Rule-based "AI Insights" generator for a lab parameter's value history.
 * No external LLM is configured for this project, so this mirrors the
 * mock-fallback pattern used elsewhere (Razorpay, Gmail): deterministic
 * trend analysis that reads like a short interpretation, without a network
 * call, API key, or per-request cost.
 */

function numberOrNull(v) {
  const n = Number(v);
  return Number.isFinite(n) ? n : null;
}

/** `history` is chronological (oldest first) and its last entry is the current result. */
function buildParameterInsight(history) {
  if (history.length === 0) return 'No results recorded yet.';

  if (history.length === 1) {
    const latest = history[0];
    return latest.isAbnormal
      ? 'First recorded value for this patient, and it falls outside the normal range — no prior history to compare against.'
      : 'First recorded value for this patient, within the normal range — no prior history to compare against.';
  }

  const latest = history[history.length - 1];
  const previous = history[history.length - 2];
  const latestNum = numberOrNull(latest.value);
  const previousNum = numberOrNull(previous.value);
  const parts = [];

  if (latestNum != null && previousNum != null && previousNum !== 0) {
    const pctChange = ((latestNum - previousNum) / Math.abs(previousNum)) * 100;
    if (Math.abs(pctChange) < 5) {
      parts.push(`Stable compared to the previous test (${previous.value} → ${latest.value}).`);
    } else if (pctChange > 0) {
      parts.push(`Increased by ${pctChange.toFixed(0)}% since the previous test (${previous.value} → ${latest.value}).`);
    } else {
      parts.push(`Decreased by ${Math.abs(pctChange).toFixed(0)}% since the previous test (${previous.value} → ${latest.value}).`);
    }
  } else {
    parts.push(`Previous value was ${previous.value}, now ${latest.value}.`);
  }

  if (latest.isAbnormal && !previous.isAbnormal) {
    parts.push('This result has newly moved outside the normal range.');
  } else if (!latest.isAbnormal && previous.isAbnormal) {
    parts.push('This result has returned to the normal range.');
  } else if (latest.isAbnormal && previous.isAbnormal) {
    parts.push('This result remains outside the normal range.');
  }

  // A consistent direction across the last few points is worth calling out on its own.
  if (history.length >= 3) {
    const recent = history.slice(-4).map((h) => numberOrNull(h.value)).filter((v) => v != null);
    if (recent.length >= 3) {
      const diffs = recent.slice(1).map((v, i) => v - recent[i]);
      if (diffs.every((d) => d > 0)) parts.push(`Rising trend across the last ${recent.length} tests.`);
      else if (diffs.every((d) => d < 0)) parts.push(`Declining trend across the last ${recent.length} tests.`);
    }
  }

  return parts.join(' ');
}

module.exports = { buildParameterInsight };
