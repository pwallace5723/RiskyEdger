/**
 * math.js — EdgeFinder
 *
 * Pure odds calculation functions. No DOM access.
 * Imported first so other modules can call these freely.
 */

// ─────────────────────────────────────────────────────────
// Odds conversions
// ─────────────────────────────────────────────────────────

/** American odds → Decimal odds (e.g. +150 → 2.5, -110 → 1.909) */
function toDec(v) {
  v = parseFloat(v);
  if (isNaN(v)) return null;
  return v > 0 ? v / 100 + 1 : 100 / Math.abs(v) + 1;
}

/** American odds → Implied probability (0–1) */
function toImp(v) {
  v = parseFloat(v);
  if (isNaN(v)) return null;
  return v > 0 ? 100 / (v + 100) : Math.abs(v) / (Math.abs(v) + 100);
}

/** Format American odds with sign (e.g. 150 → "+150", -110 → "-110") */
function fmtAm(v) {
  if (v === '' || v === null || v === undefined || isNaN(parseFloat(v))) return null;
  const n = parseFloat(v);
  return n > 0 ? `+${n}` : `${n}`;
}

/** Probability (0–1) → American odds integer */
function probToAm(p) {
  if (!p || p <= 0 || p >= 1) return null;
  if (p >= 0.5) return Math.round(-p / (1 - p) * 100);
  return Math.round((1 - p) / p * 100);
}

// ─────────────────────────────────────────────────────────
// Best odds helpers
// ─────────────────────────────────────────────────────────

const PLATS      = ['dk', 'fd', 'mgm', 'caes', 'poly', 'kal'];
const PLAT_NAMES = { dk:'DraftKings', fd:'FanDuel', mgm:'BetMGM', caes:'Caesars', poly:'Polymarket', kal:'Kalshi' };

/**
 * Returns the best (highest decimal / most generous) odds for a candidate
 * across all platforms, plus which platform offers them.
 * @param {Object} cand - candidate object with .odds map
 * @returns {{ dec, am, plat }}
 */
function getBest(cand) {
  let bDec = null, bAm = null, bPlat = null;
  PLATS.forEach(p => {
    const raw = cand.odds[p];
    if (raw === '' || raw === null || raw === undefined) return;
    const d = toDec(raw);
    if (d && (bDec === null || d > bDec)) {
      bDec = d; bAm = parseFloat(raw); bPlat = p;
    }
  });
  return { dec: bDec, am: bAm, plat: bPlat };
}

/**
 * Derives win probability for a candidate based on the selected mode:
 *   'best'      — implied prob from best available odds (most optimistic)
 *   'consensus' — average implied prob across all available books
 *   'sharp'     — average of DraftKings + FanDuel only
 * @param {Object} cand
 * @param {string} mode - 'best' | 'consensus' | 'sharp'
 * @returns {number|null}
 */
function getProb(cand, mode) {
  if (mode === 'sharp') {
    const vals = [cand.odds.dk, cand.odds.fd]
      .filter(x => x !== '' && x !== null && !isNaN(parseFloat(x)));
    if (!vals.length) return null;
    return vals.reduce((s, x) => s + toImp(x), 0) / vals.length;
  }
  if (mode === 'consensus') {
    const vals = PLATS.map(p => cand.odds[p])
      .filter(x => x !== '' && x !== null && !isNaN(parseFloat(x)));
    if (!vals.length) return null;
    return vals.reduce((s, x) => s + toImp(x), 0) / vals.length;
  }
  // 'best' — lowest implied prob = best odds for the bettor
  const { dec } = getBest(cand);
  return dec ? 1 / dec : null;
}

// ─────────────────────────────────────────────────────────
// Kelly Criterion
// ─────────────────────────────────────────────────────────

/**
 * Full Kelly fraction: what fraction of bankroll to wager.
 * Formula: f* = (b·p − q) / b   where b = decimal − 1
 *
 * Returns a positive number (bet fraction) or 0 if negative EV.
 * Caller should multiply by bankroll to get bet size in dollars.
 *
 * @param {number} prob - estimated win probability (0–1)
 * @param {number} dec  - decimal odds
 * @returns {number}
 */
function kelly(prob, dec) {
  if (!prob || !dec || dec <= 1) return 0;
  const b = dec - 1;
  return (b * prob - (1 - prob)) / b;
}
