/**
 * api.js — EdgeFinder
 *
 * Handles all external API calls:
 *   - Polymarket (Gamma public REST API)
 *   - Kalshi (Trade API v2)
 *
 * Depends on: math.js (probToAm), app.js (addCandidate, wipeCands, toast)
 */

// ─────────────────────────────────────────────────────────
// POLYMARKET
// ─────────────────────────────────────────────────────────

/**
 * Saves the user's Polymarket API key to localStorage and marks
 * the connector as active in the UI.
 */
function connectPoly() {
  const k = document.getElementById('polyKey').value.trim();
  if (k) localStorage.setItem('ef_poly_key', k);
  setApiStatus('poly', true);
  toast('Polymarket key saved', '🔮', 't-green');
}

/**
 * Fetches market outcomes from Polymarket's public Gamma API.
 * Populates candidate rows with auto-filled Poly odds (in teal).
 *
 * Polymarket API docs: https://docs.polymarket.com
 * No API key required for public markets.
 */
async function fetchPoly() {
  const slug = document.getElementById('polySlug').value.trim();
  if (!slug) { toast('Enter a market slug', '⚠️', 't-red'); return; }

  setFetchStatus('Fetching Polymarket…');
  try {
    const url = `https://gamma-api.polymarket.com/markets?slug=${encodeURIComponent(slug)}&limit=50`;
    const res  = await fetch(url, { headers: { Accept: 'application/json' } });
    if (!res.ok) throw new Error(`HTTP ${res.status}`);

    const data = await res.json();
    const mkts = Array.isArray(data) ? data : (data.results || data.markets || []);
    if (!mkts.length) throw new Error('No markets found for that slug');

    const m        = mkts[0];
    const outcomes = m.outcomes       ? JSON.parse(m.outcomes)       : null;
    const prices   = m.outcomePrices  ? JSON.parse(m.outcomePrices)  : null;
    if (!outcomes || !prices) throw new Error('Could not parse outcomes from market data');

    wipeCands();
    outcomes.forEach((name, i) => {
      const prob = parseFloat(prices[i]);
      const am   = probToAm(prob);
      const amFmt = am ? (am > 0 ? `+${am}` : `${am}`) : '';
      addCandidate({ name, poly: amFmt, autoFilled: { poly: true } });
      // Style the auto-filled input
      const last = candidates[candidates.length - 1];
      const el   = document.getElementById(`oi-${last.id}-poly`);
      if (el) el.classList.add('autofill');
    });

    setApiStatus('poly', true);
    setFetchStatus('');
    toast(`Loaded ${outcomes.length} outcomes from Polymarket`, '🔮', 't-green');
  } catch (e) {
    setFetchStatus('');
    toast(`Polymarket: ${e.message}`, '❌', 't-red');
    console.error('[EdgeFinder] Polymarket fetch error:', e);
  }
}

// ─────────────────────────────────────────────────────────
// KALSHI
// ─────────────────────────────────────────────────────────

/**
 * Saves the user's Kalshi API key to localStorage.
 * Required for private/restricted markets; public markets work without a key.
 */
function connectKalshi() {
  const k = document.getElementById('kalshiKey').value.trim();
  if (k) localStorage.setItem('ef_kalshi_key', k);
  setApiStatus('kalshi', true);
  toast('Kalshi key saved', '📈', 't-green');
}

/**
 * Fetches all markets in a Kalshi series by ticker.
 * Each market becomes one candidate row with auto-filled Kal odds.
 *
 * Kalshi API docs: https://trading-api.kalshi.com/trade-api/v2
 * API key optional for public markets.
 */
async function fetchKalshi() {
  const ticker = document.getElementById('kalshiTicker').value.trim().toUpperCase();
  if (!ticker) { toast('Enter a Kalshi series ticker', '⚠️', 't-red'); return; }

  const key = localStorage.getItem('ef_kalshi_key') || '';
  setFetchStatus('Fetching Kalshi…');
  try {
    const headers = { Accept: 'application/json' };
    if (key) headers['Authorization'] = `Bearer ${key}`;

    const url = `https://trading-api.kalshi.com/trade-api/v2/markets?series_ticker=${encodeURIComponent(ticker)}&limit=100`;
    const res = await fetch(url, { headers });
    if (!res.ok) throw new Error(`HTTP ${res.status}`);

    const data = await res.json();
    const mkts = data.markets || [];
    if (!mkts.length) throw new Error('No markets found for that ticker');

    wipeCands();
    mkts.forEach(m => {
      // Kalshi prices are in cents (0–99); yes_ask is the current ask price
      const prob  = ((m.yes_ask || m.last_price || 50)) / 100;
      const am    = probToAm(Math.min(0.99, Math.max(0.01, prob)));
      const amFmt = am ? (am > 0 ? `+${am}` : `${am}`) : '';
      const name  = m.title || m.subtitle || m.market_ticker || 'Unknown';

      addCandidate({ name, kal: amFmt, autoFilled: { kal: true } });
      const last = candidates[candidates.length - 1];
      const el   = document.getElementById(`oi-${last.id}-kal`);
      if (el) el.classList.add('autofill');
    });

    setApiStatus('kalshi', true);
    setFetchStatus('');
    toast(`Loaded ${mkts.length} markets from Kalshi`, '📈', 't-green');
  } catch (e) {
    setFetchStatus('');
    toast(`Kalshi: ${e.message}`, '❌', 't-red');
    console.error('[EdgeFinder] Kalshi fetch error:', e);
  }
}

// ─────────────────────────────────────────────────────────
// UI helpers (shared between both APIs)
// ─────────────────────────────────────────────────────────

function setApiStatus(which, connected) {
  const id  = which === 'poly' ? 'polyStatus' : 'kalshiStatus';
  const el  = document.getElementById(id);
  if (!el) return;
  el.className   = `api-status ${connected ? 'api-ok' : 'api-off'}`;
  el.textContent = connected ? 'Connected' : 'Disconnected';
}

function setFetchStatus(msg) {
  const el = document.getElementById('fetchStatus');
  if (!el) return;
  el.innerHTML = msg ? `<span class="spin">⟳</span> ${msg}` : '';
}

// ─────────────────────────────────────────────────────────
// Restore connection state on page load
// ─────────────────────────────────────────────────────────

(function restoreApiState() {
  // Deferred so DOM is ready — called at bottom of app.js init
  if (localStorage.getItem('ef_poly_key'))   setApiStatus('poly',   true);
  if (localStorage.getItem('ef_kalshi_key')) setApiStatus('kalshi', true);
})();
