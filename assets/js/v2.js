/* ============================================================
   v2.js — تطويرات احترافية بدون كسر أي شيء قائم
   - عمود "الصفة / جهة التمثيل" في requests/complaints
   - فلتر الأفراد/الشركات
   - حذف ذكي للعملاء (مع التحقق من الارتباط)
   - مولّد ترقيم ذكي (يعيد استخدام الأرقام المحذوفة)
   - إحصائيات ديناميكية للداشبورد
============================================================ */
(function () {
  'use strict';
  if (window.__V2_LOADED__) return;
  window.__V2_LOADED__ = true;

  function ready(fn) {
    if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', fn);
    else fn();
  }
  function esc(s){ return String(s==null?'':s).replace(/[&<>"']/g, c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c])); }
  function page(){ return (document.body && document.body.getAttribute('data-page')) || ''; }

  /* ============================================================
     1) Representation label + column
     ============================================================ */
  function representationCellHTML(rec, pageKind) {
    const role = rec && rec.role;
    if (role === 'agent') {
      const nm = (rec.agent && rec.agent.name) || '—';
      return `
        <div class="rep-cell">
          <span class="rep-label rep-label--agent">الموكِّل</span>
          <div class="rep-name">${esc(nm)}</div>
        </div>`;
    }
    if (role === 'company') {
      const nm = (rec.company && rec.company.name) || '—';
      const label = pageKind === 'complaints' ? 'مفوض عن جهة/شركة' : 'مفوض عن شركة';
      return `
        <div class="rep-cell">
          <span class="rep-label rep-label--company">${esc(label)}</span>
          <div class="rep-name">${esc(nm)}</div>
        </div>`;
    }
    return `
      <div class="rep-cell">
        <span class="rep-label rep-label--self">مقدم الطلب</span>
        <div class="rep-name muted">—</div>
      </div>`;
  }

  function injectRepresentationStyles() {
    if (document.getElementById('v2-styles')) return;
    const s = document.createElement('style');
    s.id = 'v2-styles';
    s.textContent = `
      .rep-cell{display:flex;flex-direction:column;gap:.25rem;min-width:120px}
      .rep-label{display:inline-block;font-size:10px;font-weight:700;letter-spacing:.02em;
        padding:.15rem .5rem;border-radius:999px;width:fit-content;line-height:1.4}
      .rep-label--self{background:rgba(148,163,184,.12);color:#94a3b8;border:1px solid rgba(148,163,184,.25)}
      .rep-label--agent{background:rgba(168,85,247,.15);color:#d8b4fe;border:1px solid rgba(168,85,247,.35)}
      .rep-label--company{background:rgba(34,211,238,.12);color:#67e8f9;border:1px solid rgba(34,211,238,.35)}
      .rep-name{font-size:12px;font-weight:600;color:#e2e8f0;line-height:1.45}
      .rep-name.muted{color:#64748b;font-weight:500}
    `;
    document.head.appendChild(s);
  }

  function addRepresentationColumn(pageKind) {
    const table = document.querySelector('table');
    if (!table) return;
    const headRow = table.querySelector('thead tr');
    if (!headRow) return;

    // ----- HEAD: insert after "العميل" (index 1) -----
    if (!headRow.querySelector('th[data-v2-rep]')) {
      const th = document.createElement('th');
      th.className = 'px-4 py-3 text-right font-semibold';
      th.setAttribute('data-v2-rep', '1');
      th.textContent = 'الصفة / جهة التمثيل';
      const ref = headRow.children[2] || null; // insert before third (i.e. after العميل)
      headRow.insertBefore(th, ref);
    }

    // ----- BODY: inject cell into each row after re-render -----
    const tbody = document.getElementById('tbody');
    if (!tbody) return;

    function getStateRequests() {
      try {
        if (window.state && Array.isArray(window.state.requests)) return window.state.requests;
        if (window.FX) return pageKind === 'complaints' ? FX.complaints() : FX.requests();
      } catch(_) {}
      return [];
    }

    function injectRows() {
      const rows = tbody.querySelectorAll('tr');
      const recs = getStateRequests();
      rows.forEach(tr => {
        if (tr.querySelector('td[data-v2-rep]')) return;
        const numSpan = tr.querySelector('td:first-child span');
        const num = numSpan ? numSpan.textContent.trim() : '';
        const rec = recs.find(r => r.number === num);
        if (!rec) return;
        const td = document.createElement('td');
        td.className = 'px-4 py-3 align-top';
        td.setAttribute('data-v2-rep', '1');
        td.innerHTML = representationCellHTML(rec, pageKind);
        const ref = tr.children[2] || null;
        tr.insertBefore(td, ref);
      });
    }

    // Wrap renderTable to re-inject after each render
    const wrap = () => {
      const orig = window.renderTable;
      if (typeof orig !== 'function' || orig.__v2Wrapped) return;
      const wrapped = function () {
        const r = orig.apply(this, arguments);
        try { injectRows(); } catch(_) {}
        // notify dashboard
        try { window.dispatchEvent(new CustomEvent('fog:records-changed')); } catch(_) {}
        return r;
      };
      wrapped.__v2Wrapped = true;
      window.renderTable = wrapped;
    };
    wrap();
    // try again shortly in case renderTable defined later
    setTimeout(wrap, 80);
    setTimeout(() => { try { window.renderTable && window.renderTable(); } catch(_){} }, 120);

    // Also observe tbody changes (paginate, filter) — re-inject if needed
    new MutationObserver(() => injectRows()).observe(tbody, { childList: true });
  }

  /* ============================================================
     2) Applicant filter — relabel options
     ============================================================ */
  function patchApplicantFilter() {
    const sel = document.getElementById('fApplicant');
    if (!sel || sel.dataset.v2 === '1') return;
    sel.innerHTML = `
      <option value="">الكل</option>
      <option value="فرد">الأفراد</option>
      <option value="شركة">الشركات</option>
    `;
    sel.dataset.v2 = '1';
  }

  /* ============================================================
     3) Smart sequential number generator
     ============================================================ */
  function installSmartNumbering(prefix) {
    function smartNext() {
      const arr = (window.state && window.state.requests) || [];
      const used = new Set();
      arr.forEach(r => {
        const m = String(r.number || '').match(/(\d+)\s*$/);
        if (m) used.add(parseInt(m[1], 10));
      });
      let n = 1;
      while (used.has(n)) n++;
      try {
        if (window.state) {
          window.state.counter = Math.max(window.state.counter || 0, n);
          if (typeof window.persist === 'function') window.persist();
        }
      } catch(_) {}
      return `${prefix}${String(n).padStart(4, '0')}`;
    }
    window.nextNumber = smartNext;
  }

  /* ============================================================
     4) Customers — smart delete
     ============================================================ */
  function bindCustomerDelete() {
    const root = document.querySelector('#requestsCustomers');
    if (!root) return;
    const tbody = root.querySelector('tbody');
    if (!tbody || tbody.dataset.v2Del === '1') return;
    tbody.dataset.v2Del = '1';

    tbody.addEventListener('click', async (e) => {
      const btn = e.target.closest('.icon-btn.delete');
      if (!btn) return;
      e.preventDefault(); e.stopPropagation();

      if (!window.FX) return;
      const tr = btn.closest('tr');
      if (!tr) return;
      const name  = tr.querySelector('.col-name')?.textContent?.trim().split('\n')[0] || '';
      const phone = (tr.querySelector('.col-phone') || tr.querySelector('.col-comm-phone'))?.textContent?.trim() || '';
      const nid   = (tr.querySelector('.col-nid')   || tr.querySelector('.col-comm-nid'))?.textContent?.trim() || '';
      const reg   = tr.querySelector('.col-reg')?.textContent?.trim() || '';

      // Match against fog.customers
      const all = FX.customers();
      const cand = all.find(c => {
        if (nid && nid !== '-' && c.nid && c.nid === nid) return true;
        if (reg && reg !== '-' && c.commercialRegister && c.commercialRegister === reg) return true;
        if (name && phone && phone !== '-' && c.name === name && c.phone === phone) return true;
        if (name && c.name === name && !c.phone && !phone) return true;
        return false;
      });
      if (!cand) { FX.toast && FX.toast('تعذّر العثور على العميل','e'); return; }

      const req = cand.requestsCount || 0;
      const cmp = cand.complaintsCount || 0;
      if (req > 0 || cmp > 0) {
        FX.toast && FX.toast('لا يمكن حذف هذا العميل لأنه مرتبط بطلبات أو شكاوى حالية.', 'e');
        return;
      }

      const ok = await FX.confirm({
        title: 'حذف العميل',
        message: `سيتم حذف "${cand.name || '—'}" نهائياً. هل تريد المتابعة؟`,
        okText: 'حذف',
        danger: true,
      });
      if (!ok) return;

      const next = all.filter(c => c.id !== cand.id);
      FX.saveCustomers(next);
      try { window.dispatchEvent(new CustomEvent('fog:customers-changed')); } catch(_) {}
      try { window.dispatchEvent(new CustomEvent('fog:records-changed')); } catch(_) {}
      FX.toast && FX.toast('تم حذف العميل');
    }, true); // capture to win over other handlers
  }

  /* ============================================================
     5) Dashboard — dynamic stats
     ============================================================ */
  function updateDashboardStats() {
    if (page() !== 'overview') return;
    if (!window.FX) return;

    const reqs = FX.requests().length;
    const cmps = FX.complaints().length;
    const customers = FX.customers().filter(c => c.role !== 'principal');
    const companies = customers.filter(c => c.type === 'company' || c.companyName).length;
    const individuals = customers.length - companies;

    const cards = document.querySelectorAll('.stats-grid .stat-card');
    cards.forEach(card => {
      const title = card.querySelector('.stat-title')?.textContent?.trim();
      const val = card.querySelector('.stat-value');
      if (!val) return;
      if (title === 'الطلبات')   val.textContent = reqs;
      else if (title === 'الشكاوى') val.textContent = cmps;
      else if (title === 'الأفراد') val.textContent = individuals;
      else if (title === 'الشركات') val.textContent = companies;
    });
  }

  function bindDashboardLive() {
    if (page() !== 'overview') return;
    updateDashboardStats();
    const refresh = () => updateDashboardStats();
    window.addEventListener('fog:customers-changed', refresh);
    window.addEventListener('fog:records-changed', refresh);
    window.addEventListener('storage', (e) => {
      if (!e.key) return;
      if (e.key === 'rms_requests' || e.key === 'cms_complaints' || e.key === 'fog.customers') refresh();
    });
    // poll briefly to catch in-tab record changes from same page (rare)
    setInterval(refresh, 3000);
  }

  /* ============================================================
     Boot
     ============================================================ */
  ready(() => {
    injectRepresentationStyles();
    const p = page();

    if (p === 'requests') {
      patchApplicantFilter();
      addRepresentationColumn('requests');
      installSmartNumbering('REQ-2026-');
    } else if (p === 'complaints') {
      patchApplicantFilter();
      addRepresentationColumn('complaints');
      installSmartNumbering('CMP-2026-');
    } else if (p === 'orders-customers' || p === 'inquiries-customers') {
      // Wait for enhance.js to wire the customers table first
      setTimeout(bindCustomerDelete, 120);
      setTimeout(bindCustomerDelete, 600);
    } else if (p === 'overview') {
      // Wait a tick for FX to initialize
      setTimeout(bindDashboardLive, 60);
    }
  });
})();
