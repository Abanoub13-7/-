/* ============================================================
   Core UI Logic — يعمل على كل الصفحات
   - Theme toggle
   - Sidebar (mobile)
   - Spotlight على كروت التقارير
   - Defensive: كل listener يتأكد أن العنصر موجود
============================================================ */
(function () {
  'use strict';

  /* ===== 1) زر تبديل المظهر ===== */
  const THEME_KEY = 'fog-theme';
  const themeToggle = document.getElementById('themeToggle');

  function applyTheme(mode) {
    const isDark = mode === 'dark';
    document.documentElement.classList.toggle('dark', isDark);
    document.body.classList.toggle('dark', isDark);
    if (themeToggle) {
      const icon = themeToggle.querySelector('i');
      if (icon) {
        icon.className = isDark ? 'fa-solid fa-moon' : 'fa-regular fa-sun';
      }
    }
  }

  // تحميل الـ theme المحفوظ
  try {
    const saved = localStorage.getItem(THEME_KEY);
    if (saved) applyTheme(saved);
  } catch (_) { /* ignore */ }

  if (themeToggle) {
    themeToggle.addEventListener('click', () => {
      const isDark = document.documentElement.classList.contains('dark');
      const next = isDark ? 'light' : 'dark';
      applyTheme(next);
      try { localStorage.setItem(THEME_KEY, next); } catch (_) {}
    });
  }

  /* ===== 2) Sidebar (الموبايل) ===== */
  const sidebar = document.getElementById('sidebar');
  const overlay = document.getElementById('sidebarOverlay');
  const menuBtn = document.getElementById('menuBtn');

  function openSidebar() {
    if (!sidebar || !overlay) return;
    sidebar.classList.add('open');
    overlay.classList.add('show');
    document.body.classList.add('no-scroll');
    if (menuBtn) menuBtn.setAttribute('aria-expanded', 'true');
  }
  function closeSidebar() {
    if (!sidebar || !overlay) return;
    sidebar.classList.remove('open');
    overlay.classList.remove('show');
    document.body.classList.remove('no-scroll');
    if (menuBtn) menuBtn.setAttribute('aria-expanded', 'false');
  }

  if (menuBtn) {
    menuBtn.addEventListener('click', () => {
      sidebar && sidebar.classList.contains('open') ? closeSidebar() : openSidebar();
    });
  }
  if (overlay) overlay.addEventListener('click', closeSidebar);
  document.addEventListener('keydown', e => { if (e.key === 'Escape') closeSidebar(); });

  // إغلاق الـ sidebar في الموبايل عند اختيار رابط (الانتقال الحقيقي يحصل عبر href)
  document.querySelectorAll('.nav-item').forEach(item => {
    item.addEventListener('click', () => {
      if (window.innerWidth <= 900) closeSidebar();
    });
  });

  /* ===== 3) Spotlight على كروت التقارير ===== */
  document.querySelectorAll('.report-card').forEach(card => {
    card.addEventListener('mousemove', e => {
      const rect = card.getBoundingClientRect();
      card.style.setProperty('--mx', (e.clientX - rect.left) + 'px');
      card.style.setProperty('--my', (e.clientY - rect.top) + 'px');
    });
  });
})();
