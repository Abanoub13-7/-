/* ============================================================
   Layout Injector — يحقن Sidebar + Top Header + Footer
   ويضبط Active link + Document title + Breadcrumb تلقائياً.
   يعمل قبل أي script آخر، فيوفّر DOM موحّد لكل الصفحات.
============================================================ */
(function () {
  'use strict';

  /* ===== خريطة الصفحات (مصدر الحقيقة الوحيد للـ Sidebar) ===== */
  const PAGES = [
    { key: 'overview',            href: 'index.html',                title: 'الصفحة الرئيسية',          icon: 'fa-gauge-high',            crumb: 'لوحة التحكم الرئيسية' },
    { key: 'requests',            href: 'pages/requests.html',            title: 'الطلبات',                  icon: 'fa-file-lines',            crumb: 'إدارة الطلبات' },
    { key: 'complaints',          href: 'pages/complaints.html',          title: 'الشكاوى',                  icon: 'fa-circle-exclamation',    crumb: 'إدارة الشكاوى' },
    { key: 'request-types',       href: 'pages/request-types.html',       title: 'أنواع الطلبات',            icon: 'fa-layer-group',           crumb: 'تصنيفات الطلبات' },
    { key: 'actions',             href: 'pages/actions.html',             title: 'الإجراءات',                icon: 'fa-list-check',            crumb: 'الإجراءات والمتابعات' },
    { key: 'inquiries',           href: 'pages/inquiries.html',           title: 'قسم الاستعلامات',          icon: 'fa-magnifying-glass-chart',crumb: 'قسم الاستعلامات' },
    { key: 'orders-customers',    href: 'pages/orders-customers.html',    title: 'عملاء الطلبات/الشكاوى',    icon: 'fa-users-line',            crumb: 'قاعدة بيانات العملاء' },
    { key: 'inquiries-customers', href: 'pages/inquiries-customers.html', title: 'عملاء الاستعلامات',        icon: 'fa-user-tie',              crumb: 'عملاء قسم الاستعلامات' },
    { key: 'reports',             href: 'pages/reports.html',             title: 'التقارير',                 icon: 'fa-chart-pie',             crumb: 'التقارير والإحصائيات' },
  ];

  /* ===== حساب الـ base path (هل نحن داخل /pages/؟) ===== */
  const path = location.pathname.replace(/\\/g, '/');
  const inPages = /\/pages\//.test(path);
  const BASE = inPages ? '../' : '';

  /* ===== الصفحة الحالية ===== */
  const body = document.body;
  const currentKey =
    body.dataset.page ||
    (path.match(/\/([\w-]+)\.html?$/) || [, 'overview'])[1].replace(/^index$/, 'overview');
  const current = PAGES.find(p => p.key === currentKey) || PAGES[0];

  /* ===== Document Title ===== */
  document.title = `${current.title} | لوحة تحكم فوج المقر`;

  /* ===== بناء HTML الـ Sidebar ===== */
  const navHtml = PAGES.map(p => `
    <a href="${BASE}${p.href}" class="nav-item${p.key === current.key ? ' active' : ''}" data-page="${p.key}" aria-current="${p.key === current.key ? 'page' : 'false'}">
      <i class="fa-solid ${p.icon}"></i><span>${p.title}</span>
    </a>`).join('');

  const sidebarHtml = `
<div class="sidebar-overlay" id="sidebarOverlay"></div>

<aside class="sidebar" id="sidebar">
  <div class="logo-area">
    <div class="logo-frame">
      <img src="${BASE}assets/img/logo-foe.png" alt="مستقبل مصر" onerror="this.style.display=\'none\'" />
    </div>
    <span class="logo-sub">لوحة تحكم فوج المقر</span>
  </div>

  <ul class="nav-menu">
    ${navHtml}
  </ul>

  <div class="user-profile">
    <div class="user-block">
      <div class="user-avatar">ف</div>
      <div class="user-info">
        <span class="user-name">فوج المقر (أدمن)</span>
        <span class="user-email">fogadmin@foe.com</span>
      </div>
    </div>
    <button class="more-btn" aria-label="المزيد">
      <i class="fa-solid fa-ellipsis-vertical"></i>
    </button>
  </div>
</aside>`;

  const headerHtml = `
<header class="top-header">
  <div class="header-right">
    <button class="menu-btn" id="menuBtn" aria-label="فتح القائمة" aria-expanded="false">
      <i class="fa-solid fa-bars"></i>
    </button>
    <div class="breadcrumb">
      <div class="breadcrumb-logo">
        <img src="${BASE}assets/img/logo-fog.png" alt="قيادة فوج المقر" onerror="this.style.display=\'none\'">
      </div>
      <div class="breadcrumb-text">
        <span class="title">${current.title}</span>
        <span class="sub">${current.crumb}</span>
      </div>
    </div>
  </div>
  <button class="theme-toggle" id="themeToggle" title="تغيير المظهر" aria-label="تغيير المظهر">
    <i class="fa-regular fa-sun"></i>
  </button>
</header>`;

  const footerHtml = `
<footer class="footer">
  جهاز مستقبل مصر للتنمية المستدامة — جميع الحقوق محفوظة لإدارة تكنولوجيا المعلومات © 2026
</footer>`;

  /* ===== الحقن داخل DOM ===== */
  const main = document.querySelector('main.main-wrapper');
  if (!main) return;

  // sidebar + overlay قبل الـ main
  main.insertAdjacentHTML('beforebegin', sidebarHtml);
  // header كأول عنصر داخل الـ main
  main.insertAdjacentHTML('afterbegin', headerHtml);
  // footer كآخر عنصر داخل الـ main
  main.insertAdjacentHTML('beforeend', footerHtml);

  /* ===== Scroll restoration ===== */
  window.scrollTo(0, 0);
})();
