/* ============================================================
   Shared Data Store — central layer over localStorage
   ============================================================
   Keys are namespaced under "fog.*". Provides defaults seeding,
   safe JSON parse, pub/sub, and cross-tab sync via "storage" event.
============================================================ */
(function (global) {
  'use strict';

  const NS = 'fog.';
  const SCHEMA_VERSION = 1;

  /* ----- Defaults ----- */
  const DEFAULTS = {
    'fog.meta':         { version: SCHEMA_VERSION },
    'fog.requestTypes': [
      'استكمال إجراءات التقنين',
      'الرفع المساحي',
      'طلب التعاقد',
      'طلب التخصيص',
      'طلب استخراج عقد',
      'طلب تعارض',
      'ملف البحيرات',
      'ملف أراضي جمعية العدالة',
      'معلقة',
    ],
    'fog.actions': [
      'تم الرد',
      'لم يتم الرد',
      'استعجال 1',
      'استعجال 2',
    ],
    'fog.sectors': {
      'قطاع الضبعة':      ['إدارة فوق المقر','إدارة التنظيم','إدارة الميكنة','إدارة التعاقدات'],
      'قطاع رخاء':         ['فرع إعداد الدولة','فرع المساحة','إدارة الشؤون القانونية','مكتب السيد مدير الجهاز','إدارة الإشراف والمتابعة'],
      'قطاع غرب القاهرة':  ['إدارة الشؤون الإدارية','إدارة المتابعة الميدانية','إدارة التراخيص','إدارة الشؤون المالية'],
      'قطاع هون':          ['إدارة العمليات','إدارة المشروعات','إدارة التنسيق','إدارة الجودة'],
    },
  };

  /* ----- Listeners (in-tab) ----- */
  const listeners = new Map(); // key -> Set<fn>

  function safeParse(raw, fallback) {
    if (raw == null) return fallback;
    try { return JSON.parse(raw); } catch (_) { return fallback; }
  }

  function get(key) {
    const raw = localStorage.getItem(key);
    if (raw == null) {
      // seed defaults lazily
      if (Object.prototype.hasOwnProperty.call(DEFAULTS, key)) {
        const def = JSON.parse(JSON.stringify(DEFAULTS[key]));
        try { localStorage.setItem(key, JSON.stringify(def)); } catch (_) {}
        return def;
      }
      return null;
    }
    return safeParse(raw, DEFAULTS[key] != null ? JSON.parse(JSON.stringify(DEFAULTS[key])) : null);
  }

  function set(key, value) {
    try {
      localStorage.setItem(key, JSON.stringify(value));
      _emit(key, value);
      return true;
    } catch (e) {
      console.warn('[Store] write failed:', e);
      return false;
    }
  }

  function update(key, fn) {
    const cur = get(key);
    const next = fn(cur);
    set(key, next);
    return next;
  }

  function on(key, fn) {
    if (!listeners.has(key)) listeners.set(key, new Set());
    listeners.get(key).add(fn);
    return () => listeners.get(key).delete(fn);
  }

  function _emit(key, value) {
    const set_ = listeners.get(key);
    if (set_) set_.forEach(fn => { try { fn(value); } catch(_){} });
  }

  // Cross-tab sync
  window.addEventListener('storage', e => {
    if (!e.key || !e.key.startsWith(NS)) return;
    _emit(e.key, safeParse(e.newValue, null));
  });

  /* ----- Migration ----- */
  function migrate() {
    const meta = get('fog.meta');
    if (!meta || meta.version !== SCHEMA_VERSION) {
      // Future migrations go here
      set('fog.meta', { version: SCHEMA_VERSION });
    }
    // Backfill defaults for any missing key
    Object.keys(DEFAULTS).forEach(k => { if (localStorage.getItem(k) == null) get(k); });
  }

  migrate();

  /* ----- Convenience getters ----- */
  const Store = {
    get, set, update, on,
    requestTypes: () => get('fog.requestTypes') || [],
    actions:      () => get('fog.actions')      || [],
    sectors:      () => get('fog.sectors')      || {},
  };

  global.Store = Store;
})(window);
