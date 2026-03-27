/**
 * signals.js
 * 
 * Beregner signalscore 0-100 for en live 0-0 kamp.
 * Høyere score = sterkere indikasjon på mål før pause.
 * 
 * Juster vektene her etter hvert som du validerer mot historisk data.
 */

/**
 * Hoved-scoring funksjon.
 * @param {Object} m - Kampdata med stats
 * @returns {number} Score 0-100
 */
function calcSignalScore(m) {
  let score = 0;
  const reasons = [];

  // ── XG TOTAL ─────────────────────────────────────────────────────────────
  const xgTotal = (m.xgHome ?? 0) + (m.xgAway ?? 0);

  if (xgTotal >= 1.2) {
    score += 25;
    reasons.push(`xG total ${xgTotal.toFixed(2)} ≥ 1.2 (+25)`);
  } else if (xgTotal >= 0.7) {
    score += 15;
    reasons.push(`xG total ${xgTotal.toFixed(2)} ≥ 0.7 (+15)`);
  } else if (xgTotal >= 0.4) {
    score += 7;
    reasons.push(`xG total ${xgTotal.toFixed(2)} ≥ 0.4 (+7)`);
  }

  // ── XG UBALANSE (ett lag presser) ────────────────────────────────────────
  const xgDiff = Math.abs((m.xgHome ?? 0) - (m.xgAway ?? 0));
  if (xgDiff >= 0.5) {
    score += 10;
    reasons.push(`xG-ubalanse ${xgDiff.toFixed(2)} (+10)`);
  }

  // ── SKUDD PÅ MÅL ─────────────────────────────────────────────────────────
  const sot = m.shotsOnTarget ?? 0;
  if (sot >= 5) {
    score += 20;
    reasons.push(`${sot} skudd på mål (+20)`);
  } else if (sot >= 3) {
    score += 12;
    reasons.push(`${sot} skudd på mål (+12)`);
  } else if (sot >= 1) {
    score += 5;
    reasons.push(`${sot} skudd på mål (+5)`);
  }

  // ── FARLIGE ANGREP ────────────────────────────────────────────────────────
  const da = m.dangerousAttacks ?? 0;
  if (da >= 15) {
    score += 15;
    reasons.push(`${da} farlige angrep (+15)`);
  } else if (da >= 9) {
    score += 9;
    reasons.push(`${da} farlige angrep (+9)`);
  } else if (da >= 5) {
    score += 4;
    reasons.push(`${da} farlige angrep (+4)`);
  }

  // ── DOMINANS (possession) ─────────────────────────────────────────────────
  const poss = m.possession ?? 50;
  if (poss >= 65 || poss <= 35) {
    score += 8;
    reasons.push(`Dominans ${poss}% possession (+8)`);
  }

  // ── TIDSVINDU (28-42 min er prime) ───────────────────────────────────────
  const min = m.minute ?? 0;
  if (min >= 28 && min <= 42) {
    score += 15;
    reasons.push(`Prime-vindu ${min}' (+15)`);
  } else if (min >= 20 && min <= 27) {
    score += 7;
    reasons.push(`Tidlig vindu ${min}' (+7)`);
  }

  // ── CORNERS ──────────────────────────────────────────────────────────────
  const corners = m.cornerKicks ?? 0;
  if (corners >= 5) {
    score += 7;
    reasons.push(`${corners} cornere (+7)`);
  } else if (corners >= 3) {
    score += 3;
    reasons.push(`${corners} cornere (+3)`);
  }

  return {
    score: Math.min(score, 100),
    reasons,
    tier: scoreTier(Math.min(score, 100)),
  };
}

function scoreTier(score) {
  if (score >= 70) return 'STERKT';
  if (score >= 45) return 'MODERAT';
  return 'LAVT';
}

/**
 * Sjekk om en kamp kvalifiserer for signallogging
 */
function isSignal(m) {
  const { score } = calcSignalScore(m);
  return score >= 45;
}

module.exports = { calcSignalScore, isSignal, scoreTier };
