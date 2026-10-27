/* ===========================================================
   Monian · auth.js
   使用端登录门：账号密码验证通过才能看到工具本体。
   账号表在 assets/data/accounts.json（密码只存 SHA-256 哈希）。
   定位是「防人品」级别的前端门禁，不是绝对安全边界。
   =========================================================== */
(function () {
  'use strict';

  const KEY = 'mnAuth';
  const $ = (s, r) => (r || document).querySelector(s);

  async function sha(text) {
    const buf = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(text));
    return Array.from(new Uint8Array(buf)).map((b) => b.toString(16).padStart(2, '0')).join('');
  }

  function todayStr() {
    const d = new Date();
    return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
  }

  async function loadAccounts() {
    const r = await fetch('assets/data/accounts.json?t=' + Date.now(), { cache: 'no-store' });
    if (!r.ok) throw new Error('账号表加载失败');
    return r.json();
  }

  function getSession() {
    try {
      return JSON.parse(sessionStorage.getItem(KEY) || localStorage.getItem(KEY) || 'null');
    } catch (e) { return null; }
  }
  function clearSession() {
    sessionStorage.removeItem(KEY);
    localStorage.removeItem(KEY);
  }

  function userOk(u) {
    return u && (!u.expire || String(u.expire) >= todayStr());
  }

  /* ---------- 登录遮罩 ---------- */
  function buildOverlay() {
    const el = document.createElement('div');
    el.id = 'authGate';
    el.innerHTML = `
      <style>
        #authGate{position:fixed;inset:0;z-index:9999;display:flex;align-items:center;justify-content:center;
          background:linear-gradient(160deg,#f4f2ee 0%,#ece8df 100%);}
        #authGate .card{width:min(360px,88vw);background:#fff;border-radius:14px;padding:34px 30px 26px;
          box-shadow:0 18px 50px rgba(29,26,21,.14);text-align:center;}
        #authGate h1{font-size:22px;letter-spacing:.35em;margin:0 0 4px;color:#1d1a15;font-weight:600;}
        #authGate .sub{font-size:12px;color:#9a9184;letter-spacing:.2em;margin-bottom:24px;}
        #authGate input{width:100%;box-sizing:border-box;border:1px solid #ddd6ca;border-radius:8px;
          padding:11px 12px;font-size:14px;margin-bottom:12px;background:#faf9f6;color:#1d1a15;}
        #authGate input:focus{outline:none;border-color:#9a7434;}
        #authGate button{width:100%;border:none;border-radius:8px;padding:12px;font-size:15px;
          background:#9a7434;color:#fff;cursor:pointer;letter-spacing:.2em;}
        #authGate button:active{opacity:.85;}
        #authGate .row{display:flex;align-items:center;justify-content:flex-start;gap:6px;
          font-size:12px;color:#8b8275;margin:2px 0 14px;}
        #authGate .msg{min-height:18px;font-size:12px;color:#b4433a;margin-top:10px;}
        #authGate .tip{font-size:11px;color:#b5ac9d;margin-top:14px;}
        #authGate .out{position:fixed;right:16px;bottom:14px;font-size:12px;color:#9a9184;
          text-decoration:underline;cursor:pointer;background:none;border:none;}
      </style>
      <div class="card">
        <h1>MONIAN</h1>
        <div class="sub">预 览 生 成 器</div>
        <input id="au" type="text" placeholder="账号" autocomplete="username">
        <input id="ap" type="password" placeholder="密码" autocomplete="current-password">
        <label class="row"><input type="checkbox" id="ar" style="width:auto;margin:0"> 30 天内免登录</label>
        <button id="ab">进 入</button>
        <div class="msg" id="am"></div>
        <div class="tip">账号请联系管理员获取 · 所有图片仅在本机处理</div>
      </div>`;
    return el;
  }

  function addLogout() {
    if ($('#mnLogout')) return;
    const foot = $('.foot');
    if (!foot) return;
    const b = document.createElement('button');
    b.id = 'mnLogout';
    b.textContent = '退出登录';
    b.style.cssText = 'background:none;border:none;color:#9a9184;font-size:12px;cursor:pointer;text-decoration:underline;margin-left:12px;';
    b.addEventListener('click', () => { clearSession(); location.reload(); });
    foot.appendChild(b);
  }

  async function tryAuto(data) {
    const s = getSession();
    if (!s || !s.u || !s.h || (s.until && s.until < Date.now())) return false;
    const u = (data.users || []).find((x) => x.u === s.u);
    return !!(u && u.p === s.h && userOk(u));
  }

  async function boot() {
    let data;
    try {
      data = await loadAccounts();
    } catch (e) {
      // 账号表读不到时直接放行，避免一次发布失误把所有人锁在门外
      return;
    }

    if (await tryAuto(data)) { addLogout(); return; }

    const gate = buildOverlay();
    document.body.appendChild(gate);
    const au = $('#au', gate), ap = $('#ap', gate), am = $('#am', gate);
    const doLogin = async () => {
      const u = au.value.trim(), p = ap.value;
      if (!u || !p) { am.textContent = '请输入账号和密码'; return; }
      try {
        const d = await loadAccounts();
        const hit = (d.users || []).find((x) => x.u === u);
        const h = await sha(`${u}:${p}`);
        if (!hit || hit.p !== h) { am.textContent = '账号或密码不正确'; return; }
        if (!userOk(hit)) { am.textContent = '该账号已过期，请联系管理员'; return; }
        const sess = { u, h, t: Date.now() };
        if ($('#ar', gate).checked) sess.until = Date.now() + 30 * 864e5;
        (sess.until ? localStorage : sessionStorage).setItem(KEY, JSON.stringify(sess));
        gate.remove();
        addLogout();
      } catch (e) {
        am.textContent = '验证服务暂不可用，请稍后再试';
      }
    };
    $('#ab', gate).addEventListener('click', doLogin);
    [au, ap].forEach((i) => i.addEventListener('keydown', (e) => { if (e.key === 'Enter') doLogin(); }));
    au.focus();
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', boot);
  } else {
    boot();
  }
})();
