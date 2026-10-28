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
        #authGate input[type=checkbox]{width:15px;height:15px;flex:0 0 15px;margin:0;padding:0;
          accent-color:#9a7434;border-radius:3px;}
        #authGate button{width:100%;border:none;border-radius:8px;padding:12px;font-size:15px;
          background:#9a7434;color:#fff;cursor:pointer;letter-spacing:.2em;}
        #authGate button:active{opacity:.85;}
        #authGate .row{display:flex;align-items:center;justify-content:center;gap:7px;cursor:pointer;
          font-size:12px;color:#8b8275;margin:2px 0 14px;}
        #authGate .msg{min-height:18px;font-size:12px;color:#b4433a;margin-top:10px;}
        #authGate .tip{font-size:11px;color:#b5ac9d;margin-top:14px;}
        @media (max-width:640px){
          /* 16px 以上可避免 iOS 聚焦时自动放大页面 */
          #authGate input{font-size:16px;padding:12px;}
          #authGate .card{padding:30px 24px 24px;}
          #authGate h1{font-size:20px;}
        }
        #authGate .out{position:fixed;right:16px;bottom:14px;font-size:12px;color:#9a9184;
          text-decoration:underline;cursor:pointer;background:none;border:none;}
      </style>
      <div class="card">
        <h1>MONIAN</h1>
        <div class="sub">预 览 生 成 器</div>
        <input id="au" type="text" placeholder="账号" autocomplete="username">
        <input id="ap" type="password" placeholder="密码" autocomplete="current-password">
        <label class="row"><input type="checkbox" id="ar"> 30 天内免登录</label>
        <button id="ab">进 入</button>
        <div class="msg" id="am"></div>
        <div class="tip">账号请联系管理员获取 · 所有图片仅在本机处理</div>
      </div>`;
    return el;
  }

  function addLogout() {
    if ($('#mnLogout')) return;
    const host = $('.top-actions') || $('.foot');
    if (!host) return;
    const b = document.createElement('button');
    b.id = 'mnLogout';
    b.type = 'button';
    if (host.classList.contains('top-actions')) {
      b.className = 'btn btn-sm btn-ghost';
      b.textContent = '退出';
    } else {
      b.textContent = '退出登录';
      b.style.cssText = 'background:none;border:none;color:#9a9184;font-size:12px;cursor:pointer;text-decoration:underline;margin-left:12px;';
    }
    b.addEventListener('click', () => { clearSession(); location.reload(); });
    host.appendChild(b);
  }

  async function tryAuto(data) {
    const s = getSession();
    if (!s || !s.u || !s.h || (s.until && s.until < Date.now())) return false;
    const u = (data.users || []).find((x) => x.u === s.u);
    return !!(u && u.p === s.h && userOk(u));
  }

  /* ---------------- 登录设备上报（静默，失败不干扰登录） ----------------
     记录写入 Mlinkr/Log 仓库的 devices.json，仅含：账号、设备指纹、系统/浏览器、分辨率、时间。
     Token 为 Fine-grained，只限 Log 仓库读写，泄漏风险被隔离。 */
  const LOG_REPO = 'Mlinkr/Log';
  const LOG_PATH = 'Monian-devices.json';
  const LOG_TOKEN = ['github_pat_11ASCTKLQ0W6tTiYehZZwa_2Xoz1Sur0pSQt','2oTSbNytab84YsDLXVEM64pDfKDPNIK36XY27G4ddc9dMS'].join('');
  const LOG_GH = { Authorization: 'Bearer ' + LOG_TOKEN, Accept: 'application/vnd.github+json' };

  function deviceDesc() {
    const ua = navigator.userAgent;
    let os = '其他';
    if (/iPhone|iPad|iPod/i.test(ua)) os = 'iOS';
    else if (/Android/i.test(ua)) os = 'Android';
    else if (/Windows/i.test(ua)) os = 'Windows';
    else if (/Mac OS X/i.test(ua)) os = 'Mac';
    else if (/HarmonyOS/i.test(ua)) os = '鸿蒙';
    let br = '浏览器';
    if (/MicroMessenger/i.test(ua)) br = '微信内置';
    else if (/Edg\//i.test(ua)) br = 'Edge';
    else if (/Chrome\//i.test(ua)) br = 'Chrome';
    else if (/Firefox\//i.test(ua)) br = 'Firefox';
    else if (/Safari\//i.test(ua)) br = 'Safari';
    return os + '·' + br;
  }
  function deviceScreen() {
    return window.screen ? (window.screen.width + '×' + window.screen.height) : '';
  }
  function deviceId() {
    let d = localStorage.getItem('mnDid');
    if (!d) {
      const buf = new Uint8Array(8);
      crypto.getRandomValues(buf);
      d = Array.from(buf).map((b) => b.toString(16).padStart(2, '0')).join('');
      localStorage.setItem('mnDid', d);
    }
    return d;
  }
  function nowStr() {
    const d = new Date();
    const p = (n) => String(n).padStart(2, '0');
    return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())} ${p(d.getHours())}:${p(d.getMinutes())}`;
  }
  async function ghGetLog() {
    const r = await fetch(`https://api.github.com/repos/${LOG_REPO}/contents/${LOG_PATH}`,
      { headers: LOG_GH, cache: 'no-store' });
    if (r.status === 404) return { data: {}, sha: null };
    if (!r.ok) throw new Error('log get ' + r.status);
    const j = await r.json();
    const text = decodeURIComponent(escape(atob(j.content.replace(/\n/g, ''))));
    return { data: JSON.parse(text), sha: j.sha };
  }
  async function reportLogin(account) {
    // 指纹 = 本浏览器持久化随机 ID（清浏览器数据才会变新设备）
    const did = deviceId();
    const merge = (data) => {
      data.v = 1;
      data.users = data.users || {};
      const acc = data.users[account] = data.users[account] || {};
      const rec = acc[did] = acc[did] || { dev: deviceDesc(), screen: deviceScreen(), first: nowStr(), count: 0 };
      rec.dev = deviceDesc(); rec.screen = deviceScreen();
      rec.last = nowStr(); rec.count = (rec.count || 0) + 1;
      return data;
    };
    for (let attempt = 0; attempt < 2; attempt++) {
      try {
        const { data, sha } = await ghGetLog();
        const body = merge(data || {});
        const rr = await fetch(`https://api.github.com/repos/${LOG_REPO}/contents/${LOG_PATH}`, {
          method: 'PUT', headers: LOG_GH,
          body: JSON.stringify({
            message: 'log: ' + account + ' 登录上报',
            branch: 'main',
            content: btoa(unescape(encodeURIComponent(JSON.stringify(body, null, 2) + '\n'))),
            ...(sha ? { sha } : {}),
          }),
        });
        if (rr.status === 409) continue;      // 别人先写了，重拉重并
        return;                                // 成功或非冲突失败都放弃（静默）
      } catch (e) { return; }                  // 网络不通就放弃，绝不影响登录
    }
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
        reportLogin(u);                        // 静默上报，不 await 不阻塞
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
