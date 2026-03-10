/**
 * saves.js — EdgeFinder
 *
 * Manages saved bet setups in localStorage with a freemium gate:
 *   - Free users: up to FREE_LIMIT saved setups
 *   - Premium users: unlimited (set ef_premium = '1' in localStorage
 *     after a successful payment, e.g. via a Stripe webhook / redirect)
 *
 * Depends on: app.js (addCandidate, clearAll, candidates, cid, toast)
 */

const FREE_LIMIT = 2;
const PREM_KEY   = 'ef_premium'; // localStorage key — set to '1' to unlock premium

let pendingLoadId = null;

// ─────────────────────────────────────────────────────────
// Storage helpers
// ─────────────────────────────────────────────────────────

function getSaves() {
  try { return JSON.parse(localStorage.getItem('ef_saves') || '[]'); }
  catch { return []; }
}

function setSaves(arr) {
  localStorage.setItem('ef_saves', JSON.stringify(arr));
}

function isPrem() {
  return localStorage.getItem(PREM_KEY) === '1';
}

// ─────────────────────────────────────────────────────────
// Render saved setups list
// ─────────────────────────────────────────────────────────

function renderSaves() {
  const saves = getSaves();
  const prem  = isPrem();

  // Update slot counter in header
  const slotInfo = document.getElementById('slotInfo');
  if (slotInfo) {
    slotInfo.textContent = prem
      ? `${saves.length} saved · ⭐ Premium`
      : `${saves.length} / ${FREE_LIMIT} free slots`;
  }

  const el   = document.getElementById('savesList');
  const gate = document.getElementById('premGate');
  if (!el) return;

  if (!saves.length) {
    el.innerHTML = `
      <div class="saves-empty">
        <div class="saves-empty-icon">📂</div>
        <div class="saves-empty-txt">No saved setups yet.<br>Configure a bet and click 💾 Save Current.</div>
      </div>`;
    if (gate) gate.style.display = 'none';
    return;
  }

  el.innerHTML = `<div class="saves-list">
    ${saves.map(s => `
      <div class="save-card">
        <div class="save-icon">📋</div>
        <div class="save-info">
          <div class="save-name">${esc(s.name)}</div>
          <div class="save-meta">
            ${s.sport || ''} · ${s.candidates?.length || 0} candidates ·
            ${new Date(s.savedAt).toLocaleDateString()}
          </div>
        </div>
        <div class="save-actions">
          <button class="btn btn-ghost btn-xs" onclick="promptLoad('${s.id}', '${esc(s.name)}')">Load</button>
          <button class="btn btn-ghost btn-xs red-txt" onclick="deleteSave('${s.id}')">✕</button>
        </div>
      </div>
    `).join('')}
  </div>`;

  // Show upgrade gate when free limit is reached
  if (gate) gate.style.display = (!prem && saves.length >= FREE_LIMIT) ? 'flex' : 'none';
}

// ─────────────────────────────────────────────────────────
// Save current setup
// ─────────────────────────────────────────────────────────

function saveCurrentBet() {
  if (!isPrem() && getSaves().length >= FREE_LIMIT) {
    showPremModal();
    return;
  }
  // Pre-fill modal with current event name
  document.getElementById('saveName').value = document.getElementById('evName').value || '';
  document.getElementById('saveModal').classList.add('open');
}

function closeSaveModal() {
  document.getElementById('saveModal').classList.remove('open');
}

function confirmSave() {
  const name = document.getElementById('saveName').value.trim();
  if (!name) { toast('Enter a name for this setup', '⚠️', 't-red'); return; }

  const saves = getSaves();
  saves.push({
    id:         Date.now().toString(),
    name,
    sport:      document.getElementById('evSport').value,
    eventName:  document.getElementById('evName').value,
    eventDate:  document.getElementById('evDate').value,
    bankroll:   document.getElementById('bankroll').value,
    probMode:   document.getElementById('probMode').value,
    // Deep-copy candidates so later edits don't mutate the save
    candidates: candidates.map(c => ({
      ...c,
      odds:       { ...c.odds },
      autoFilled: { ...c.autoFilled }
    })),
    savedAt: Date.now()
  });

  setSaves(saves);
  closeSaveModal();
  renderSaves();
  toast(`"${name}" saved!`, '💾', 't-green');
}

// ─────────────────────────────────────────────────────────
// Load a saved setup
// ─────────────────────────────────────────────────────────

function promptLoad(id, name) {
  pendingLoadId = id;
  document.getElementById('loadTitle').textContent = `Load "${name}"?`;
  document.getElementById('loadModal').classList.add('open');
}

function closeLoadModal() {
  document.getElementById('loadModal').classList.remove('open');
  pendingLoadId = null;
}

function confirmLoad() {
  if (!pendingLoadId) return;
  const s = getSaves().find(x => x.id === pendingLoadId);
  if (s) {
    doLoad(s);
    closeLoadModal();
    toast(`Loaded "${s.name}"`, '📂', 't-green');
  }
}

function doLoad(s) {
  clearAll(false);

  // Restore form fields
  document.getElementById('evName').value    = s.eventName  || '';
  document.getElementById('evSport').value   = s.sport      || 'NFL';
  document.getElementById('evDate').value    = s.eventDate  || '';
  document.getElementById('bankroll').value  = s.bankroll   || 1000;
  document.getElementById('probMode').value  = s.probMode   || 'best';

  // Rebuild candidate rows
  candidates.length = 0;
  cid = 0;
  document.getElementById('candList').innerHTML = '';

  (s.candidates || []).forEach(c => {
    addCandidate({
      name:       c.name,
      ...c.odds,
      autoFilled: c.autoFilled || {}
    });
    const last = candidates[candidates.length - 1];
    last.excluded = c.excluded || false;

    if (c.excluded) {
      document.getElementById(`cc-${last.id}`)?.classList.add('excluded');
      const cb  = document.querySelector(`#cc-${last.id} .toggle input`);
      if (cb)  cb.checked = false;
      const lbl = document.querySelector(`#cc-${last.id} .toggle-lbl`);
      if (lbl) lbl.textContent = 'Out';
    }
  });
}

// ─────────────────────────────────────────────────────────
// Delete a saved setup
// ─────────────────────────────────────────────────────────

function deleteSave(id) {
  setSaves(getSaves().filter(s => s.id !== id));
  renderSaves();
  toast('Setup deleted', '🗑', '');
}

// ─────────────────────────────────────────────────────────
// Premium modal
// ─────────────────────────────────────────────────────────

function showPremModal()  { document.getElementById('premModal').classList.add('open');    }
function closePremModal() { document.getElementById('premModal').classList.remove('open'); }

/**
 * Call this function from your payment success callback to unlock premium.
 * e.g. after Stripe checkout completes and redirects back to your site:
 *
 *   localStorage.setItem('ef_premium', '1');
 *   unlockPremium();
 */
function unlockPremium() {
  localStorage.setItem(PREM_KEY, '1');
  closePremModal();
  renderSaves();
  toast('Welcome to Premium! 🎉', '⭐', 't-green');
}

// Wire up the "Upgrade Now" button in the modal
document.addEventListener('DOMContentLoaded', () => {
  const upgradeBtn = document.getElementById('upgradeBtn');
  if (upgradeBtn) {
    upgradeBtn.addEventListener('click', () => {
      // ── PAYMENT INTEGRATION POINT ──────────────────────────────────────────
      // Replace this URL with your Stripe Payment Link or checkout page.
      // After payment, your success page should call:
      //   localStorage.setItem('ef_premium', '1');
      // or use a Stripe webhook to set a server-side session flag.
      //
      // Example: window.location.href = 'https://buy.stripe.com/your_link';
      // ───────────────────────────────────────────────────────────────────────
      toast('Redirecting to checkout…', '✨', 't-green');
      // window.location.href = 'YOUR_STRIPE_PAYMENT_LINK';
    });
  }
});
