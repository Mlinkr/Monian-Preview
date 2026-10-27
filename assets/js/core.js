/* ===========================================================
   Monian · core.js
   工具函数 / 状态 / 本地持久化
   =========================================================== */
(function () {
  'use strict';

  const MN = (window.MN = window.MN || {});

  /* ---------------- 基础工具 ---------------- */
  const U = (MN.util = {
    clamp(v, a, b) { return Math.min(b, Math.max(a, v)); },
    uid() { return Math.random().toString(36).slice(2, 9); },
    pad2(n) { return String(n).padStart(2, '0'); },
    esc(s) {
      return String(s == null ? '' : s).replace(/[&<>"']/g, (c) => (
        { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]
      ));
    },
    fmtDate(ts) {
      const d = new Date(ts);
      if (isNaN(d.getTime())) return '';
      return `${String(d.getFullYear()).slice(2)}/${U.pad2(d.getMonth() + 1)}/${U.pad2(d.getDate())}`;
    },
    collator: new Intl.Collator('zh-Hans-CN', { numeric: true, sensitivity: 'base' }),
    debounce(fn, ms) {
      let t;
      return function (...a) {
        clearTimeout(t);
        t = setTimeout(() => fn.apply(this, a), ms);
      };
    },
    isImage(file) {
      return file && /^image\//.test(file.type || '') || /\.(jpe?g|png|webp|gif|bmp)$/i.test(file.name || '');
    },
    bytes(n) {
      if (!n && n !== 0) return '—';
      if (n < 1024) return n + ' B';
      if (n < 1024 * 1024) return (n / 1024).toFixed(0) + ' KB';
      return (n / 1024 / 1024).toFixed(1) + ' MB';
    },
    roundRect(ctx, x, y, w, h, r) {
      const rr = Math.min(r, w / 2, h / 2);
      ctx.beginPath();
      if (rr <= 0.01) { ctx.rect(x, y, w, h); return; }
      ctx.moveTo(x + rr, y);
      ctx.lineTo(x + w - rr, y);
      ctx.arcTo(x + w, y, x + w, y + rr, rr);
      ctx.lineTo(x + w, y + h - rr);
      ctx.arcTo(x + w, y + h, x + w - rr, y + h, rr);
      ctx.lineTo(x + rr, y + h);
      ctx.arcTo(x, y + h, x, y + h - rr, rr);
      ctx.lineTo(x, y + rr);
      ctx.arcTo(x, y, x + rr, y, rr);
      ctx.closePath();
    },
  });

  /* ---------------- 默认状态 ---------------- */
  const DEFAULT_STATE = {
    folderName: '',
    dateText: '',
    priceText: '',
    // 01 卡片的「自动水印」：名称 / 日期 / 张数，样式在 01 内直接调整
    autoWm: {
      folder: { on: true, text: '{folder}', anchor: 'bl', size: 1.15, opacity: 0.95, weight: 600, color: '#ffffff', dx: 0, dy: 0, free: false, px: 7, py: 78, tone: 'auto' },
      date: { on: true, text: '{date}', anchor: 'bl', size: 0.8, opacity: 0.7, weight: 400, color: '#ffffff', dx: 0, dy: -16, free: false, px: 7, py: 68, tone: 'auto' },
      count: { on: false, text: '{count}', anchor: 'br', size: 0.8, opacity: 0.7, weight: 400, color: '#ffffff', dx: 0, dy: -16, free: false, px: 80, py: 78, tone: 'auto' },
    },
    countText: '',
    // 02 卡片：用户手动加的水印（文字 / 图片），不再自动塞占位符
    wmPer: [],
    wmGlobal: [],
    header: {
      title: '',
      meta: '',
    },
    canvas: {
      mode: 'solid',      // solid: 纯色底图 / image: 自定义底图 / none: 无底图
      color: '#f2efe8',
      header: true,       // 纯色模式下是否绘制标题栏
    },
    template: null, // { aspect, pad:{t,r,b,l}, img, w, h }
    layout: {
      cols: 3,
      gap: 1.2,
      margin: 3,
      radius: 0.4,
      aspect: 'auto',
      fill: 'cover',
      lastRow: 'center',   // center: 末行居中保持原尺寸 / fill: 末行铺满整行
    },
    export: { width: 1600, format: 'jpeg', quality: 0.92 },
  };

  function deepClone(o) { return JSON.parse(JSON.stringify(o)); }

  function mergeDefault(def, src) {
    if (!src || typeof src !== 'object') return deepClone(def);
    const out = deepClone(def);
    for (const k in src) {
      if (src[k] === undefined) continue;
      if (Array.isArray(src[k])) out[k] = deepClone(src[k]);
      else if (src[k] && typeof src[k] === 'object' && !Array.isArray(src[k]) && def[k] && typeof def[k] === 'object') {
        out[k] = Object.assign(deepClone(def[k]), src[k]);
      } else out[k] = src[k];
    }
    return out;
  }

  /* ---------------- 持久化（localStorage） ---------------- */
  const KEY = 'monian.settings.v1';

  const store = (MN.store = {
    load() {
      try {
        const raw = localStorage.getItem(KEY);
        if (!raw) return deepClone(DEFAULT_STATE);
        const parsed = JSON.parse(raw);
        const out = mergeDefault(DEFAULT_STATE, parsed);
        // 老版本没有 canvas 字段：原来用了模板图的继续用自定义底图
        if (!parsed.canvas) out.canvas.mode = parsed.template ? 'image' : 'solid';
        // 主题转亮：以前留下的深色默认底色换成浅色默认（用户自己选过的颜色不动）
        if (out.canvas && /^#(0f0f14|08080b|0a0a0d)$/i.test(out.canvas.color || '')) out.canvas.color = DEFAULT_STATE.canvas.color;
        // 主题转亮：底图是浅色却还留着纯白水印（早期默认）的，换成深墨色，否则看不见
        const lightBase = !out.canvas || !out.canvas.color || /^#(f2efe8|ffffff|fff|f5f5f5|fafafa)$/i.test(out.canvas.color);
        if (lightBase && out.autoWm) {
          for (const k in out.autoWm) {
            const a = out.autoWm[k];
            if (a && /^#fff(fff)?$/i.test(a.color || '')) a.color = '#1d1a15';
          }
        }
        return out;
      } catch (e) {
        return deepClone(DEFAULT_STATE);
      }
    },
    save(state) {
      try {
        const json = JSON.stringify(state, (k, v) => (k === 'files' || k === 'img' || k === 'file' || k === 'thumbUrl' ? undefined : v));
        localStorage.setItem(KEY, json);
        return true;
      } catch (e) { return false; }
    },
    clear() {
      try { localStorage.removeItem(KEY); } catch (e) {}
    },
    defaultState() { return deepClone(DEFAULT_STATE); },
  });

  /* ---------------- IndexedDB：模板原图 ---------------- */
  const DB_NAME = 'monian-db';
  const DB_STORE = 'assets';
  let dbPromise = null;

  function openDB() {
    if (dbPromise) return dbPromise;
    dbPromise = new Promise((resolve, reject) => {
      if (!('indexedDB' in window)) return reject(new Error('no idb'));
      const req = indexedDB.open(DB_NAME, 1);
      req.onupgradeneeded = () => {
        const db = req.result;
        if (!db.objectStoreNames.contains(DB_STORE)) db.createObjectStore(DB_STORE);
      };
      req.onsuccess = () => resolve(req.result);
      req.onerror = () => reject(req.error);
    });
    return dbPromise;
  }

  MN.idb = {
    async set(key, val) {
      try {
        const db = await openDB();
        return new Promise((res, rej) => {
          const tx = db.transaction(DB_STORE, 'readwrite');
          tx.objectStore(DB_STORE).put(val, key);
          tx.oncomplete = () => res(true);
          tx.onerror = () => rej(tx.error);
        });
      } catch (e) { return false; }
    },
    async get(key) {
      try {
        const db = await openDB();
        return new Promise((res, rej) => {
          const tx = db.transaction(DB_STORE, 'readonly');
          const r = tx.objectStore(DB_STORE).get(key);
          r.onsuccess = () => res(r.result || null);
          r.onerror = () => rej(r.error);
        });
      } catch (e) { return null; }
    },
    async del(key) {
      try {
        const db = await openDB();
        return new Promise((res) => {
          const tx = db.transaction(DB_STORE, 'readwrite');
          tx.objectStore(DB_STORE).delete(key);
          tx.oncomplete = () => res(true);
          tx.onerror = () => res(false);
        });
      } catch (e) { return false; }
    },
  };

  /* ---------------- 图片读取与预缩放 ---------------- */
  // 把 File 解码，并把长边限制在 maxSide 内（节省内存、加快渲染，画质足够导出）
  MN.loadBitmap = function (fileOrBlob, maxSide = 2600) {
    return new Promise((resolve, reject) => {
      const url = URL.createObjectURL(fileOrBlob);
      const img = new Image();
      img.decoding = 'async';
      img.onload = () => {
        try {
          const w0 = img.naturalWidth || img.width;
          const h0 = img.naturalHeight || img.height;
          if (!w0 || !h0) { URL.revokeObjectURL(url); return reject(new Error('empty')); }
          const scale = Math.min(1, maxSide / Math.max(w0, h0));
          if (scale >= 1) {
            URL.revokeObjectURL(url);
            return resolve({ img, w: w0, h: h0 });
          }
          const w = Math.max(1, Math.round(w0 * scale));
          const h = Math.max(1, Math.round(h0 * scale));
          const c = document.createElement('canvas');
          c.width = w; c.height = h;
          const cx = c.getContext('2d');
          cx.imageSmoothingEnabled = true;
          cx.imageSmoothingQuality = 'high';
          cx.drawImage(img, 0, 0, w, h);
          URL.revokeObjectURL(url);
          img.src = '';
          resolve({ img: c, w, h });
        } catch (e) {
          URL.revokeObjectURL(url);
          reject(e);
        }
      };
      img.onerror = () => {
        URL.revokeObjectURL(url);
        reject(new Error('decode'));
      };
      img.src = url;
    });
  };

  /* ---------------- 提示 ---------------- */
  let toastTimer = null;
  MN.toast = function (msg, ms = 2200) {
    const el = document.getElementById('toast');
    if (!el) return;
    el.textContent = msg;
    el.classList.add('show');
    clearTimeout(toastTimer);
    toastTimer = setTimeout(() => el.classList.remove('show'), ms);
  };
})();
