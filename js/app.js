/**
 * app.js — EdgeFinder
 *
 * Core application logic:
 *   - Candidate row management (add, remove, update, toggle)
 *   - Full Kelly calculation
 *   - Results rendering (stats, table, summary)
 *   - CSV export
 *   - Sample data & clear
 *   - Toast notifications & modal helpers
 *
 * Depends on: math.js, api.js, saves.js (loaded before this file)
 */

// ─────────────────────────────────────────────────────────
// State
// ─────────────────────────────────────────────────────────

let candidates  = [];   // Array of candidate objects
let cid         = 0;    // Auto-increment ID for candidates
let lastResults = null; // Most recent calculation results (for CSV export)

// ─────────────────────────────────────────────────────────
// Candidate management
// ─────────────────────────────────────────────────────────

/**
 * Adds a new candidate to the state and renders its input row.
 * @param {Object} pre - optional prefill: { name, dk, fd, mgm, caes, poly, kal, autoFilled }
 */
function addCandidate(pre = null) {
  const id = cid++;
  candidates.push({
    id,
    name:       pre?.name  || '',
    excluded:   false,
    odds: {
      dk:   pre?.dk   || '',
      fd:   pre?.fd   || '',
      mgm:  pre?.mgm  || '',
      caes: pre?.caes || '',
      poly: pre?.poly || '',
      kal:  pre?.kal  || ''
    },
    autoFilled: pre?.autoFilled || {}
  });
  renderCandRow(candidates[candidates.length - 1]);
}

function renderCandRow(c) {
  const el  = document.createElement('div');
  el.className = `cand-card${c.excluded ? ' excluded' : ''}`;
  el.id        = `cc-${c.id}`;
  const idx    = candidates.findIndex(x => x.id === c.id);

  el.innerHTML = `
    <div class="cand-top">
      <div class="cand-idx" id="ci-${c.id}">${idx + 1}</div>
      <input class="cand-name-inp" type="text" placeholder="Candidate name…"
        value="${esc(c.name)}"
        oninput="updName(${c.id}, this.value)">
      <div class="toggle-wrap">
        <span class="toggle-lbl">${c.excluded ? 'Out' : 'In'}</span>
        <label class="toggle">
          <input type="checkbox" ${c.excluded ? '' : 'checked'}
            onchange="toggleExcl(${c.id}, this)">
          <span class="toggle-track"></span>
        </label>
      </div>
      <button class="cand-del" onclick="delCand(${c.id})" title="Remove">✕</button>
    </div>
    <div class="cand-body">
      <div class="plat-grid">
        ${PLATS.map(p => `
          <div>
            <div class="plat-name">${PLAT_LABELS[p]}</div>
            <input class="odds-inp${c.autoFilled[p] ? ' autofill' : ''}"
              id="oi-${c.id}-${p}"
              type="text"
              placeholder="±"
              value="${esc(c.odds[p])}"
              oninput="updOdds(${c.id}, '${p}', this.value)">
          </div>
        `).join('')}
      </div>
    </div>
  `;
  document.getElementById('candList').appendChild(el);
  hlBest(c);
}

function delCand(id) {
  candidates = candidates.filter(c => c.id !== id);
  document.getElementById(`cc-${id}`)?.remove();
  reindex();
}

function updName(id, v) {
  const c = findCand(id);
  if (c) c.name = v;
}

function updOdds(id, plat, v) {
  const c = findCand(id);
  if (!c) return;
  c.odds[plat] = v;
  // Clear autofill flag when user manually edits
  if (c.autoFilled[plat]) c.autoFilled[plat] = false;
  hlBest(c);
}

function toggleExcl(id, cb) {
  const c = findCand(id);
  if (!c) return;
  c.excluded = !cb.checked;
  const card = document.getElementById(`cc-${id}`);
  card?.classList.toggle('excluded', c.excluded);
  const lbl = card?.querySelector('.toggle-lbl');
  if (lbl) lbl.textContent = c.excluded ? 'Out' : 'In';
}

/** Highlights the best odds input for a candidate in cyan */
function hlBest(c) {
  const { plat: bp } = getBest(c);
  PLATS.forEach(p => {
    const el = document.getElementById(`oi-${c.id}-${p}`);
    if (!el) return;
    el.classList.remove('best');
    if (p === bp && c.odds[p] !== '' && !isNaN(parseFloat(c.odds[p]))) {
      el.classList.add('best');
    }
  });
}

function reindex() {
  candidates.forEach((c, i) => {
    const el = document.getElementById(`ci-${c.id}`);
    if (el) el.textContent = i + 1;
  });
}

function findCand(id) { return candidates.find(c => c.id === id); }

function wipeCands() {
  candidates = [];
  cid = 0;
  document.getElementById('candList').innerHTML = '';
}

// ─────────────────────────────────────────────────────────
// Calculate Full Kelly Bets
// ─────────────────────────────────────────────────────────

function calculate() {
  const active = candidates.filter(c => !c.excluded);
  if (!active.length) {
    toast('Toggle at least one candidate In', '⚠️', 't-red');
    return;
  }

  const bankroll = parseFloat(document.getElementById('bankroll').value) || 1000;
  const mode     = document.getElementById('probMode').value;

  // Raw (un-normalised) win probabilities from odds
  const rawProbs = active.map(c => getProb(c, mode));
  const total    = rawProbs.reduce((s, p) => s + (p || 0), 0);
  if (!total) {
    toast('Enter odds for at least one candidate', '⚠️', 't-red');
    return;
  }

  // Normalise so probabilities sum to 100%
  const results = active.map((c, i) => {
    const rp   = rawProbs[i] || 0;
    const norm = rp / total;
    const { dec: bDec, am: bAm, plat: bPlat } = getBest(c);
    const k    = bDec ? kelly(norm, bDec) : 0;
    const kAdj = Math.max(0, k);
    const bet  = bankroll * kAdj;
    const profit = bet > 0 && bDec ? bet * (bDec - 1) : 0;
    const edge   = bDec ? (norm * bDec - 1) * 100 : -100;
    return { ...c, norm, bDec, bAm, bPlat, k, kAdj, bet, profit, edge };
  }).sort((a, b) => b.norm - a.norm);

  // Total implied probability across active candidates (for overround / arb detection)
  const totalImp = active.reduce((s, c) => {
    const { dec } = getBest(c);
    return s + (dec ? 1 / dec : 0);
  }, 0);

  lastResults = { res: results, bankroll, totalImp, mode };
  renderResults(results, bankroll, totalImp);

  document.getElementById('emptyPanel').style.display = 'none';
  const rw = document.getElementById('resultsWrap');
  rw.style.display = 'flex';
}

// ─────────────────────────────────────────────────────────
// Render results
// ─────────────────────────────────────────────────────────

function renderResults(res, bankroll, totalImp) {
  const tw   = res.reduce((s, r) => s + r.bet, 0);
  const bOn  = res.filter(r => r.bet > 0.01).length;
  const ev   = res.reduce((s, r) => s + r.norm * (r.bet * r.bDec - r.bet) - (1 - r.norm) * r.bet, 0);
  const roi  = tw > 0 ? (ev / tw) * 100 : 0;
  const ovr  = (totalImp - 1) * 100;
  const maxW = res.reduce((m, r) => r.profit > m ? r.profit : m, 0);

  // ── Stats bar ──
  document.getElementById('statsRow').innerHTML = `
    <div class="stat c-green">
      <div class="stat-lbl">Expected EV</div>
      <div class="stat-val green">${ev >= 0 ? '+' : ''}$${ev.toFixed(0)}</div>
      <div class="stat-sub">${roi >= 0 ? '+' : ''}${roi.toFixed(1)}% ROI</div>
    </div>
    <div class="stat c-cyan">
      <div class="stat-lbl">Total Wagered</div>
      <div class="stat-val cyan">$${tw.toFixed(0)}</div>
      <div class="stat-sub">${bOn} of ${res.length} bets placed</div>
    </div>
    <div class="stat c-gold">
      <div class="stat-lbl">Best Win Profit</div>
      <div class="stat-val gold">+$${maxW.toFixed(0)}</div>
      <div class="stat-sub">${esc(res.find(r => r.profit === maxW)?.name || '—')}</div>
    </div>
    <div class="stat c-warn">
      <div class="stat-lbl">Overround</div>
      <div class="stat-val warn">${ovr >= 0 ? '+' : ''}${ovr.toFixed(1)}%</div>
      <div class="stat-sub">${totalImp < 1 ? '⚡ Arb possible' : 'Book margin'}</div>
    </div>
    <div class="stat c-red">
      <div class="stat-lbl">Max Drawdown</div>
      <div class="stat-val red">-$${tw.toFixed(0)}</div>
      <div class="stat-sub">If all bets lose</div>
    </div>
  `;

  // ── Arb banner ──
  document.getElementById('arbBanner').classList.toggle('show', totalImp < 1.0);

  // ── Results meta ──
  document.getElementById('resultsMeta').textContent =
    `${document.getElementById('evName').value || 'Event'} · Full Kelly · ${new Date().toLocaleDateString()}`;

  // ── Table rows ──
  document.getElementById('resultsBody').innerHTML = res.map((r, i) => {
    const rkC  = i === 0 ? 'rk1' : i === 1 ? 'rk2' : i === 2 ? 'rk3' : 'rkn';
    const pct  = (r.norm * 100).toFixed(1);
    const kpct = (r.kAdj * 100).toFixed(2);
    const eCls = r.edge >= 5 ? 'green-txt' : r.edge >= 0 ? 'gold-txt' : 'red-txt';

    const sig    = r.kAdj <= 0 ? (r.edge < 0 ? 'sig-neg' : 'sig-skip') : 'sig-bet';
    const sigTxt = r.kAdj <= 0 ? (r.edge < 0 ? 'NEG EV'  : 'SKIP')    : 'BET';

    const oddsCell = p => {
      const v = r.odds[p];
      if (v === '' || v === null || v === undefined || isNaN(parseFloat(v))) {
        return `<td class="c"><span class="chip na">—</span></td>`;
      }
      const isBest = p === r.bPlat;
      const isAuto = r.autoFilled?.[p];
      const cls    = isBest ? 'best' : isAuto ? 'auto' : '';
      return `<td class="c"><span class="chip ${cls}">${fmtAm(v) || v}</span></td>`;
    };

    return `
      <tr>
        <td><span class="rank ${rkC}">${i + 1}</span></td>
        <td>
          <div class="cname">${esc(r.name || `Candidate ${i + 1}`)}</div>
          <div class="csub ${eCls}">Edge: ${r.edge >= 0 ? '+' : ''}${r.edge.toFixed(1)}%</div>
        </td>
        ${PLATS.map(oddsCell).join('')}
        <td class="r"><span class="mono cyan-txt">${fmtAm(r.bAm) || '—'}</span></td>
        <td class="r"><span class="hint-txt">${r.bPlat ? PLAT_NAMES[r.bPlat] : '—'}</span></td>
        <td class="r">
          <div class="prob-row">
            <span class="mono">${pct}%</span>
            <div class="prob-bar"><div class="prob-fill" style="width:${pct}%"></div></div>
          </div>
        </td>
        <td class="r"><span class="mono ${r.kAdj > 0 ? 'green-txt' : 'red-txt'}">${kpct}%</span></td>
        <td class="r">
          <span class="big-mono" style="color:${r.bet > 0.01 ? 'var(--txt)' : 'var(--txt3)'}">
            ${r.bet > 0.01 ? '$' + r.bet.toFixed(2) : '—'}
          </span>
        </td>
        <td class="r">
          <span class="mono ${r.profit > 0 ? 'green-txt' : 'muted'}">
            ${r.profit > 0 ? '+$' + r.profit.toFixed(2) : '—'}
          </span>
        </td>
        <td class="c"><span class="sig ${sig}">${sigTxt}</span></td>
      </tr>
    `;
  }).join('');

  // ── Summary cards ──
  const excl = candidates.filter(c => c.excluded);
  document.getElementById('summaryGrid').innerHTML = `
    <div class="sum-card">
      <div class="sum-ttl">Setup</div>
      ${srow('Event',    document.getElementById('evName').value  || '—')}
      ${srow('Sport',    document.getElementById('evSport').value)}
      ${srow('Bankroll', '$' + bankroll.toFixed(2))}
      ${srow('Strategy', 'Full Kelly')}
      ${srow('Excluded', excl.length ? excl.map(c => esc(c.name || '?')).join(', ') : 'None')}
    </div>
    <div class="sum-card">
      <div class="sum-ttl">Returns</div>
      ${srow('Total Wagered', '$' + tw.toFixed(2))}
      ${srow('Expected EV',   `<span class="${ev  >= 0 ? 'green-txt' : 'red-txt'}">${ev  >= 0 ? '+' : ''}$${ev.toFixed(2)}</span>`)}
      ${srow('ROI',           `<span class="${roi >= 0 ? 'green-txt' : 'red-txt'}">${roi >= 0 ? '+' : ''}${roi.toFixed(2)}%</span>`)}
      ${srow('Best Win',      `<span class="green-txt">+$${maxW.toFixed(2)}</span>`)}
    </div>
    <div class="sum-card">
      <div class="sum-ttl">Risk</div>
      ${srow('Overround',    `${ovr >= 0 ? '+' : ''}${ovr.toFixed(2)}%`)}
      ${srow('Worst Case',   `<span class="red-txt">-$${tw.toFixed(2)}</span>`)}
      ${srow('Implied Total',`${(totalImp * 100).toFixed(1)}%`)}
      ${srow('Arb?',          totalImp < 1 ? '<span class="green-txt">⚡ Yes</span>' : '<span class="muted">No</span>')}
    </div>
  `;
}

/** Generates a summary row HTML snippet */
function srow(label, value) {
  return `<div class="sum-row"><span class="sum-lbl">${label}</span><span class="sum-val">${value}</span></div>`;
}

// ─────────────────────────────────────────────────────────
// CSV Export (premium only)
// ─────────────────────────────────────────────────────────

function exportCSV() {
  if (!isPrem()) { showPremModal(); return; }
  if (!lastResults) { toast('Calculate first', '⚠️', 't-red'); return; }

  const { res } = lastResults;
  const headers = ['Candidate','DK','FD','BetMGM','Caesars','Polymarket','Kalshi',
                   'Best Odds','Best Book','Win Prob %','Kelly %','Bet $','Profit If Win','Signal'];
  const rows = res.map(r => [
    r.name,
    r.odds.dk || '', r.odds.fd || '', r.odds.mgm || '',
    r.odds.caes || '', r.odds.poly || '', r.odds.kal || '',
    fmtAm(r.bAm) || '',
    r.bPlat ? PLAT_NAMES[r.bPlat] : '',
    (r.norm  * 100).toFixed(1),
    (r.kAdj  * 100).toFixed(2),
    r.bet    > 0.01 ? r.bet.toFixed(2)    : '0',
    r.profit > 0    ? r.profit.toFixed(2) : '0',
    r.kAdj   > 0    ? 'BET' : r.edge < 0 ? 'NEG EV' : 'SKIP'
  ]);

  const csv = [headers, ...rows].map(r => r.map(v => `"${v}"`).join(',')).join('\n');
  const a   = document.createElement('a');
  a.href     = 'data:text/csv;charset=utf-8,' + encodeURIComponent(csv);
  a.download = 'edgefinder-bets.csv';
  a.click();
}

// ─────────────────────────────────────────────────────────
// Sample data
// ─────────────────────────────────────────────────────────

function loadSample() {
  clearAll(false);
  document.getElementById('evName').value  = '2025 Super Bowl Winner';
  document.getElementById('evSport').value = 'NFL';

  const sample = [
    { name:'Kansas City Chiefs',  dk:'+185', fd:'+190', mgm:'+180', caes:'+195', poly:'+200', kal:'+188' },
    { name:'Philadelphia Eagles', dk:'+270', fd:'+265', mgm:'+280', caes:'+260', poly:'+290', kal:'+270' },
    { name:'Buffalo Bills',       dk:'+700', fd:'+720', mgm:'+690', caes:'+710', poly:'+750', kal:'+700' },
    { name:'Baltimore Ravens',    dk:'+850', fd:'+900', mgm:'+830', caes:'+870', poly:'+950', kal:'+860' },
    { name:'Detroit Lions',       dk:'+1100',fd:'+1050',mgm:'+1200',caes:'+1100',poly:'+1150',kal:'+1100'},
    { name:'Field / Other',       dk:'+1800',fd:'+1750',mgm:'+1850',caes:'+1800',poly:'',     kal:''     }
  ];
  sample.forEach(x => addCandidate(x));
  document.getElementById('bankroll').value = '1000';
  toast('Example loaded — hit ⚡ Calculate', '📋', 't-green');
}

// ─────────────────────────────────────────────────────────
// Clear all
// ─────────────────────────────────────────────────────────

function clearAll(resetRight = true) {
  candidates = []; cid = 0;
  document.getElementById('candList').innerHTML = '';
  document.getElementById('evName').value  = '';
  document.getElementById('evDate').value  = '';
  if (resetRight) {
    document.getElementById('emptyPanel').style.display   = '';
    document.getElementById('resultsWrap').style.display  = 'none';
  }
}

// ─────────────────────────────────────────────────────────
// Toast notifications
// ─────────────────────────────────────────────────────────

function toast(msg, ic = '✓', cls = '') {
  const t = document.getElementById('toast');
  t.className = `toast ${cls}`;
  document.getElementById('toastMsg').textContent = msg;
  document.getElementById('toastIc').textContent  = ic;
  t.classList.add('show');
  clearTimeout(t._t);
  t._t = setTimeout(() => t.classList.remove('show'), 3500);
}

// ─────────────────────────────────────────────────────────
// Modal close on backdrop click
// ─────────────────────────────────────────────────────────

document.querySelectorAll('.modal-bg').forEach(m => {
  m.addEventListener('click', e => {
    if (e.target === m) m.classList.remove('open');
  });
});

// ─────────────────────────────────────────────────────────
// HTML escaping utility
// ─────────────────────────────────────────────────────────

function esc(s) {
  return String(s || '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

// ─────────────────────────────────────────────────────────
// Initialise on page load
// ─────────────────────────────────────────────────────────

(function init() {
  // Start with 3 blank candidate rows
  addCandidate();
  addCandidate();
  addCandidate();

  // Render saved bets panel
  renderSaves();
})();
