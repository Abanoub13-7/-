/* ============================================================
   إدارة قسمَي "عملاء الطلبات/الشكاوى" و "عملاء الاستعلامات"
   - Module pattern + class CustomersSection
   - فصل: data / render / filter / search
============================================================ */

/* ============= بيانات حقيقية فقط — تُقرأ مباشرة من FX/Store =============
   IMPORTANT: لا نستخدم window.requestsCustomers / window.inquiriesCustomers
   لأن المتصفح يعرض عناصر DOM ذات الـ id بنفس الاسم على window تلقائيًا
   (named element access)، فيصير الاسم HTMLElement بدل Array ويفشل push.
   لذلك نستخدم متغيرات مستقلة. */
const requestsCustomersData  = [];
const inquiriesCustomersData = [];

function loadCustomersFromStore() {
  if (!window.FX || typeof FX.customers !== 'function') return;
  let stored = FX.customers() || [];

  // Fallback: if customers list is empty but records exist, rebuild from records.
  if (!stored.length && typeof FX.rebuildCustomersFromRecords === 'function') {
    const hasReqs = (FX.requests && FX.requests().length) || 0;
    const hasCmps = (FX.complaints && FX.complaints().length) || 0;
    if (hasReqs || hasCmps) {
      try { FX.rebuildCustomersFromRecords(); } catch(_) {}
      stored = FX.customers() || [];
    }
  }

  // Hide pure "principal" placeholder rows — they appear via the agent row.
  const visible = stored.filter(c => c.role !== 'principal');
  const rows = visible.map(c => ({
    _id: c.id,
    type: c.type === 'company' ? 'company' : 'individual',
    name: c.name || c.companyName || '',
    phone: c.phone || '',
    nid: c.nid || '-',
    address: c.address || '-',
    registry: c.commercialRegister || c.reg || '-',
    notes: c.notes || '-',
    commissionerName:  c.representativeName  || '',
    commissionerPhone: c.representativePhone || c.phone || '',
    commissionerNid:   c.representativeNid   || '',
    principalName:     c.principalName       || '',
    principalNid:      c.principalNid        || '',
    agentNum:          c.agentNum            || '',
    isAgent:           !!c.isAgent,
    requestsCount:     c.requestsCount   || 0,
    complaintsCount:   c.complaintsCount || 0,
    recordsCount:      (c.requestsCount || 0) + (c.complaintsCount || 0),
  }));
  requestsCustomersData.length  = 0;
  inquiriesCustomersData.length = 0;
  rows.forEach(r => { requestsCustomersData.push(r); inquiriesCustomersData.push(r); });
}
window.loadCustomersFromStore = loadCustomersFromStore;

/* ============= Highlight helper ============= */
function escapeHtml(s) {
  return String(s).replace(/[&<>"']/g, c => ({
    '&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'
  }[c]));
}
function highlight(text, query) {
  const safe = escapeHtml(text ?? '');
  if (!query) return safe;
  const q = query.trim();
  if (!q) return safe;
  const re = new RegExp('(' + q.replace(/[.*+?^${}()|[\]\\]/g, '\\$&') + ')', 'gi');
  return safe.replace(re, '<mark class="hl">$1</mark>');
}

/* ============= Animated counter ============= */
function animateCounter(el, target) {
  const start = parseInt(el.dataset.current || '0', 10) || 0;
  if (start === target) { el.textContent = target; return; }
  const duration = 380;
  const t0 = performance.now();
  const tick = (now) => {
    const p = Math.min(1, (now - t0) / duration);
    const val = Math.round(start + (target - start) * (1 - Math.pow(1 - p, 3)));
    el.textContent = val;
    if (p < 1) requestAnimationFrame(tick);
    else el.dataset.current = String(target);
  };
  requestAnimationFrame(tick);
}

/* ============= Debounce ============= */
function debounce(fn, ms) {
  let t;
  return (...a) => { clearTimeout(t); t = setTimeout(() => fn(...a), ms); };
}

/* ============= Class ============= */
class CustomersSection {
  constructor(rootSelector, data) {
    this.root = document.querySelector(rootSelector);
    if (!this.root) return;
    this.data = data;
    this.activeTab = 'individual';
    this.query = '';

    // refs
    this.tabsEl     = this.root.querySelector('.tabs');
    this.indicator  = this.root.querySelector('.tab-indicator');
    this.tabBtns    = this.root.querySelectorAll('.tab-btn');
    this.countEls   = {
      individual: this.root.querySelector('[data-count="individual"]'),
      company:    this.root.querySelector('[data-count="company"]'),
    };
    this.searchBox  = this.root.querySelector('.search-box');
    this.searchInp  = this.root.querySelector('.search-box input');
    this.clearBtn   = this.root.querySelector('.search-box .clear-btn');
    this.tableWrap  = this.root.querySelector('.table-wrap');
    this.tbody      = this.root.querySelector('tbody');

    this.bind();
    this.refresh = () => {
      loadCustomersFromStore();
      this.updateCounts();
      this.render();
    };
    // Live refresh whenever customers store changes
    window.addEventListener('fog:customers-changed', () => this.refresh());
    window.addEventListener('storage', (e) => { if (e.key === 'fog.customers') this.refresh(); });
    this.updateCounts();
    this.render();
    // ضع المؤشر بعد paint للحصول على القياسات الصحيحة
    requestAnimationFrame(() => this.moveIndicator(true));
    window.addEventListener('resize', debounce(() => this.moveIndicator(), 120));
  }

  bind() {
    this.tabBtns.forEach(btn => {
      btn.addEventListener('click', () => {
        if (btn.classList.contains('active')) return;
        this.tabBtns.forEach(b => b.classList.remove('active'));
        btn.classList.add('active');
        this.activeTab = btn.dataset.tab;
        this.moveIndicator();
        this.renderWithFade();
      });
    });

    const onInput = debounce(() => {
      this.query = this.searchInp.value.trim();
      this.searchBox.classList.toggle('has-value', !!this.query);
      this.render();
    }, 90);
    this.searchInp.addEventListener('input', onInput);

    this.clearBtn.addEventListener('click', () => {
      this.searchInp.value = '';
      this.query = '';
      this.searchBox.classList.remove('has-value');
      this.searchInp.focus();
      this.render();
    });
  }

  moveIndicator(instant = false) {
    const active = this.root.querySelector('.tab-btn.active');
    if (!active || !this.indicator) return;
    const parentRect = this.tabsEl.getBoundingClientRect();
    const rect = active.getBoundingClientRect();
    if (instant) this.indicator.style.transition = 'none';
    this.indicator.style.width = rect.width + 'px';
    // RTL: المسافة من يمين الـ container
    this.indicator.style.right = (parentRect.right - rect.right) + 'px';
    if (instant) {
      // فرض إعادة الحساب ثم إعادة الانتقال
      void this.indicator.offsetWidth;
      this.indicator.style.transition = '';
    }
  }

  filter() {
    const q = this.query.toLowerCase();
    return this.data.filter(c => {
      if (c.type !== this.activeTab) return false;
      if (!q) return true;
      return (c.name && c.name.toLowerCase().includes(q)) ||
             (c.phone && c.phone.toLowerCase().includes(q));
    });
  }

  updateCounts() {
    const ind = this.data.filter(c => c.type === 'individual').length;
    const com = this.data.filter(c => c.type === 'company').length;
    if (this.countEls.individual) animateCounter(this.countEls.individual, ind);
    if (this.countEls.company)    animateCounter(this.countEls.company, com);
  }

  renderWithFade() {
    this.tbody.classList.add('is-leaving');
    setTimeout(() => {
      this.render();
      this.tbody.classList.remove('is-leaving');
    }, 180);
  }

  render() {
    const rows = this.filter();

    if (rows.length === 0) {
      this.renderEmpty();
      return;
    }

    // إزالة empty لو موجود
    const empty = this.tableWrap.querySelector('.empty-state');
    if (empty) empty.remove();
    const scroll = this.tableWrap.querySelector('.table-scroll');
    if (scroll) scroll.style.display = '';

    // إعادة رسم رؤوس الأعمدة حسب التبويب النشط
    this.renderHead();

    const frag = document.createDocumentFragment();
    rows.forEach((c, i) => {
      const tr = document.createElement('tr');
      tr.style.animationDelay = Math.min(i * 28, 350) + 'ms';
      const isComp = c.type === 'company';
      const badge = isComp
        ? '<span class="badge badge-company"><i class="fa-solid fa-building"></i> شركة</span>'
        : '<span class="badge badge-individual"><i class="fa-solid fa-user"></i> فرد</span>';
      const actionsTd = `
        <td data-label="النوع">${badge}</td>
        <td data-label="إجراءات">
          <div class="row-actions">
            <button class="icon-btn view" title="عرض" aria-label="عرض"><i class="fa-solid fa-eye"></i></button>
            <button class="icon-btn edit" title="تعديل" aria-label="تعديل"><i class="fa-solid fa-pen-to-square"></i></button>
            <button class="icon-btn delete" title="حذف" aria-label="حذف"><i class="fa-solid fa-trash-can"></i></button>
          </div>
        </td>
      `;
      const countsPill = `
        <div class="counts-pill" style="display:inline-flex;gap:.4rem;align-items:center;flex-wrap:wrap">
          <span class="badge badge-individual" title="عدد الطلبات" style="background:rgba(30,107,255,.15);border:1px solid rgba(30,107,255,.35);color:#93c5fd">
            <i class="fa-solid fa-file-lines"></i> ${c.requestsCount}
          </span>
          <span class="badge badge-company" title="عدد الشكاوى" style="background:rgba(244,114,182,.15);border:1px solid rgba(244,114,182,.35);color:#f9a8d4">
            <i class="fa-solid fa-triangle-exclamation"></i> ${c.complaintsCount}
          </span>
        </div>`;
      if (isComp) {
        tr.innerHTML = `
          <td class="col-idx" data-label="#">${i + 1}</td>
          <td class="col-name" data-label="اسم الشركة">${highlight(c.name, this.query)}</td>
          <td class="col-reg" data-label="السجل التجاري">${escapeHtml(c.registry || '-')}</td>
          <td class="col-comm-name" data-label="المفوض عنها">${escapeHtml(c.commissionerName || '-')}</td>
          <td class="col-comm-phone" data-label="رقم الهاتف">${highlight(c.commissionerPhone || '-', this.query)}</td>
          <td class="col-comm-nid" data-label="الرقم القومي">${escapeHtml(c.commissionerNid || '-')}</td>
          <td class="col-addr" data-label="العنوان">${escapeHtml(c.address || '-')}</td>
          <td class="col-counts" data-label="الطلبات/الشكاوى">${countsPill}</td>
          ${actionsTd}
        `;
      } else {
        const agentBadge = c.isAgent
          ? `<div class="mt-1" style="margin-top:.25rem">
               <span class="badge badge-company" style="background:rgba(168,85,247,.15);border:1px solid rgba(168,85,247,.35);color:#d8b4fe">
                 <i class="fa-solid fa-user-tie"></i> وكيل
               </span>
               ${c.principalName ? `<div class="text-[11px]" style="font-size:11px;color:#94a3b8;margin-top:.2rem">عن: ${escapeHtml(c.principalName)}</div>` : ''}
             </div>`
          : '';
        tr.innerHTML = `
          <td class="col-idx" data-label="#">${i + 1}</td>
          <td class="col-name" data-label="الاسم">${highlight(c.name, this.query)}${agentBadge}</td>
          <td class="col-phone" data-label="رقم الهاتف">${highlight(c.phone, this.query)}</td>
          <td class="col-nid" data-label="الرقم القومي">${escapeHtml(c.nid || '-')}</td>
          <td class="col-addr" data-label="العنوان">${escapeHtml(c.address || '-')}</td>
          <td class="col-counts" data-label="الطلبات/الشكاوى">${countsPill}</td>
          ${actionsTd}
        `;
      }
      frag.appendChild(tr);
    });
    this.tbody.replaceChildren(frag);
  }

  renderHead() {
    const thead = this.root.querySelector('thead tr');
    if (!thead) return;
    const headHtml = this.activeTab === 'company'
      ? `<th>#</th><th>اسم الشركة</th><th>السجل التجاري</th><th>المفوض عنها</th><th>رقم الهاتف</th><th>الرقم القومي</th><th>العنوان</th><th>الطلبات/الشكاوى</th><th>النوع</th><th>إجراءات</th>`
      : `<th>#</th><th>الاسم</th><th>رقم الهاتف</th><th>الرقم القومي</th><th>العنوان</th><th>الطلبات/الشكاوى</th><th>النوع</th><th>إجراءات</th>`;
    if (thead.dataset.tab !== this.activeTab) {
      thead.innerHTML = headHtml;
      thead.dataset.tab = this.activeTab;
    }
  }

  renderEmpty() {
    // إخفاء scroll واستبدال بـ empty state
    const scroll = this.tableWrap.querySelector('.table-scroll');
    if (scroll) scroll.style.display = 'none';
    let empty = this.tableWrap.querySelector('.empty-state');
    if (!empty) {
      empty = document.createElement('div');
      empty.className = 'empty-state';
      empty.innerHTML = `
        <div class="empty-icon"><i class="fa-solid fa-magnifying-glass"></i></div>
        <h4>لا توجد نتائج مطابقة</h4>
        <p>جرّب تعديل كلمة البحث أو إعادة تعيين الفلاتر لعرض كل العملاء.</p>
        <button class="reset-btn"><i class="fa-solid fa-rotate-left"></i> إعادة تعيين</button>
      `;
      this.tableWrap.appendChild(empty);
      empty.querySelector('.reset-btn').addEventListener('click', () => {
        this.searchInp.value = '';
        this.query = '';
        this.searchBox.classList.remove('has-value');
        this.render();
      });
    }
  }
}

/* ============= Bootstrap =============
   كل CustomersSection يفحص وجود الـ root selector تلقائيًا
   (defensive init) فيصير آمناً للتضمين في أي صفحة. */
document.addEventListener('DOMContentLoaded', () => {
  loadCustomersFromStore();
  new CustomersSection('#requestsCustomers',  requestsCustomersData);
  new CustomersSection('#inquiriesCustomers', inquiriesCustomersData);
});
