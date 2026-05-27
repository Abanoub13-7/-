/* ============================================================
   enhance.js — طبقة تحسين موحّدة
   تعمل بعد تحميل الصفحات الأصلية وتربط بين:
     - حفظ العملاء/الشركات تلقائياً
     - نظام ردود موحّد (جهة الرد = إدارة من إدارات الطلب/الشكوى)
     - إدارة قطاعات وإدارات داخل صفحة الإجراءات
     - عرض الطلبات/الشكاوى المرتبطة بكل عميل
   تعتمد على Store الموجود مسبقاً (assets/js/store.js).
============================================================ */
(function () {
  'use strict';
  if (!window.Store) { console.warn('[enhance] Store غير موجود — جارٍ التخطي'); return; }
  if (window.__FX_LOADED__) return;
  window.__FX_LOADED__ = true;

  /* =====================================================
     1) Store extension — مفاتيح جديدة + Helpers
     ===================================================== */
  const KEYS = {
    customers: 'fog.customers',     // [{id,kind:'individual'|'company',name,phone,nid,reg,address,notes,createdAt}]
    responses: 'fog.responses',     // { [recordKey]: [{id, sector, department, content, attachment:{name,dataUrl,type}, date}] }
    seeded:    'fog.seeded.v2',
  };
  function lsGet(k, fb) { try { const r = localStorage.getItem(k); return r==null?fb:JSON.parse(r); } catch(_) { return fb; } }
  function lsSet(k, v) { try { localStorage.setItem(k, JSON.stringify(v)); } catch(_) {} }
  function uid(p) { return (p||'x_') + Date.now().toString(36) + Math.random().toString(36).slice(2,6); }
  function esc(s) { return String(s==null?'':s).replace(/[&<>"']/g, c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c])); }
  function todayISO() { return new Date().toISOString().slice(0,10); }
  function fmtDT(d) {
    if (!d) return '—';
    try {
      const x = new Date(d);
      return x.toLocaleString('ar-EG', { dateStyle:'medium', timeStyle:'short' });
    } catch (_) { return d; }
  }

  /* تهيئة المفاتيح */
  if (lsGet(KEYS.customers, null) === null) lsSet(KEYS.customers, []);
  if (lsGet(KEYS.responses, null) === null) lsSet(KEYS.responses, {});

  /* ===== Customer schema normalizer =====
     Canonical fog.customers row:
     { id, type:'individual'|'company',
       name, phone, nid, address,
       companyName, commercialRegister,
       representativeName, representativePhone, representativeNid,
       isAgent, principalName, principalNid, agentNum,
       requestsCount, complaintsCount,
       records: [{ type:'request'|'complaint', id, number }],
       createdAt, updatedAt,
       // legacy mirrors kept for compatibility with existing UI/customers.js:
       kind, reg, notes, role,
       _commissionerName, _commissionerNid, _commissionerPhone,
       _principalName, _principalNid, _agentNum }
  */
  function emptyCounters() { return { requestsCount: 0, complaintsCount: 0, records: [] }; }
  function normalizeCustomer(c) {
    c = c || {};
    if (!c.id) c.id = uid('cu_');
    if (!c.createdAt) c.createdAt = Date.now();
    if (!c.type) c.type = (c.kind === 'company') ? 'company' : 'individual';
    c.kind = c.type; // legacy mirror
    c.name = c.name || c.companyName || '';
    c.phone = c.phone || '';
    c.nid = c.nid || '';
    c.address = c.address || '';
    c.companyName = c.companyName || (c.type === 'company' ? c.name : '');
    c.commercialRegister = c.commercialRegister || c.reg || '';
    c.reg = c.commercialRegister; // legacy mirror
    c.representativeName  = c.representativeName  || c._commissionerName  || '';
    c.representativePhone = c.representativePhone || c._commissionerPhone || '';
    c.representativeNid   = c.representativeNid   || c._commissionerNid   || '';
    c._commissionerName  = c.representativeName;
    c._commissionerPhone = c.representativePhone;
    c._commissionerNid   = c.representativeNid;
    c.isAgent = !!c.isAgent || c.role === 'agent';
    c.principalName = c.principalName || c._principalName || '';
    c.principalNid  = c.principalNid  || c._principalNid  || '';
    c.agentNum      = c.agentNum      || c._agentNum      || '';
    c._principalName = c.principalName;
    c._principalNid  = c.principalNid;
    c._agentNum      = c.agentNum;
    c.notes = c.notes || '';
    if (typeof c.requestsCount   !== 'number') c.requestsCount = 0;
    if (typeof c.complaintsCount !== 'number') c.complaintsCount = 0;
    if (!Array.isArray(c.records)) c.records = [];
    return c;
  }

  const FX = {
    /* ----- Customers ----- */
    customers: () => (lsGet(KEYS.customers, []) || []).map(normalizeCustomer),
    saveCustomers: (arr) => lsSet(KEYS.customers, arr),

    /* Smart matcher — dedups by NID / commercial register / phone, scoped by type */
    findCustomer({ type, nid, commercialRegister, reg, phone, name }) {
      const list = FX.customers();
      const cr = commercialRegister || reg || '';
      return list.find(c => {
        if (type && c.type !== type) return false;
        if (type === 'company') {
          if (cr && c.commercialRegister && c.commercialRegister === cr) return true;
          if (name && c.companyName && c.companyName === name) return true;
          return false;
        }
        if (nid && c.nid && c.nid === nid) return true;
        if (!nid && phone && c.phone && c.phone === phone && name && c.name === name) return true;
        return false;
      });
    },

    /* Insert or merge — never duplicates, never overwrites counters/records */
    upsertCustomer(payload) {
      const list = FX.customers();
      const incoming = normalizeCustomer({ ...payload });
      const existing = FX.findCustomer({
        type: incoming.type,
        nid: incoming.nid,
        commercialRegister: incoming.commercialRegister,
        phone: incoming.phone,
        name: incoming.name,
      });
      let cust;
      if (existing) {
        // merge — preserve id/createdAt/counters/records
        const keep = {
          id: existing.id,
          createdAt: existing.createdAt,
          requestsCount: existing.requestsCount,
          complaintsCount: existing.complaintsCount,
          records: existing.records,
        };
        // only overwrite scalar fields when the incoming value is non-empty
        Object.keys(incoming).forEach(k => {
          if (k in keep) return;
          const v = incoming[k];
          if (v === '' || v == null) return;
          existing[k] = v;
        });
        Object.assign(existing, keep, { updatedAt: Date.now() });
        cust = normalizeCustomer(existing);
      } else {
        cust = normalizeCustomer({ ...incoming, updatedAt: Date.now() });
        list.push(cust);
      }
      FX.saveCustomers(list);
      try { window.dispatchEvent(new CustomEvent('fog:customers-changed', { detail: cust })); } catch(_) {}
      return cust;
    },

    /* Attach a record (request/complaint) to a customer, dedup, update counters */
    attachRecord(customerId, recType, rec) {
      if (!customerId || !rec) return;
      const list = FX.customers();
      const c = list.find(x => x.id === customerId);
      if (!c) return;
      normalizeCustomer(c);
      const exists = c.records.find(r => r.type === recType && r.id === rec.id);
      if (!exists) {
        c.records.push({ type: recType, id: rec.id, number: rec.number || '' });
      } else {
        exists.number = rec.number || exists.number;
      }
      c.requestsCount   = c.records.filter(r => r.type === 'request').length;
      c.complaintsCount = c.records.filter(r => r.type === 'complaint').length;
      c.updatedAt = Date.now();
      FX.saveCustomers(list);
      try { window.dispatchEvent(new CustomEvent('fog:customers-changed', { detail: c })); } catch(_) {}
    },

    /* Detach a record from every customer (used on delete) */
    detachRecord(recType, recId) {
      const list = FX.customers();
      let changed = false;
      list.forEach(c => {
        normalizeCustomer(c);
        const before = c.records.length;
        c.records = c.records.filter(r => !(r.type === recType && r.id === recId));
        if (c.records.length !== before) {
          c.requestsCount   = c.records.filter(r => r.type === 'request').length;
          c.complaintsCount = c.records.filter(r => r.type === 'complaint').length;
          c.updatedAt = Date.now();
          changed = true;
        }
      });
      if (changed) {
        FX.saveCustomers(list);
        try { window.dispatchEvent(new CustomEvent('fog:customers-changed')); } catch(_) {}
      }
    },

    /* ----- Responses ----- */
    responseKey: (type, recId) => `${type}:${recId}`,
    responsesFor(type, recId) {
      const all = lsGet(KEYS.responses, {});
      return all[FX.responseKey(type, recId)] || [];
    },
    addResponse(type, recId, payload) {
      const all = lsGet(KEYS.responses, {});
      const key = FX.responseKey(type, recId);
      const row = { id: uid('rs_'), date: new Date().toISOString(), ...payload };
      all[key] = (all[key] || []).concat([row]);
      lsSet(KEYS.responses, all);
      return row;
    },
    deleteResponse(type, recId, rid) {
      const all = lsGet(KEYS.responses, {});
      const key = FX.responseKey(type, recId);
      all[key] = (all[key] || []).filter(r => r.id !== rid);
      lsSet(KEYS.responses, all);
    },
    setResponses(type, recId, arr) {
      const all = lsGet(KEYS.responses, {});
      all[FX.responseKey(type, recId)] = arr;
      lsSet(KEYS.responses, all);
    },

    /* ----- Sectors helpers (re-export) ----- */
    sectors() { return Store.sectors(); },
    saveSectors(obj) { Store.set('fog.sectors', obj); },

    /* ----- Records access ----- */
    requests()   { try { return JSON.parse(localStorage.getItem('rms_requests')   || '[]'); } catch(_) { return []; } },
    complaints() { try { return JSON.parse(localStorage.getItem('cms_complaints') || '[]'); } catch(_) { return []; } },
    saveRequestsLS(arr)   { localStorage.setItem('rms_requests',   JSON.stringify(arr)); },
    saveComplaintsLS(arr) { localStorage.setItem('cms_complaints', JSON.stringify(arr)); },

    esc, uid, fmtDT, todayISO,
  };
  window.FX = FX;

  /* =====================================================
     1b) Sync customers from a saved record
     ===================================================== */
  function syncCustomersFromRecord(rec, recType) {
    if (!rec) return;
    const c = rec.customer || {};
    const role = rec.role || 'self';
    const ids = { customerId: null, principalId: null, companyId: null };

    if (role === 'company') {
      // The company itself is the main customer (filed by company).
      const co = rec.company || {};
      const company = FX.upsertCustomer({
        type: 'company',
        name: co.name || '',
        companyName: co.name || '',
        commercialRegister: co.reg || '',
        phone: c.phone || '',
        address: c.address || '',
        representativeName:  c.name  || '',
        representativeNid:   c.nid   || '',
        representativePhone: c.phone || '',
        notes: c.notes || '',
        sourceType: recType,
      });
      ids.companyId = company.id;
      FX.attachRecord(company.id, recType, rec);
    } else if (role === 'agent') {
      // Presenter is an agent — saved as INDIVIDUAL with isAgent=true
      const agent = FX.upsertCustomer({
        type: 'individual',
        name: c.name || '',
        phone: c.phone || '',
        nid: c.nid || '',
        address: c.address || '',
        notes: c.notes || '',
        isAgent: true,
        principalName: (rec.agent && rec.agent.name) || '',
        principalNid:  (rec.agent && rec.agent.nid)  || '',
        agentNum:      (rec.agent && rec.agent.num)  || '',
        role: 'agent',
        sourceType: recType,
      });
      ids.customerId = agent.id;
      FX.attachRecord(agent.id, recType, rec);

      // Also store the principal as an individual
      if (rec.agent && rec.agent.name) {
        const principal = FX.upsertCustomer({
          type: 'individual',
          name: rec.agent.name,
          nid:  rec.agent.nid || '',
          phone: '',
          address: c.address || '',
          notes: `موكِّل — ينوب عنه: ${c.name || ''} (توكيل ${rec.agent.num||''})`,
          role: 'principal',
          sourceType: recType,
        });
        ids.principalId = principal.id;
        FX.attachRecord(principal.id, recType, rec);
      }
    } else {
      // Self — plain individual
      const ind = FX.upsertCustomer({
        type: 'individual',
        name: c.name || '',
        phone: c.phone || '',
        nid: c.nid || '',
        address: c.address || '',
        notes: c.notes || '',
        role: 'self',
        sourceType: recType,
      });
      ids.customerId = ind.id;
      FX.attachRecord(ind.id, recType, rec);
    }

    // Persist customerId(s) on the record so deletes/edits stay linked
    const dirty = (rec.customerId !== ids.customerId) ||
                  (rec.companyId !== ids.companyId) ||
                  (rec.principalId !== ids.principalId);
    if (dirty) {
      rec.customerId  = ids.customerId;
      rec.companyId   = ids.companyId;
      rec.principalId = ids.principalId;
      const lsKey = recType === 'complaint' ? 'cms_complaints' : 'rms_requests';
      try {
        const arr = JSON.parse(localStorage.getItem(lsKey) || '[]');
        const i = arr.findIndex(r => r.id === rec.id);
        if (i >= 0) {
          arr[i].customerId  = ids.customerId;
          arr[i].companyId   = ids.companyId;
          arr[i].principalId = ids.principalId;
          localStorage.setItem(lsKey, JSON.stringify(arr));
        }
      } catch(_) {}
    }
  }
  FX.syncCustomersFromRecord = syncCustomersFromRecord;

  /* Rebuild fog.customers from the source-of-truth records (requests + complaints).
     Safe to call any time — preserves existing customer ids/scalar fields where possible,
     but always recomputes counters/records from the records arrays. */
  function rebuildCustomersFromRecords() {
    try {
      const list = FX.customers();
      list.forEach(c => { c.records = []; c.requestsCount = 0; c.complaintsCount = 0; });
      FX.saveCustomers(list);
      FX.requests().forEach(r   => syncCustomersFromRecord(r, 'request'));
      FX.complaints().forEach(r => syncCustomersFromRecord(r, 'complaint'));
      try { window.dispatchEvent(new CustomEvent('fog:customers-changed')); } catch(_) {}
    } catch (e) { console.warn('[enhance] rebuildCustomersFromRecords', e); }
  }
  FX.rebuildCustomersFromRecords = rebuildCustomersFromRecords;

  /* =====================================================
     1c) Migration — pull legacy rms_customers/cms_customers
     into fog.customers, and rebuild counters from existing
     requests/complaints. Runs once per schema bump.
     ===================================================== */
  function migrateLegacyAndRebuild() {
    const FLAG = 'fog.customers.migrated.v2';
    if (localStorage.getItem(FLAG) === '1') return;
    try {
      // Pull legacy individual customer rows (best-effort)
      ['rms_customers', 'cms_customers'].forEach(key => {
        let arr; try { arr = JSON.parse(localStorage.getItem(key) || '[]'); } catch(_) { arr = []; }
        if (!Array.isArray(arr)) return;
        arr.forEach(c => {
          if (!c || (!c.name && !c.phone && !c.nid)) return;
          FX.upsertCustomer({
            type: 'individual',
            name: c.name || '', phone: c.phone || '',
            nid: c.nid || '', address: c.address || '', notes: c.notes || '',
          });
        });
      });

      // Reset counters/records then rebuild from records source-of-truth
      const list = FX.customers();
      list.forEach(c => { c.records = []; c.requestsCount = 0; c.complaintsCount = 0; });
      FX.saveCustomers(list);

      FX.requests().forEach(r   => syncCustomersFromRecord(r, 'request'));
      FX.complaints().forEach(r => syncCustomersFromRecord(r, 'complaint'));
    } catch (e) { console.warn('[enhance] migration', e); }
    localStorage.setItem(FLAG, '1');
  }
  migrateLegacyAndRebuild();

  /* =====================================================
     2) UI Helpers — Modal / Toast / Confirm
     ===================================================== */
  let toastWrap;
  function ensureToastWrap() {
    if (toastWrap && document.body.contains(toastWrap)) return toastWrap;
    toastWrap = document.createElement('div');
    toastWrap.className = 'fx-toast-wrap';
    document.body.appendChild(toastWrap);
    return toastWrap;
  }
  function toast(msg, type='s') {
    const w = ensureToastWrap();
    const el = document.createElement('div');
    el.className = 'fx-toast ' + type;
    const ico = type==='s'?'✓':type==='e'?'!':'⚠';
    el.innerHTML = `<span style="width:22px;height:22px;border-radius:99px;display:inline-flex;align-items:center;justify-content:center;font-weight:700;background:rgba(30,107,255,.2);color:#93c5fd">${ico}</span><span>${esc(msg)}</span>`;
    w.appendChild(el);
    setTimeout(()=>{ el.style.opacity='0'; el.style.transition='.25s'; setTimeout(()=>el.remove(),260); }, 2800);
  }
  FX.toast = toast;

  function openModal({ title, body, footer, size='md', onClose }) {
    const back = document.createElement('div');
    back.className = 'fx-backdrop open';
    const sizeCls = size==='sm'?'sm':size==='lg'?'lg':'';
    back.innerHTML = `
      <div class="fx-modal ${sizeCls}">
        <div class="fx-modal__head">
          <h3 class="fx-modal__title">${esc(title||'')}</h3>
          <button class="fx-x" type="button" aria-label="إغلاق">
            <svg width="13" height="13" fill="none" stroke="currentColor" stroke-width="2.4" viewBox="0 0 24 24"><path d="M18 6 6 18M6 6l12 12"/></svg>
          </button>
        </div>
        <div class="fx-modal__body"></div>
        ${footer ? '<div class="fx-modal__foot"></div>' : ''}
      </div>`;
    const bodyEl = back.querySelector('.fx-modal__body');
    if (typeof body === 'string') bodyEl.innerHTML = body;
    else if (body instanceof Node) bodyEl.appendChild(body);
    if (footer) {
      const footEl = back.querySelector('.fx-modal__foot');
      if (typeof footer === 'string') footEl.innerHTML = footer;
      else if (footer instanceof Node) footEl.appendChild(footer);
    }
    function close() {
      back.classList.remove('open');
      setTimeout(()=>{ back.remove(); onClose && onClose(); }, 180);
    }
    back.querySelector('.fx-x').addEventListener('click', close);
    back.addEventListener('click', e => { if (e.target === back) close(); });
    document.body.appendChild(back);
    return { el: back, body: bodyEl, close };
  }
  FX.openModal = openModal;

  function confirmDlg({ title='تأكيد', message='هل أنت متأكد؟', okText='تأكيد', danger=false }) {
    return new Promise(resolve => {
      const modal = openModal({
        title,
        size: 'sm',
        body: `<p style="font-size:.85rem;color:#cbd5e1;line-height:1.8">${esc(message)}</p>`,
        footer: `
          <button class="fx-btn fx-btn-ghost" data-act="cancel">إلغاء</button>
          <button class="fx-btn ${danger?'fx-btn-danger':'fx-btn-primary'}" data-act="ok">${esc(okText)}</button>
        `,
      });
      modal.el.querySelector('[data-act="cancel"]').addEventListener('click', () => { modal.close(); resolve(false); });
      modal.el.querySelector('[data-act="ok"]').addEventListener('click', () => { modal.close(); resolve(true); });
    });
  }
  FX.confirm = confirmDlg;

  /* =====================================================
     3) Page type detection
     ===================================================== */
  function pageType() {
    const t = document.body && document.body.getAttribute('data-page');
    return t || null;
  }
  /* NOTE: Customer sync on save is now done inline inside
     pages/requests.html and pages/complaints.html via:
         FX.detachRecord(type, rec.id);
         FX.syncCustomersFromRecord(rec, type);
     The old saveRequest wrapper + autoSaveFromForm() helper that
     re-read the "latest" record from localStorage have been removed
     to eliminate duplicate syncing and timing hacks. */


  /* =====================================================
     4) Unified Detail / Response modal for records
     ===================================================== */
  function statusBadgeHTML(s) {
    const map = {'تم الرد':'b-replied','لم يتم الرد':'b-pending','استعجال 1':'b-urg1','استعجال 2':'b-urg2'};
    const cls = map[s] || 'b-pending';
    return `<span class="badge ${cls}" style="display:inline-flex;align-items:center;font-size:.7rem;font-weight:600;padding:.25rem .55rem;border-radius:999px">${esc(s||'لم يتم الرد')}</span>`;
  }

  function recordDepartments(rec, recType) {
    // Complaints store departments as [{sector,name}]; requests store sector+departments[string]
    if (Array.isArray(rec.departments) && rec.departments.length) {
      if (typeof rec.departments[0] === 'object' && rec.departments[0]) {
        return rec.departments.map(d => ({ sector: d.sector, name: d.name }));
      }
      // requests style
      return rec.departments.map(name => ({ sector: rec.sector || '', name }));
    }
    return [];
  }

  function recordRow(k, v) {
    return `<div class="fx-row"><span class="fx-row__k">${esc(k)}</span><span class="fx-row__v">${v || '—'}</span></div>`;
  }

  function openRecordDetail(rec, recType) {
    const numLabel = recType==='complaint' ? 'رقم الشكوى' : 'رقم الطلب';
    const titleLabel = recType==='complaint' ? 'القصد من البلاغ' : 'عنوان الطلب';
    const headerLabel = recType==='complaint' ? 'تفاصيل الشكوى' : 'تفاصيل الطلب';
    const depts = recordDepartments(rec, recType);
    const responses = FX.responsesFor(recType, rec.id);
    const status = responses.length ? 'تم الرد' : (rec.status === 'تم الرد' ? 'لم يتم الرد' : (rec.status || 'لم يتم الرد'));

    const deptGroupedHTML = (() => {
      if (!depts.length) return '<div class="fx-empty">لا توجد إدارات محددة.</div>';
      const grp = {};
      depts.forEach(d => { (grp[d.sector||'—'] = grp[d.sector||'—'] || []).push(d.name); });
      return Object.entries(grp).map(([sec, names]) => `
        <div style="margin-bottom:.6rem">
          <div style="font-size:.72rem;color:#c4b5fd;font-weight:700;margin-bottom:.35rem">
            <i class="fa-solid fa-layer-group" style="opacity:.7"></i> ${esc(sec)}
          </div>
          <div class="fx-chip-grp">
            ${names.map(n => `<span class="fx-chip pending" style="cursor:default">${esc(n)}</span>`).join('')}
          </div>
        </div>
      `).join('');
    })();

    const respHTML = (() => {
      if (!responses.length) return '<div class="fx-empty">لم يتم تسجيل أي رد بعد. اضغط <b>تسجيل رد</b> أعلاه.</div>';
      return responses.map(r => `
        <div class="fx-resp-line" data-rid="${esc(r.id)}">
          <div class="fx-resp-line__head">
            <div>
              <div class="fx-resp-line__sec">${esc(r.sector || '—')}</div>
              <div class="fx-resp-line__dept">${esc(r.department || '—')}</div>
            </div>
            <div style="display:flex;gap:.4rem;align-items:center">
              <span class="fx-resp-line__date">${fmtDT(r.date)}</span>
              <button class="fx-x" data-del="${esc(r.id)}" title="حذف الرد">
                <svg width="12" height="12" fill="none" stroke="currentColor" stroke-width="2" viewBox="0 0 24 24"><path d="M3 6h18M8 6V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2m3 0v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6"/></svg>
              </button>
            </div>
          </div>
          <div class="fx-resp-line__body">${esc(r.content || '')}</div>
          ${r.attachment ? `<a class="fx-resp-line__att" download="${esc(r.attachment.name)}" href="${esc(r.attachment.dataUrl)}">
            <i class="fa-solid fa-paperclip"></i> ${esc(r.attachment.name)}
          </a>` : ''}
        </div>
      `).join('');
    })();

    // customer block
    const cust = rec.customer || {};
    const isCompany = rec.role === 'company';
    const isAgent = rec.role === 'agent';

    const body = `
      <div class="fx-grid">
        ${recordRow(numLabel, `<span style="font-family:monospace;color:#1e6bff;font-weight:700">${esc(rec.number||'')}</span>`)}
        ${recordRow('الحالة', statusBadgeHTML(status))}
        ${recordRow('مقدم الطلب', esc(cust.name||'—'))}
        ${recordRow('الهاتف', esc(cust.phone||'—'))}
        ${recordRow(titleLabel, esc(rec.title||'—'))}
        ${recordRow('التصنيف', esc(rec.category||'—'))}
        ${recordRow('تاريخ التقديم', esc(rec.date||'—'))}
        ${recordRow(recType==='complaint' ? 'مستلم الشكوى' : 'مستلم الطلب', esc(rec.recipient||'—'))}
        ${recordRow('الرسوم', rec.fees ? (Number(String(rec.fees).replace(/,/g,''))||0).toLocaleString('en-US')+' ج.م' : '—')}
        ${recordRow('صفة مقدم الطلب', isCompany?'مفوض عن شركة':isAgent?'وكيل عن شخص':'مقدم بنفسه')}
        ${isAgent ? recordRow('بيانات الوكالة', `${esc(rec.agent?.name||'')} · ${esc(rec.agent?.nid||'')} · توكيل ${esc(rec.agent?.num||'')}`) : ''}
        ${isCompany ? recordRow('الشركة', `${esc(rec.company?.name||'')} · سجل ${esc(rec.company?.reg||'')}`) : ''}
        ${recordRow('عدد المرفقات', String((rec.attachments||[]).length))}
      </div>

      ${rec.category && recType==='complaint' ? `<div class="fx-section"><h4 class="fx-section__title"><span class="dot"></span>تفاصيل الشكوى</h4><div style="font-size:.82rem;color:#cbd5e1;line-height:1.85;white-space:pre-wrap">${esc(rec.category)}</div></div>` : ''}
      ${recType==='complaint' && rec.respondent ? `
        <div class="fx-section">
          <h4 class="fx-section__title"><span class="dot"></span>بيانات المشكو في حقه</h4>
          <div class="fx-grid">
            ${recordRow('الاسم', esc(rec.respondent?.name||'—'))}
            ${recordRow('الطرف الثاني', esc(rec.respondent?.second||'—'))}
            ${recordRow('الهاتف', esc(rec.respondent?.phone||'—'))}
            ${recordRow('ملاحظات', esc(rec.respondent?.notes||'—'))}
          </div>
        </div>` : ''}

      <div class="fx-section">
        <h4 class="fx-section__title">
          <span class="dot"></span>الإدارات المختصة
          <span class="count">${depts.length} إدارة</span>
        </h4>
        ${deptGroupedHTML}
      </div>

      <div class="fx-section">
        <h4 class="fx-section__title">
          <span class="dot"></span>الردود
          <span class="count">${responses.length}</span>
          <button class="fx-btn fx-btn-primary" data-act="add-resp" style="margin-right:auto;padding:.4rem .7rem;font-size:.75rem">
            <i class="fa-solid fa-plus"></i> تسجيل رد
          </button>
        </h4>
        <div data-resp-list>${respHTML}</div>
      </div>
    `;

    const modal = openModal({ title: `${headerLabel} · ${rec.number||''}`, body, size: 'lg' });
    const refresh = () => { modal.close(); openRecordDetail(getFreshRecord(rec.id, recType) || rec, recType); };

    modal.el.querySelector('[data-act="add-resp"]').addEventListener('click', () => {
      openResponseModal(rec, recType, refresh);
    });
    modal.el.querySelectorAll('[data-del]').forEach(btn => {
      btn.addEventListener('click', async () => {
        if (!await confirmDlg({ title:'حذف رد', message:'سيتم حذف هذا الرد نهائياً.', okText:'حذف', danger:true })) return;
        FX.deleteResponse(recType, rec.id, btn.getAttribute('data-del'));
        toast('تم حذف الرد');
        // sync status on host page
        syncRecordStatus(rec.id, recType);
        refresh();
      });
    });
  }
  FX.openRecordDetail = openRecordDetail;
  // expose inquiry-customer modal opener (function declaration is hoisted)
  FX.openInquiryCustomerDetail = openInquiryCustomerDetail;

  function getFreshRecord(id, recType) {
    const arr = recType==='complaint' ? FX.complaints() : FX.requests();
    return arr.find(x => x.id === id);
  }

  function syncRecordStatus(recId, recType) {
    const lsKey = recType==='complaint' ? 'cms_complaints' : 'rms_requests';
    let arr; try { arr = JSON.parse(localStorage.getItem(lsKey) || '[]'); } catch(_) { return; }
    const idx = arr.findIndex(r => r.id === recId);
    if (idx < 0) return;
    const responses = FX.responsesFor(recType, recId);
    if (responses.length) arr[idx].status = 'تم الرد';
    else if (arr[idx].status === 'تم الرد') arr[idx].status = 'لم يتم الرد';
    arr[idx].responses = responses.map(r => r.department); // legacy compat
    localStorage.setItem(lsKey, JSON.stringify(arr));
    // trigger re-render if host page exposed renderTable
    if (typeof window.renderTable === 'function') { try { window.renderTable(); } catch(_) {} }
  }

  function openResponseModal(rec, recType, onSaved) {
    const depts = recordDepartments(rec, recType);
    if (!depts.length) { toast('لا توجد إدارات مرتبطة بهذا السجل', 'w'); return; }
    let chosenIdx = 0;
    let attachment = null;

    const body = document.createElement('div');
    body.innerHTML = `
      <div style="margin-bottom:1rem">
        <label class="fx-label">جهة الرد <span class="req">*</span></label>
        <div class="fx-dept-grid" data-dept-list></div>
      </div>
      <div style="margin-bottom:1rem">
        <label class="fx-label">محتوى الرد <span class="req">*</span></label>
        <textarea class="fx-textarea" data-content placeholder="اكتب نص الرد بالكامل..."></textarea>
      </div>
      <div>
        <label class="fx-label">مرفق (اختياري)</label>
        <div class="fx-drop" data-drop>
          <i class="fa-solid fa-cloud-arrow-up" style="font-size:1.4rem;color:#94a3b8"></i>
          <p style="font-size:.78rem;color:#94a3b8;margin:.4rem 0 0">اضغط لاختيار ملف PDF أو صورة</p>
          <input type="file" accept="application/pdf,image/*" hidden data-file>
        </div>
        <div data-attinfo></div>
      </div>
    `;
    const list = body.querySelector('[data-dept-list]');
    function paintList() {
      list.innerHTML = depts.map((d,i) => `
        <div class="fx-dept-opt ${i===chosenIdx?'active':''}" data-i="${i}">
          <span><b>${esc(d.name)}</b></span>
          <small>${esc(d.sector||'')}</small>
          ${i===chosenIdx?'<i class="fa-solid fa-circle-check" style="color:#4ade80"></i>':''}
        </div>
      `).join('');
      list.querySelectorAll('[data-i]').forEach(el => {
        el.addEventListener('click', () => { chosenIdx = +el.getAttribute('data-i'); paintList(); });
      });
    }
    paintList();

    const drop = body.querySelector('[data-drop]');
    const fileInp = body.querySelector('[data-file]');
    const attInfo = body.querySelector('[data-attinfo]');
    drop.addEventListener('click', () => fileInp.click());
    fileInp.addEventListener('change', () => {
      const f = fileInp.files && fileInp.files[0]; if (!f) return;
      if (f.size > 5 * 1024 * 1024) { toast('الحد الأقصى للمرفق 5 ميجا', 'w'); fileInp.value=''; return; }
      const reader = new FileReader();
      reader.onload = () => {
        attachment = { name: f.name, dataUrl: reader.result, type: f.type, size: f.size };
        attInfo.innerHTML = `<span class="fx-file-pill"><i class="fa-solid fa-paperclip"></i> ${esc(f.name)} <button class="fx-x" data-clearatt><svg width="11" height="11" fill="none" stroke="currentColor" stroke-width="2.5" viewBox="0 0 24 24"><path d="M18 6 6 18M6 6l12 12"/></svg></button></span>`;
        attInfo.querySelector('[data-clearatt]').addEventListener('click', () => { attachment = null; fileInp.value=''; attInfo.innerHTML=''; });
      };
      reader.readAsDataURL(f);
    });

    const modal = openModal({
      title: 'تسجيل رد جديد',
      body,
      footer: `
        <button class="fx-btn fx-btn-ghost" data-act="cancel">إلغاء</button>
        <button class="fx-btn fx-btn-primary" data-act="save">حفظ الرد</button>
      `,
    });
    modal.el.querySelector('[data-act="cancel"]').addEventListener('click', () => modal.close());
    modal.el.querySelector('[data-act="save"]').addEventListener('click', () => {
      const content = body.querySelector('[data-content]').value.trim();
      if (!content) { toast('محتوى الرد مطلوب', 'e'); return; }
      const d = depts[chosenIdx];
      FX.addResponse(recType, rec.id, {
        sector: d.sector, department: d.name, content, attachment,
      });
      syncRecordStatus(rec.id, recType);
      toast('تم تسجيل الرد');
      modal.close();
      onSaved && onSaved();
    });
  }
  FX.openResponseModal = openResponseModal;

  /* =====================================================
     5) Host integration — requests / complaints pages
     ===================================================== */
  function integrateRecordPage(recType) {
    // Customer syncing on save is handled directly inside the page's
    // saveRequest() (see requests.html / complaints.html). No wrapper here.

    // Wrap deleteRequest so we detach customer links on delete (keeps counters honest)
    const origDel = window.deleteRequest;
    if (typeof origDel === 'function' && !origDel.__fxWrapped) {
      const wDel = function (id) {
        const r = origDel.apply(this, arguments);
        try { FX.detachRecord(recType, id); } catch(_) {}
        return r;
      };
      wDel.__fxWrapped = true;
      window.deleteRequest = wDel;
    }


    // Wrap viewRequest to open the unified detail modal. Falls back to
    // reading the record directly from localStorage if window.state is
    // stale or out of sync, so the View button can never produce a no-op.
    const origView = window.viewRequest;
    const wView = function (id) {
      let rec = null;
      const arr = (window.state && window.state.requests) || [];
      rec = arr.find(x => x.id === id);
      if (!rec) rec = getFreshRecord(id, recType);
      if (!rec) { toast('تعذّر العثور على السجل', 'e'); return; }
      openRecordDetail(rec, recType);
    };
    wView.__fxWrapped = true;
    window.viewRequest = wView;

    // Hide the legacy "جهات الرد" entry box in the create/edit modal
    const respWrap = document.getElementById('responsesWrap');
    if (respWrap) { respWrap.style.display = 'none'; respWrap.classList.add('hidden'); }
    const origRR = window.renderResponses;
    if (typeof origRR === 'function') {
      window.renderResponses = function () {
        try { origRR.apply(this, arguments); } catch(_) {}
        const w = document.getElementById('responsesWrap');
        if (w) { w.classList.add('hidden'); w.style.display='none'; }
      };
    }

    // Dynamic sector dropdown sync (requests page only)
    if (recType === 'request') {
      const refillSector = () => {
        const sel = document.getElementById('rSector');
        if (!sel) return;
        const cur = (window.state && window.state.form && window.state.form.sector) || sel.value;
        const sectors = FX.sectors();
        const names = Object.keys(sectors);
        sel.innerHTML = '<option value="">— اختر القطاع —</option>' +
          names.map(n => `<option value="${esc(n)}">${esc(n)}</option>`).join('');
        if (cur && names.includes(cur)) sel.value = cur;
      };
      refillSector();
      Store.on('fog.sectors', refillSector);
    }
  }

  /* =====================================================
     6) Sectors / Departments CRUD on actions page
     ===================================================== */
  function mountSectorsManager() {
    const main = document.querySelector('main .content > .max-w-\\[1200px\\]') ||
                 document.querySelector('main .content > div') ||
                 document.querySelector('main .content');
    if (!main) return;

    const wrap = document.createElement('section');
    wrap.className = 'bg-cardBg border border-borderClr rounded-xl overflow-hidden mt-6';
    wrap.innerHTML = `
      <div class="flex items-center justify-between px-4 py-3.5 border-b border-borderClr">
        <h2 class="text-sm font-semibold text-white flex items-center gap-2">
          <span class="w-1.5 h-1.5 rounded-full bg-accentBlue2 shadow-[0_0_10px_#1e6bff]"></span>
          القطاعات والإدارات
          <span class="text-xs text-softText font-normal mr-1" data-sec-count></span>
        </h2>
        <button class="btn btn-primary" data-add-sec>
          <i class="fa-solid fa-plus"></i> إضافة قطاع
        </button>
      </div>
      <div class="p-4" data-sec-body></div>
    `;
    main.appendChild(wrap);

    const body = wrap.querySelector('[data-sec-body]');
    const count = wrap.querySelector('[data-sec-count]');

    function render() {
      const sectors = FX.sectors();
      const names = Object.keys(sectors);
      count.textContent = `(${names.length})`;
      if (!names.length) {
        body.innerHTML = `<div class="fx-empty">لا توجد قطاعات بعد. اضغط <b>إضافة قطاع</b>.</div>`;
        return;
      }
      body.innerHTML = names.map((sec, i) => {
        const depts = sectors[sec] || [];
        return `
          <div class="fx-sec-card" data-sec="${esc(sec)}">
            <div class="fx-sec-card__head" data-toggle>
              <svg class="fx-sec-card__chev" width="14" height="14" fill="none" stroke="currentColor" stroke-width="2" viewBox="0 0 24 24"><path d="m6 9 6 6 6-6"/></svg>
              <span class="fx-sec-card__title">${esc(sec)}</span>
              <span class="fx-sec-card__pill">${depts.length} إدارة</span>
              <div class="fx-dept-actions" onclick="event.stopPropagation()">
                <button class="icon-btn" data-edit-sec="${esc(sec)}" title="تعديل اسم القطاع"><i class="fa-solid fa-pen text-[10px]"></i></button>
                <button class="icon-btn danger" data-del-sec="${esc(sec)}" title="حذف القطاع"><i class="fa-solid fa-trash text-[10px]"></i></button>
              </div>
            </div>
            <div class="fx-sec-card__body">
              ${depts.map((d) => `
                <div class="fx-dept-row">
                  <span class="name">${esc(d)}</span>
                  <div class="fx-dept-actions">
                    <button class="icon-btn" data-edit-dept="${esc(sec)}|${esc(d)}" title="تعديل"><i class="fa-solid fa-pen text-[10px]"></i></button>
                    <button class="icon-btn danger" data-del-dept="${esc(sec)}|${esc(d)}" title="حذف"><i class="fa-solid fa-trash text-[10px]"></i></button>
                  </div>
                </div>
              `).join('') || '<div class="fx-empty" style="padding:.8rem">لا توجد إدارات داخل هذا القطاع.</div>'}
              <button class="fx-btn fx-btn-ghost" data-add-dept="${esc(sec)}" style="margin-top:.7rem">
                <i class="fa-solid fa-plus"></i> إضافة إدارة
              </button>
            </div>
          </div>
        `;
      }).join('');

      body.querySelectorAll('[data-toggle]').forEach(h => {
        h.addEventListener('click', () => h.parentElement.classList.toggle('open'));
      });
      body.querySelectorAll('[data-edit-sec]').forEach(b => b.addEventListener('click', () => editSector(b.getAttribute('data-edit-sec'))));
      body.querySelectorAll('[data-del-sec]').forEach(b => b.addEventListener('click', () => deleteSector(b.getAttribute('data-del-sec'))));
      body.querySelectorAll('[data-add-dept]').forEach(b => b.addEventListener('click', () => addDept(b.getAttribute('data-add-dept'))));
      body.querySelectorAll('[data-edit-dept]').forEach(b => b.addEventListener('click', () => {
        const [sec, d] = b.getAttribute('data-edit-dept').split('|'); editDept(sec, d);
      }));
      body.querySelectorAll('[data-del-dept]').forEach(b => b.addEventListener('click', () => {
        const [sec, d] = b.getAttribute('data-del-dept').split('|'); deleteDept(sec, d);
      }));
    }

    function promptText({ title, label, initial='', okText='حفظ' }) {
      return new Promise(resolve => {
        const body = document.createElement('div');
        body.innerHTML = `<label class="fx-label">${esc(label)}</label><input class="fx-input" data-v value="${esc(initial)}" maxlength="120">`;
        const modal = openModal({
          title, body, size:'sm',
          footer: `<button class="fx-btn fx-btn-ghost" data-act="cancel">إلغاء</button><button class="fx-btn fx-btn-primary" data-act="ok">${esc(okText)}</button>`,
        });
        const inp = body.querySelector('[data-v]');
        setTimeout(()=>inp.focus(),60);
        modal.el.querySelector('[data-act="cancel"]').addEventListener('click', () => { modal.close(); resolve(null); });
        modal.el.querySelector('[data-act="ok"]').addEventListener('click', () => {
          const v = inp.value.trim(); modal.close(); resolve(v || null);
        });
        inp.addEventListener('keydown', e => { if (e.key==='Enter') modal.el.querySelector('[data-act="ok"]').click(); });
      });
    }

    async function addSector() {
      const name = await promptText({ title:'إضافة قطاع', label:'اسم القطاع' });
      if (!name) return;
      const sectors = FX.sectors();
      if (sectors[name]) return toast('هذا القطاع موجود مسبقاً', 'e');
      sectors[name] = [];
      FX.saveSectors(sectors); toast('تم إضافة القطاع'); render();
    }
    async function editSector(old) {
      const name = await promptText({ title:'تعديل اسم القطاع', label:'اسم القطاع', initial:old });
      if (!name || name === old) return;
      const sectors = FX.sectors();
      if (sectors[name]) return toast('الاسم مستخدم بالفعل', 'e');
      const ordered = {};
      Object.keys(sectors).forEach(k => { ordered[k===old?name:k] = sectors[k]; });
      FX.saveSectors(ordered); toast('تم التعديل'); render();
    }
    async function deleteSector(name) {
      if (!await confirmDlg({ title:'حذف قطاع', message:`سيتم حذف "${name}" وكل إداراته. هل تريد المتابعة؟`, okText:'حذف', danger:true })) return;
      const sectors = FX.sectors();
      delete sectors[name];
      FX.saveSectors(sectors); toast('تم الحذف'); render();
    }
    async function addDept(sec) {
      const name = await promptText({ title:`إضافة إدارة إلى ${sec}`, label:'اسم الإدارة' });
      if (!name) return;
      const sectors = FX.sectors();
      sectors[sec] = sectors[sec] || [];
      if (sectors[sec].includes(name)) return toast('الإدارة موجودة بالفعل', 'e');
      sectors[sec].push(name);
      FX.saveSectors(sectors); toast('تم الإضافة'); render();
    }
    async function editDept(sec, old) {
      const name = await promptText({ title:'تعديل الإدارة', label:'اسم الإدارة', initial:old });
      if (!name || name === old) return;
      const sectors = FX.sectors();
      const i = (sectors[sec]||[]).indexOf(old);
      if (i < 0) return;
      if (sectors[sec].includes(name)) return toast('الاسم مستخدم', 'e');
      sectors[sec][i] = name;
      FX.saveSectors(sectors); toast('تم التعديل'); render();
    }
    async function deleteDept(sec, d) {
      if (!await confirmDlg({ title:'حذف إدارة', message:`سيتم حذف "${d}".`, okText:'حذف', danger:true })) return;
      const sectors = FX.sectors();
      sectors[sec] = (sectors[sec]||[]).filter(x => x !== d);
      FX.saveSectors(sectors); toast('تم الحذف'); render();
    }

    wrap.querySelector('[data-add-sec]').addEventListener('click', addSector);
    Store.on('fog.sectors', render);
    render();
  }

  /* =====================================================
     7) Customers page integration
     ===================================================== */
  function integrateCustomersPage() {
    const root = document.querySelector('#requestsCustomers, #inquiriesCustomers');
    if (!root) return;
    const isInquiries = !!document.querySelector('#inquiriesCustomers');

    // Always rebuild customers from records when opening the orders/complaints
    // customers page, so any legacy/missed records get reflected immediately.
    // rebuildCustomersFromRecords() fires fog:customers-changed which already
    // triggers CustomersSection.refresh() — no extra loadCustomersFromStore call needed.
    if (!isInquiries) {
      try { rebuildCustomersFromRecords(); }
      catch (e) { console.warn('[enhance] customers rebuild on open', e); }
    }


    // Add View handler via event delegation on tbody
    const tbody = root.querySelector('tbody');
    if (!tbody) return;
    tbody.addEventListener('click', (e) => {
      const btn = e.target.closest('.icon-btn.view');
      if (!btn) return;
      const tr = btn.closest('tr');
      if (!tr) return;
      const name  = tr.querySelector('.col-name')?.textContent?.trim();
      const phone = (tr.querySelector('.col-phone') || tr.querySelector('.col-comm-phone'))?.textContent?.trim();
      const nid   = (tr.querySelector('.col-nid')   || tr.querySelector('.col-comm-nid'))?.textContent?.trim();
      const reg   = tr.querySelector('.col-reg')?.textContent?.trim();
      const commissionerName = tr.querySelector('.col-comm-name')?.textContent?.trim();
      if (isInquiries) {
        openInquiryCustomerDetail({ name, phone, nid, reg });
      } else {
        openCustomerDetailByLookup({ name, phone, nid, reg, commissionerName });
      }
    });
  }

  function openInquiryCustomerDetail(lookup) {
    const body = document.createElement('div');
    body.innerHTML = `
      <div class="fx-section" style="margin-top:0">
        <h4 class="fx-section__title"><span class="dot"></span>بيانات العميل</h4>
        <div class="fx-grid">
          ${recordRow('الاسم', esc(lookup.name||'—'))}
          ${recordRow('الهاتف', esc(lookup.phone||'—'))}
          ${recordRow('الرقم القومي', esc(lookup.nid||'—'))}
          ${recordRow('السجل التجاري', esc(lookup.reg||'—'))}
        </div>
      </div>
      <div class="fx-section">
        <h4 class="fx-section__title"><span class="dot"></span>الزيارات والاستعلامات</h4>
        <div class="fx-empty">لا توجد سجلات زيارات بعد — سيتم تفعيل هذا القسم لاحقاً.</div>
      </div>
    `;
    openModal({ title: 'تفاصيل العميل (استعلامات)', body, size: 'lg' });
  }

  function findRelatedRecords({ name, phone, nid, reg }) {
    function match(rec) {
      const c = rec.customer || {};
      const co = rec.company || {};
      const ag = rec.agent || {};
      if (nid && nid !== '-' && (c.nid === nid || ag.nid === nid)) return true;
      if (reg && reg !== '-' && co.reg === reg) return true;
      if (name && name !== '-' && (c.name === name || co.name === name || ag.name === name)) return true;
      if (phone && phone !== '-' && c.phone === phone) return true;
      return false;
    }
    const reqs = FX.requests().filter(match);
    const cmps = FX.complaints().filter(match);
    return { reqs, cmps };
  }

  function openCustomerDetailByLookup(lookup) {
    const { reqs, cmps } = findRelatedRecords(lookup);

    const body = document.createElement('div');
    body.innerHTML = `
      <div class="fx-section" style="margin-top:0">
        <h4 class="fx-section__title"><span class="dot"></span>بيانات العميل</h4>
        <div class="fx-grid">
          ${recordRow('الاسم', esc(lookup.name||'—'))}
          ${recordRow('الهاتف', esc(lookup.phone||'—'))}
          ${recordRow('الرقم القومي', esc(lookup.nid||'—'))}
          ${recordRow('السجل التجاري', esc(lookup.reg||'—'))}
        </div>
      </div>

      <div class="fx-tabs" style="margin-top:1rem">
        <div class="fx-tab active" data-tab="req"><span class="badge">${reqs.length}</span> الطلبات</div>
        <div class="fx-tab" data-tab="cmp"><span class="badge">${cmps.length}</span> الشكاوى</div>
      </div>

      <div data-tab-body class="fx-mini-list"></div>
    `;
    const tabBody = body.querySelector('[data-tab-body]');

    function renderTab(which) {
      const items = which==='cmp' ? cmps : reqs;
      const recType = which==='cmp' ? 'complaint' : 'request';
      if (!items.length) {
        tabBody.innerHTML = `<div class="fx-empty">${which==='cmp'?'لا توجد شكاوى مرتبطة.':'لا توجد طلبات مرتبطة.'}</div>`;
        return;
      }
      tabBody.innerHTML = items.map(r => {
        const responses = FX.responsesFor(recType, r.id);
        const status = responses.length ? 'تم الرد' : (r.status || 'لم يتم الرد');
        return `
          <div class="fx-mini-item" data-rid="${esc(r.id)}">
            <div class="fx-mini-item__main">
              <span class="fx-mini-item__num">${esc(r.number||'')}</span>
              <div class="fx-mini-item__title">${esc(r.title||'')}</div>
              <div class="fx-mini-item__meta">${esc(r.date||'—')} · ${esc(r.category||'')}</div>
            </div>
            <div>${statusBadgeHTML(status)}</div>
          </div>
        `;
      }).join('');
      tabBody.querySelectorAll('[data-rid]').forEach(el => {
        el.addEventListener('click', () => {
          const rec = items.find(x => x.id === el.getAttribute('data-rid'));
          if (rec) openRecordDetail(rec, recType);
        });
      });
    }
    renderTab('req');

    body.querySelectorAll('.fx-tab').forEach(t => {
      t.addEventListener('click', () => {
        body.querySelectorAll('.fx-tab').forEach(x => x.classList.remove('active'));
        t.classList.add('active');
        renderTab(t.getAttribute('data-tab'));
      });
    });

    openModal({ title: 'تفاصيل العميل', body, size: 'lg' });
  }

  /* =====================================================
     8) Seed (one-shot) — لإضافة بيانات تجريبية مترابطة
     ===================================================== */
  function seedDemoIfNeeded() {
    if (localStorage.getItem(KEYS.seeded) === '1') return;
    // seed only if no user data yet
    const hasReqs = FX.requests().length > 0;
    const hasCmps = FX.complaints().length > 0;
    if (hasReqs || hasCmps) { lsSet(KEYS.seeded, '1'); return; }

    const sectors = FX.sectors();
    const secNames = Object.keys(sectors);
    if (!secNames.length) return;

    const cust = [
      { name:'أحمد محمد علي', phone:'01012345678', nid:'29001011234567', address:'القاهرة' },
      { name:'سمير عبدالله',  phone:'01112233445', nid:'28805056677889', address:'الجيزة' },
      { name:'فاطمة الزهراء', phone:'01099887766', nid:'29611054433221', address:'الإسكندرية' },
    ];
    const company = { name:'شركة النيل للمقاولات', reg:'123456', phone:'01098667288', address:'المنصورة' };

    cust.forEach(c => FX.upsertCustomer({ kind:'individual', ...c, notes:'' , sourceType:'request'}));
    FX.upsertCustomer({ kind:'company', ...company, nid:'', notes:'', sourceType:'request' });

    const requests = [];
    const reqsRaw = FX.requests();
    let counter = parseInt(localStorage.getItem('cms_counter') || '0', 10) || 0;
    function nextNum() { counter++; localStorage.setItem('cms_counter', String(counter)); return 'REQ-' + String(counter).padStart(4, '0'); }

    const sec1 = secNames[0]; const sec2 = secNames[1] || sec1;
    const dep1 = (sectors[sec1]||[])[0] || 'إدارة عامة';
    const dep2 = (sectors[sec2]||[])[0] || 'إدارة عامة';

    requests.push({
      id: 'r_seed1', number: nextNum(), createdAt: Date.now()-86400000,
      customer: cust[0], role:'self', agent:{name:'',nid:'',num:''}, company:{name:'',reg:'',tax:null},
      title: 'استكمال إجراءات تقنين قطعة أرض', category: 'استكمال إجراءات التقنين',
      date: FX.todayISO(), fees:'250000', status:'لم يتم الرد',
      responses:[], sector: sec1, departments:[dep1], attachments:[],
    });
    requests.push({
      id: 'r_seed2', number: nextNum(), createdAt: Date.now()-43200000,
      customer: { id:uid('c_'), name: company.name, phone: company.phone, nid:'', address: company.address, notes:'' },
      role:'company', agent:{name:'',nid:'',num:''},
      company:{ name: company.name, reg: company.reg, tax:null },
      title:'طلب تخصيص قطعة أرض صناعية', category:'طلب التخصيص',
      date: FX.todayISO(), fees:'1750000', status:'استعجال 1',
      responses:[], sector: sec2, departments:[dep2], attachments:[],
    });
    localStorage.setItem('rms_requests', JSON.stringify(requests));

    // complaints (use departments-with-sector style)
    const complaints = [];
    complaints.push({
      id:'cm_seed1', number:'CMP-0001', createdAt: Date.now()-60000,
      customer: cust[1], role:'self', agent:{name:'',nid:'',num:''}, company:{name:'',reg:'',tax:null},
      respondent:{ name:'جار سابق', second:'', phone:'', notes:'' },
      title:'شكوى على تجاوزات بناء بجوار الأرض',
      category:'تفاصيل الشكوى تشمل ضرورة المعاينة الميدانية والتنسيق مع الإدارة المختصة.',
      date: FX.todayISO(), fees:'', status:'لم يتم الرد',
      responses:[], departments:[{sector:sec1,name:dep1},{sector:sec2,name:dep2}], attachments:[],
    });
    localStorage.setItem('cms_complaints', JSON.stringify(complaints));

    // demo response on first complaint
    FX.addResponse('complaint', 'cm_seed1', {
      sector: sec1, department: dep1,
      content: 'تم استلام الشكوى وتم تكليف فريق المعاينة.', attachment: null,
    });
    syncRecordStatus('cm_seed1', 'complaint');

    // Link seeded records to customers (counters/records[])
    try {
      FX.requests().forEach(r   => syncCustomersFromRecord(r, 'request'));
      FX.complaints().forEach(r => syncCustomersFromRecord(r, 'complaint'));
    } catch(_) {}
    lsSet(KEYS.seeded, '1');
  }

  /* =====================================================
     9) Boot — أوصِل الكل بعد تحميل DOM وسكربتات الصفحة
     ===================================================== */
  function boot() {
    const page = pageType();

    // run seed early (depends on Store sectors defaults)
    try { seedDemoIfNeeded(); } catch (e) { console.warn('[enhance] seed', e); }

    // If seed inserted records but the page already loaded its in-memory
    // state from localStorage (empty), re-sync that state so the table is
    // not empty and View/Edit buttons have records to act on.
    function syncPageStateFromLS() {
      try {
        const lsKey = page === 'complaints' ? 'cms_complaints'
                    : page === 'requests'   ? 'rms_requests' : null;
        if (!lsKey || !window.state) return;
        const fresh = JSON.parse(localStorage.getItem(lsKey) || '[]');
        if (Array.isArray(fresh) && fresh.length && Array.isArray(window.state.requests)
            && fresh.length !== window.state.requests.length) {
          window.state.requests = fresh;
          if (typeof window.renderTable === 'function') { try { window.renderTable(); } catch(_){} }
        }
      } catch(_) {}
    }

    // small delay so the page's own script (which runs after Store) finishes its init
    setTimeout(() => {
      syncPageStateFromLS();
      if (page === 'requests')          integrateRecordPage('request');
      else if (page === 'complaints')   integrateRecordPage('complaint');
      else if (page === 'actions')      mountSectorsManager();
      else if (page === 'orders-customers' || page === 'inquiries-customers') {
        integrateCustomersPage();
      }
    }, 50);
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', boot);
  } else {
    boot();
  }
})();
