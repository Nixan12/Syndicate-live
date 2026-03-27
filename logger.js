/**
 * logger.js
 * 
 * Persistent signal-logg lagret til disk som JSON.
 * Alle loggede signaler overlever server-restart.
 */

const fs = require('fs');
const path = require('path');

const LOG_FILE = path.join(__dirname, 'data', 'signals.json');

// Sørg for at data-mappen eksisterer
fs.mkdirSync(path.dirname(LOG_FILE), { recursive: true });

// Last inn eksisterende logg ved oppstart
let signals = [];
try {
  if (fs.existsSync(LOG_FILE)) {
    signals = JSON.parse(fs.readFileSync(LOG_FILE, 'utf8'));
    console.log(`[LOGGER] Lastet ${signals.length} eksisterende signaler fra disk`);
  }
} catch (err) {
  console.warn('[LOGGER] Kunne ikke laste loggfil, starter tom:', err.message);
}

function save() {
  try {
    fs.writeFileSync(LOG_FILE, JSON.stringify(signals, null, 2));
  } catch (err) {
    console.error('[LOGGER] Kunne ikke lagre til disk:', err.message);
  }
}

/**
 * Legg til nytt signal
 */
function add(entry) {
  const signal = {
    id: `${entry.matchId}-${Date.now()}`,
    matchId: entry.matchId,
    home: entry.home,
    away: entry.away,
    league: entry.league,
    minute: entry.minute,
    score: entry.score,
    odds: entry.odds,
    xgTotal: entry.xgTotal ?? null,
    shotsOnTarget: entry.shotsOnTarget ?? null,
    dangerousAttacks: entry.dangerousAttacks ?? null,
    loggedAt: new Date().toISOString(),
    result: null,   // 'win' | 'loss' | null (pending)
    gain: null,     // €-beløp (papir)
    stake: 100,     // Papir-innsats i €
  };

  signals.push(signal);
  save();
  console.log(`[LOGGER] Signal logget: ${signal.home} vs ${signal.away} @ ${signal.odds}`);
  return signal;
}

/**
 * Oppdater utfall for et signal
 */
function updateResult(id, { result, finalOdds }) {
  const signal = signals.find(s => s.id === id);
  if (!signal) throw new Error(`Signal ${id} ikke funnet`);

  signal.result = result;
  signal.resolvedAt = new Date().toISOString();

  if (result === 'win') {
    const odds = finalOdds ?? signal.odds;
    signal.gain = parseFloat(((odds - 1) * signal.stake).toFixed(2));
  } else if (result === 'loss') {
    signal.gain = -signal.stake;
  }

  save();
  console.log(`[LOGGER] Utfall oppdatert: ${signal.home} vs ${signal.away} → ${result} (${signal.gain > 0 ? '+' : ''}€${signal.gain})`);
  return signal;
}

function getAll() {
  return signals;
}

/**
 * Beregn samlede statistikker
 */
function getStats() {
  const resolved = signals.filter(s => s.result !== null);
  const wins = resolved.filter(s => s.result === 'win');
  const totalPnl = resolved.reduce((sum, s) => sum + (s.gain ?? 0), 0);
  const hitRate = resolved.length > 0 ? (wins.length / resolved.length) : null;

  return {
    total: signals.length,
    pending: signals.filter(s => s.result === null).length,
    resolved: resolved.length,
    wins: wins.length,
    losses: resolved.length - wins.length,
    hitRate: hitRate !== null ? parseFloat(hitRate.toFixed(4)) : null,
    hitRatePct: hitRate !== null ? `${(hitRate * 100).toFixed(1)}%` : '—',
    totalPnl: parseFloat(totalPnl.toFixed(2)),
    roi: resolved.length > 0
      ? parseFloat(((totalPnl / (resolved.length * 100)) * 100).toFixed(2))
      : null,
  };
}

module.exports = { add, updateResult, getAll, getStats };
