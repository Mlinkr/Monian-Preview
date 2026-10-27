/* ===========================================================
   Monian · app.js
   界面逻辑 / 文件处理 / 导出
   =========================================================== */
(function () {
  'use strict';

  const MN = window.MN;
  const U = MN.util;
  const $ = (s, r = document) => r.querySelector(s);
  const $$ = (s, r = document) => Array.from(r.querySelectorAll(s));

  /* ---------------- 状态 ---------------- */
  const state = MN.store.load();
  state.files = [];
  state.template = state.template || null;
  // 迁移：旧版本把 {folder}/{date} 自动塞在 02 列表里，现在挪到 01 的自动水印，清掉旧条目
  ['wmPer', 'wmGlobal'].forEach((k) => {
    if (Array.isArray(state[k])) {
      state[k] = state[k].filter((it) => {
        if (!it || it.kind === 'image') return true;
        const t = String(it.text || '').trim();
        return !(t === '{folder}' || t === '{date}' || it.auto);
      });
    }
  });
  if (!state.autoWm) state.autoWm = MN.store.defaultState().autoWm;

  let wmTab = 'per';
  let fitMode = 'fit'; // fit: 整图可见 / fill: 铺满宽度
  let guides = false;
  let loadToken = 0;
  let rafId = 0;

  const el = {
    fileCount: $('#fileCount'),
    dropzone: $('#dropzone'),
    btnFolder: $('#btnFolder'),
    btnFiles: $('#btnFiles'),
    inputFolder: $('#inputFolder'),
    inputFiles: $('#inputFiles'),
    progress: $('#progress'),
    progressBar: $('#progressBar'),
    progressTxt: $('#progressTxt'),
    assetInfo: $('#assetInfo'),
    thumbs: $('#thumbs'),
    wmTabs: $('#wmTabs'),
    wmList: $('#wmList'),
    savedHint: $('#savedHint'),
    baseTabs: $('#baseTabs'),
    baseState: $('#baseState'),
    baseColor: $('#baseColor'),
    swatches: $('#swatches'),
    solidPanel: $('#solidPanel'),
    tplPanel: $('#tplPanel'),
    noneTip: $('#noneTip'),
    showHead: $('#showHead'),
    headFields: $('#headFields'),
    tplDrop: $('#tplDrop'),
    inputTpl: $('#inputTpl'),
    tplControls: $('#tplControls'),
    tplThumb: $('#tplThumb'),
    tplSize: $('#tplSize'),
    layoutState: $('#layoutState'),
    quickLayout: $('#quickLayout'),
    cols: $('#cols'),
    gap: $('#gap'),
    margin: $('#margin'),
    radius: $('#radius'),
    fill: $('#fill'),
    lastRowFill: $('#lastRowFill'),
    headerTitle: $('#headerTitle'),
    headerMeta: $('#headerMeta'),
    outWidth: $('#outWidth'),
    outFormat: $('#outFormat'),
    quality: $('#quality'),
    qualityRow: $('#qualityRow'),
    outInfo: $('#outInfo'),
    stageWrap: $('#stageWrap'),
    stageCanvas: $('#stageCanvas'),
    preview: $('#preview'),
    empty: $('#empty'),
    stageMeta: $('#stageMeta'),
  };

  /* ---------------- 保存 ---------------- */
  function flashSaved() {
    const h = $('#savedHint');
    if (!h) return;
    h.classList.add('show');
    clearTimeout(flashSaved._t);
    flashSaved._t = setTimeout(() => h.classList.remove('show'), 1400);
  }

  const saveDebounced = U.debounce(() => {
    MN.store.save(state);
    flashSaved();
  }, 450);

  function commit(immediateSave) {
    scheduleRender();
    updateOutInfo();
    if (immediateSave) { MN.store.save(state); flashSaved(); }
    else saveDebounced();
  }

  /* ---------------- 渲染调度 ---------------- */
  function scheduleRender() {
    if (rafId) return;
    rafId = requestAnimationFrame(() => {
      rafId = 0;
      drawPreview();
    });
  }

  function drawPreview() {
    const stageEl = el.stageWrap.closest('.stage');
    if (stageEl) stageEl.classList.toggle('is-empty', !state.files.length);
    syncJump();

    if (!state.files.length) {
      el.stageCanvas.hidden = true;
      el.empty.hidden = false;
      el.stageMeta.textContent = '等待素材…';
      $('#btnExport').disabled = true;
      $('#btnCopy').disabled = true;
      return;
    }
    $('#btnExport').disabled = false;
    $('#btnCopy').disabled = false;
    el.stageCanvas.hidden = false;
    el.empty.hidden = true;

    const availW = Math.max(240, el.stageWrap.clientWidth - 48);
    const availH = Math.max(200, el.stageWrap.clientHeight - 48);

    // 先按导出比例算出预览盒子的显示尺寸，保证整张图一眼可见
    const probe = MN.Render.layout(1000, state);
    const ratio = probe.H / probe.W;
    const isMobile = window.matchMedia('(max-width: 920px)').matches;
    let displayW = Math.min(availW, 1100);
    // 适应模式：整图一眼可见；铺满模式：按容器宽度显示，可滚动查看
    const useFit = !isMobile && fitMode === 'fit';
    if (useFit && displayW * ratio > availH) displayW = availH / ratio;
    displayW = Math.max(200, Math.floor(displayW));

    const dpr = Math.min(window.devicePixelRatio || 1, 2);
    // 手机竖屏一格只有 ~684px 宽，字号 0.65 时水印字高不到 10px，调透明度几乎看不出来。
    // 移动端把画布渲染分辨率放大 1.7 倍（显示尺寸不变，可缩放/滚动查看细节），
    // 让小字也有足够像素来表现透明度变化。
    const resBoost = isMobile ? 1.7 : 1;
    let pxW = Math.max(280, Math.round(displayW * dpr * resBoost));

    let lay = MN.Render.layout(pxW, state);
    const budget = 26e6;
    if (lay.W * lay.H > budget) {
      pxW = Math.round(pxW * Math.sqrt(budget / (lay.W * lay.H)));
      lay = MN.Render.layout(pxW, state);
      displayW = Math.round(displayW * Math.sqrt(budget / (probe.W * probe.H)) * 1.0);
    }

    const ctx = el.preview.getContext('2d');
    try {
      MN.Render.renderTo(ctx, pxW, state, { guides });
    } catch (e) {
      console.warn(e);
      MN.toast('预览渲染失败，图片可能过大');
      return;
    }

    el.preview.style.width = displayW + 'px';
    el.preview.style.height = 'auto';

    const outLay = MN.Render.layout(state.export.width, state);
    el.stageMeta.textContent =
      `${state.files.length} 张 · ${lay.cols} 列 · ${outLay.W}×${outLay.H}`;
  }

  /* ---------------- 输出信息 ---------------- */
  function updateOutInfo() {
    if (!state.files.length) {
      el.outInfo.innerHTML = '<span>添加素材后显示输出尺寸</span>';
      return;
    }
    const lay = MN.Render.layout(state.export.width, state);
    const megapixel = ((lay.W * lay.H) / 1e6).toFixed(1);
    const tooBig = lay.H > 16000 || lay.W * lay.H > 120e6;
    el.outInfo.innerHTML = `
      <span>输出尺寸 <b>${lay.W} × ${lay.H}</b></span>
      <span>${megapixel} MP · ${state.files.length} 张</span>
      <span class="${tooBig ? 'warn' : ''}">${tooBig ? '尺寸过大，建议降低宽度或减少张数' : '尺寸正常'}</span>`;
  }

  /* ---------------- 缩略图 ---------------- */
  function renderThumbs() {
    el.thumbs.innerHTML = state.files
      .map((f, i) => `<div class="thumb" data-i="${i}">
        <img src="${f.thumbUrl}" alt="" loading="lazy">
        <span class="no">${U.pad2(i + 1)}</span>
        <button type="button" title="移除">×</button>
      </div>`)
      .join('');
    el.fileCount.textContent = `${state.files.length} 张`;
    el.fileCount.classList.toggle('on', state.files.length > 0);
    el.assetInfo.hidden = state.files.length === 0;
    const clearBtn = document.getElementById('btnClearFiles');
    if (clearBtn) clearBtn.hidden = state.files.length === 0;
    if (state.files.length) {
    }
  }

  el.thumbs.addEventListener('click', (e) => {
    const btn = e.target.closest('button');
    if (!btn) return;
    const card = btn.closest('.thumb');
    const i = +card.dataset.i;
    const f = state.files[i];
    if (f && f.thumbUrl) URL.revokeObjectURL(f.thumbUrl);
    state.files.splice(i, 1);
    renderThumbs();
    commit();
  });

  // 一键清空全部素材
  document.getElementById('btnClearFiles').addEventListener('click', () => {
    state.files.forEach((f) => f.thumbUrl && URL.revokeObjectURL(f.thumbUrl));
    state.files = [];
    renderThumbs();
    commit(true);
    MN.toast('已清空全部素材');
  });

  /* ---------------- 文件读取 ---------------- */
  function showProgress(done, total) {
    const pct = total ? Math.round((done / total) * 100) : 0;
    el.progress.hidden = false;
    el.progressBar.style.width = pct + '%';
    el.progressTxt.textContent = `${done} / ${total}`;
  }

  async function handleFiles(fileList, source) {
    const arr = Array.from(fileList || []).filter(U.isImage);
    if (!arr.length) { MN.toast('没有找到可用的图片文件'); return; }

    const token = ++loadToken;

    // 清理旧图
    state.files.forEach((f) => f.thumbUrl && URL.revokeObjectURL(f.thumbUrl));
    state.files = [];

    // 文件夹名
    if (source === 'folder') {
      const p = (arr[0].webkitRelativePath || '').split('/');
      if (p.length > 1 && p[0]) {
        state.folderName = p[0];
      } else {
        // 部分手机浏览器选了文件夹也拿不到路径，退回用文件名
        state.folderName = arr[0].name.replace(/\.[^.]+$/, '');
        MN.toast('未读取到文件夹名，已用文件名代替，可在上方修改', 3000);
      }
    } else if (!state.folderName) {
      state.folderName = arr[0].name.replace(/\.[^.]+$/, '') || '素材预览';
    }

    // 从文件夹名解析【日期】名称，如 【20261027】张艺兴 → 时间 20261027 / 名称 张艺兴
    function parseFolder(raw) {
      const m = String(raw || '').match(/^[【\[]\s*([^】\]]+?)\s*[】\]]\s*(.+)$/);
      if (m) return { date: m[1].trim(), name: m[2].trim() };
      // 没有括号时尝试 开头 8 位日期 + 后续文字：20261027张艺兴
      const m2 = String(raw || '').match(/^(\d{8}|\d{4}[.\-/]\d{1,2}[.\-/]\d{1,2})\s*(.+)$/);
      if (m2) return { date: m2[1].trim(), name: m2[2].trim() };
      return { date: '', name: String(raw || '').trim() };
    }
    const parsed = parseFolder(state.folderName);
    if (parsed.name) state.folderName = parsed.name;
    if (parsed.date) {
      // 文件夹名里带了日期，原样保留（如 20261027），不做任何格式化
      state.dateText = parsed.date;
    } else if (!state.dateText) {
      // 没解析出日期、且用户尚未填过，才回退用文件最新修改时间
      const times = arr.map((f) => f.lastModified).filter((t) => t > 0);
      state.dateText = times.length ? U.fmtDate(Math.max(...times)) : U.fmtDate(Date.now());
    }

    // 排序
    arr.sort((a, b) => U.collator.compare(a.webkitRelativePath || a.name, b.webkitRelativePath || b.name));

    const limit = 80;
    const list = arr.slice(0, limit);
    if (arr.length > limit) MN.toast(`一次最多 ${limit} 张，已截取前 ${limit} 张`, 3200);

    showProgress(0, list.length);
    el.progress.hidden = false;

    for (let i = 0; i < list.length; i++) {
      if (token !== loadToken) return;
      const file = list[i];
      try {
        const r = await MN.loadBitmap(file, 2600);
        state.files.push({
          id: U.uid(),
          file,
          name: file.name,
          img: r.img,
          w: r.w,
          h: r.h,
          thumbUrl: URL.createObjectURL(file),
        });
      } catch (err) {
        console.warn('跳过无法解析的图片：', file.name, err);
      }
      showProgress(i + 1, list.length);
      if (i % 3 === 0) await new Promise((r) => setTimeout(r, 0));
    }

    el.progress.hidden = true;
    if (token !== loadToken) return;

    if (!state.files.length) {
      MN.toast('图片解析失败，请换成 JPG / PNG 格式（HEIC 需先转换）', 3600);
      return;
    }
    state.countText = String(state.files.length);
    renderThumbs();
    syncRatioTip();
    commit(true);
    MN.toast(`已载入 ${state.files.length} 张图片`);
  }

  /* ---------------- 上传交互 ---------------- */
  el.btnFolder.addEventListener('click', () => el.inputFolder.click());
  el.btnFiles.addEventListener('click', () => el.inputFiles.click());
  el.dropzone.addEventListener('click', (e) => {
    if (e.target.closest('button')) return;
    el.inputFolder.click();
  });

  el.inputFolder.addEventListener('change', (e) => {
    if (e.target.files.length) handleFiles(e.target.files, 'folder');
    e.target.value = '';
  });
  el.inputFiles.addEventListener('change', (e) => {
    if (e.target.files.length) handleFiles(e.target.files, 'files');
    e.target.value = '';
  });

  // 拖拽
  ['dragenter', 'dragover'].forEach((ev) =>
    el.dropzone.addEventListener(ev, (e) => {
      e.preventDefault();
      el.dropzone.classList.add('hot');
    })
  );
  ['dragleave', 'drop'].forEach((ev) =>
    el.dropzone.addEventListener(ev, (e) => {
      e.preventDefault();
      el.dropzone.classList.remove('hot');
    })
  );
  el.dropzone.addEventListener('drop', (e) => {
    const dt = e.dataTransfer;
    if (dt && dt.files && dt.files.length) handleFiles(dt.files, 'files');
  });

  // 素材信息的内容输入已并入 01 的自动水印行，这里不再单独绑定

  /* ---------------- 水印列表 ---------------- */
  const ANCHORS = [
    ['tl', '左上'], ['tc', '上中'], ['tr', '右上'],
    ['ml', '左中'], ['mc', '正中'], ['mr', '右中'],
    ['bl', '左下'], ['bc', '下中'], ['br', '右下'],
  ];

  function wmListRef() {
    return wmTab === 'per' ? state.wmPer : state.wmGlobal;
  }

  const wmPosOpen = new Set();

  function fmtPct(v) {
    const n = Math.round(+v || 0);
    return (n > 0 ? '+' : '') + n + '%';
  }

  // 水印条目：kind='text'（文字）或 kind='image'（PNG 图）
  function isImg(it) { return it && it.kind === 'image'; }

  function renderWmList() {
    const list = wmListRef();
    if (!list.length) {
      el.wmList.innerHTML = `<div class="wm-empty">暂无水印，点下方按钮添加</div>`;
      return;
    }
    el.wmList.innerHTML = list
      .map((it, i) => {
        const dx = +it.dx || 0;
        const dy = +it.dy || 0;
        const free = !!it.free;
        const px = it.px == null ? 8 : +it.px;
        const py = it.py == null ? 92 : +it.py;
        const open = wmPosOpen.has(it.id);
        const op = it.opacity == null ? (isImg(it) ? 0.18 : 0.9) : it.opacity;
        const opPct = Math.round(op * 100) + '%';

        // 图片水印：顶部显示缩略图 + 文件名
        const head = isImg(it)
          ? `<div class="wm-item-top wm-img-top">
               <img class="wm-img-thumb" src="${it.thumbUrl || it.src || ''}" alt="">
               <span class="wm-img-name">${U.esc(it.name || '花纹 PNG')}</span>
               <button class="wm-del" type="button" title="删除">×</button>
             </div>`
          : `<div class="wm-item-top">
               <input type="text" class="wm-text" value="${U.esc(it.text || '')}" placeholder="输入水印文字，可用占位符">
               <button class="wm-del" type="button" title="删除">×</button>
             </div>`;

        // 图片水印的专属控件：平铺 / 单张 + 尺寸 + 旋转
        const fit = !!it.fitCell;
        const imgRow = isImg(it)
          ? (fit
            ? `<div class="wm-item-bot wm-img-row"><span class="wm-fit-badge">16:9 · 已自适应铺满</span><div class="wm-slide wide"><span>透明</span><input type="range" class="wm-op" min="0.02" max="1" step="0.01" value="${op}"><output class="wm-op-out">${opPct}</output></div></div>`
            : `<div class="wm-item-bot wm-img-row">
               <select class="wm-imgmode">
                 <option value="tile"${it.mode !== 'single' ? ' selected' : ''}>平铺</option>
                 <option value="single"${it.mode === 'single' ? ' selected' : ''}>单张</option>
               </select>
               <div class="wm-slide"><span>尺寸</span><input type="range" class="wm-scale" min="0.05" max="1.5" step="0.01" value="${it.scale == null ? 0.5 : it.scale}"><output class="wm-scale-out">${Math.round((it.scale == null ? 0.5 : it.scale) * 100)}%</output></div>
               <div class="wm-slide"><span>透明</span><input type="range" class="wm-op" min="0.02" max="1" step="0.01" value="${op}"><output class="wm-op-out">${opPct}</output></div>
               <button class="wm-pos-chip${open ? ' on' : ''}" type="button" title="自定义位置">位置</button>
             </div>
             <div class="wm-item-bot wm-img-row2">
               <label class="wm-inline">每行重复<input type="range" class="wm-tile" min="1" max="6" step="1" value="${it.tile == null ? 1 : it.tile}"${it.mode === 'single' ? ' disabled' : ''}><output class="wm-tile-out">${it.tile == null ? 1 : it.tile}</output></label>
               <label class="wm-inline">旋转<input type="range" class="wm-rot" min="-45" max="45" step="1" value="${it.rotate || 0}"><output class="wm-rot-out">${it.rotate || 0}°</output></label>
             </div>`)
          : `<div class="wm-item-bot">
               <input type="color" class="wm-color" value="${U.esc(it.color || inkOn(state))}" title="文字颜色">
               <select class="wm-anchor"${free ? ' disabled' : ''}>
                 ${ANCHORS.map(([v, t]) => `<option value="${v}"${it.anchor === v ? ' selected' : ''}>${t}</option>`).join('')}
               </select>
               <button class="wm-pos-chip${open ? ' on' : ''}" type="button" title="自定义位置">位置</button>
             </div>
             <div class="wm-item-bot">
               <div class="wm-slide wide"><span>字号</span><input type="range" class="wm-size" min="0.5" max="2.6" step="0.05" value="${it.size || 1}"></div>
               <div class="wm-slide wide"><span>透明</span><input type="range" class="wm-op" min="0.05" max="1" step="0.05" value="${op}"><output class="wm-op-out">${opPct}</output></div>
             </div>`;

        // 九宫格下拉：图文都需要（平铺模式下也可选起始角）
        const anchorSel = isImg(it)
          ? `<div class="wm-item-bot wm-img-row3">
               <span class="wm-mini">对齐</span>
               <select class="wm-anchor"${free ? ' disabled' : ''}>
                 ${ANCHORS.map(([v, t]) => `<option value="${v}"${it.anchor === v ? ' selected' : ''}>${t}</option>`).join('')}
               </select>
             </div>`
          : '';

        return `
      <div class="wm-item${isImg(it) ? ' is-img' : ''}" data-i="${i}">
        ${head}
        ${imgRow}
        ${anchorSel}
        <div class="wm-pos"${open ? '' : ' hidden'}>
          <div class="wm-pos-mode">
            <button type="button" class="wm-mode-btn${free ? '' : ' on'}" data-mode="anchor">九宫格</button>
            <button type="button" class="wm-mode-btn${free ? ' on' : ''}" data-mode="free">自由定位</button>
          </div>
          <div class="wm-pos-body"${free ? ' hidden' : ''}>
            <div class="wm-pos-line"><label>左右</label><input type="range" class="wm-dx" min="-50" max="50" step="1" value="${dx}"><output>${fmtPct(dx)}</output></div>
            <div class="wm-pos-line"><label>上下</label><input type="range" class="wm-dy" min="-50" max="50" step="1" value="${dy}"><output>${fmtPct(dy)}</output></div>
          </div>
          <div class="wm-pos-free"${free ? '' : ' hidden'}>
            <div class="wm-pos-line"><label>横向</label><input type="range" class="wm-px" min="0" max="100" step="1" value="${px}"><output>${Math.round(px)}%</output></div>
            <div class="wm-pos-line"><label>纵向</label><input type="range" class="wm-py" min="0" max="100" step="1" value="${py}"><output>${Math.round(py)}%</output></div>
          </div>
          <button class="wm-pos-reset" type="button">归零</button>
        </div>
      </div>`;
      })
      .join('');
  }

  el.wmTabs.addEventListener('click', (e) => {
    const b = e.target.closest('button');
    if (!b) return;
    wmTab = b.dataset.tab;
    $$('button', el.wmTabs).forEach((x) => x.classList.toggle('on', x === b));
    renderWmList();
  });

  el.wmList.addEventListener('input', (e) => {
    const item = e.target.closest('.wm-item');
    if (!item) return;
    const list = wmListRef();
    const it = list[+item.dataset.i];
    if (!it) return;
    const t = e.target;
    const putOut = (sel, txt) => {
      const o = item.querySelector(sel);
      if (o) o.textContent = txt;
    };

    if (t.classList.contains('wm-text')) it.text = t.value;
    else if (t.classList.contains('wm-size')) it.size = +t.value;
    else if (t.classList.contains('wm-op')) {
      it.opacity = +t.value;
      putOut('.wm-op-out', Math.round(+t.value * 100) + '%');
    } else if (t.classList.contains('wm-scale')) {
      it.scale = +t.value;
      putOut('.wm-scale-out', Math.round(+t.value * 100) + '%');
    } else if (t.classList.contains('wm-tile')) {
      it.tile = +t.value;
      putOut('.wm-tile-out', t.value);
    } else if (t.classList.contains('wm-rot')) {
      it.rotate = +t.value;
      putOut('.wm-rot-out', t.value + '°');
    } else if (t.classList.contains('wm-dx') || t.classList.contains('wm-dy')) {
      const isX = t.classList.contains('wm-dx');
      if (isX) it.dx = +t.value; else it.dy = +t.value;
      const out = t.parentElement.querySelector('output');
      if (out) out.textContent = fmtPct(t.value);
    } else if (t.classList.contains('wm-color')) {
      it.color = t.value;
    } else if (t.classList.contains('wm-px') || t.classList.contains('wm-py')) {
      const isX = t.classList.contains('wm-px');
      if (isX) it.px = +t.value; else it.py = +t.value;
      const out = t.parentElement.querySelector('output');
      if (out) out.textContent = Math.round(+t.value) + '%';
    } else return;
    commit();
  });

  el.wmList.addEventListener('change', (e) => {
    const item = e.target.closest('.wm-item');
    const list = wmListRef();
    const it = item ? list[+item.dataset.i] : null;
    if (!it) return;
    if (e.target.classList.contains('wm-anchor')) {
      it.anchor = e.target.value;
      commit(true);
    } else if (e.target.classList.contains('wm-imgmode')) {
      it.mode = e.target.value;
      renderWmList();
      commit(true);
    }
  });

  el.wmList.addEventListener('click', (e) => {
    const item = e.target.closest('.wm-item');
    if (!item) return;
    const idx = +item.dataset.i;
    const it = wmListRef()[idx];
    if (!it) return;

    if (e.target.classList.contains('wm-del')) {
      wmPosOpen.delete(it.id);
      if (it.kind === 'image' && it.thumbUrl) URL.revokeObjectURL(it.thumbUrl);
      wmListRef().splice(idx, 1);
      renderWmList();
      commit(true);
      return;
    }

    const chip = e.target.closest('.wm-pos-chip');
    if (chip) {
      const panel = item.querySelector('.wm-pos');
      const open = panel.hidden;
      panel.hidden = !open;
      chip.classList.toggle('on', open);
      if (open) wmPosOpen.add(it.id); else wmPosOpen.delete(it.id);
      return;
    }

    // 切换 九宫格 / 自由定位
    const modeBtn = e.target.closest('.wm-mode-btn');
    if (modeBtn) {
      const toFree = modeBtn.dataset.mode === 'free';
      it.free = toFree;
      if (toFree && it.px == null) { it.px = 8; it.py = 92; }
      wmPosOpen.add(it.id);
      renderWmList();
      commit(true);
      return;
    }

    const reset = e.target.closest('.wm-pos-reset');
    if (reset) {
      it.dx = 0;
      it.dy = 0;
      it.px = 8;
      it.py = 92;
      const dx = item.querySelector('.wm-dx');
      const dy = item.querySelector('.wm-dy');
      const px = item.querySelector('.wm-px');
      const py = item.querySelector('.wm-py');
      if (dx) { dx.value = 0; dx.parentElement.querySelector('output').textContent = fmtPct(0); }
      if (dy) { dy.value = 0; dy.parentElement.querySelector('output').textContent = fmtPct(0); }
      if (px) { px.value = 8; px.parentElement.querySelector('output').textContent = '8%'; }
      if (py) { py.value = 92; py.parentElement.querySelector('output').textContent = '92%'; }
      commit(true);
    }
  });

  /* ---------------- 添加水印 ---------------- */
  $('#btnWmAdd').addEventListener('click', () => {
    wmListRef().push({
      id: U.uid(),
      kind: 'text',
      text: '',
      anchor: wmTab === 'per' ? 'tl' : 'bc',
      size: 1,
      opacity: 0.85,
      weight: 400,
      color: inkOn(state),
    });
    renderWmList();
    commit(true);
  });

  // 添加 PNG 图片水印
  async function addImageWm(file) {
    if (!file) return;
    if (!/^image\/(png|webp|jpeg|svg\+xml)$/.test(file.type || '') && !/\.(png|webp|jpe?g)$/i.test(file.name || '')) {
      MN.toast('请选择 PNG 格式的透明底图片', 3000);
      return;
    }
    try {
      // 不限制水印图片尺寸，原尺寸读入（仅超大图保险降到 10000px）
      const r = await MN.loadBitmap(file, 10000);
      // 16:9 的图（与素材比例一致）→ 自动自适应铺满每个格子；其他比例按可调方式处理
      const ratio = r.w / r.h;
      const fitCell = Math.abs(ratio - 16 / 9) < 0.04;
      wmListRef().push({
        id: U.uid(),
        kind: 'image',
        name: file.name,
        img: r.img,
        naturalW: r.w,
        naturalH: r.h,
        thumbUrl: URL.createObjectURL(file),
        fitCell,
        mode: fitCell ? 'single' : 'tile',
        scale: wmTab === 'per' ? 0.5 : 0.45,
        tile: 1,
        rotate: 0,
        opacity: wmTab === 'per' ? 0.16 : 0.2,
        anchor: 'tl',
        dx: 0,
        dy: 0,
      });
      renderWmList();
      commit(true);
      MN.toast(fitCell ? '16:9 图片水印已自适应铺满' : '已添加图片水印，可调尺寸和透明度');
    } catch (err) {
      MN.toast('这张图片打不开，换一张试试', 3000);
    }
  }

  const inputWmImg = $('#inputWmImg');
  if (inputWmImg) {
    inputWmImg.addEventListener('change', (e) => {
      const f = e.target.files && e.target.files[0];
      e.target.value = '';
      if (f) addImageWm(f);
    });
  }
  const btnWmImg = $('#btnWmImg');
  if (btnWmImg) btnWmImg.addEventListener('click', () => inputWmImg && inputWmImg.click());

  // 恢复推荐配置
  const btnWmDefault = $('#btnWmDefault');
  if (btnWmDefault) {
    btnWmDefault.addEventListener('click', () => {
      const d = MN.store.defaultState();
      if (wmTab === 'per') state.wmPer = d.wmPer;
      else state.wmGlobal = d.wmGlobal;
      renderWmList();
      commit(true);
      MN.toast('已恢复推荐水印配置');
    });
  }

  // 清空当前页
  const btnWmClear = $('#btnWmClear');
  if (btnWmClear) {
    btnWmClear.addEventListener('click', () => {
      if (wmTab === 'per') state.wmPer = [];
      else state.wmGlobal = [];
      renderWmList();
      commit(true);
      MN.toast('已清空，可重新输入');
    });
  }

  /* ---------------- 01 素材信息 + 自动水印（名称 / 日期 / 张数） ---------------- */
  const AUTO_KEYS = [
    ['folder', '名称', '{folder}', 'folderName', '文件夹名称'],
    ['date', '日期', '{date}', 'dateText', '如 20261027'],
    ['count', '张数', '{count}', 'countText', '导入后自动填'],
  ];

  const AUTO_DEFAULT_TEXT = { folder: '{folder}', date: '{date}', count: '{count}' };
  const AUTO_PH = { folder: '{folder}', date: '{date}', count: '{count}' };

  // 每条水印的「内容」就是上面那个输入框的值（名称/日期/张数）
  function contentOf(key) {
    if (key === 'folder') return state.folderName || '';
    if (key === 'date') return state.dateText || '';
    return state.countText || '';
  }
  function setContent(key, v) {
    if (key === 'folder') state.folderName = v;
    else if (key === 'date') state.dateText = v;
    else state.countText = v;
  }

  // 底图是浅色时水印用深墨色，深色底图时用白色，避免默认看不见
  function inkOn(st) {
    const c = String((st && st.canvas && st.canvas.color) || '#f2efe8');
    const m = /^#?([0-9a-f]{3}|[0-9a-f]{6})$/i.exec(c.trim());
    if (!m) return '#1d1a15';
    let hex = m[1];
    if (hex.length === 3) hex = hex.split('').map((x) => x + x).join('');
    const r = parseInt(hex.slice(0, 2), 16), g = parseInt(hex.slice(2, 4), 16), b = parseInt(hex.slice(4, 6), 16);
    return (0.2126 * r + 0.7152 * g + 0.0722 * b) / 255 > 0.6 ? '#1d1a15' : '#ffffff';
  }

  function autoWmRef(key) {
    if (!state.autoWm[key]) state.autoWm[key] = { on: false, text: AUTO_DEFAULT_TEXT[key], anchor: 'bl', size: 1, opacity: 0.9, weight: 400, color: inkOn(state), dx: 0, dy: 0 };
    if (state.autoWm[key].text == null) state.autoWm[key].text = AUTO_DEFAULT_TEXT[key];
    return state.autoWm[key];
  }

  // 01 里每条水印的「位置」面板是否展开（不持久化，纯 UI 状态）
  const awPosOpen = new Set();

  function renderAutoWm() {
    const box = document.getElementById('autoWmBox');
    if (!box) return;
    box.innerHTML = AUTO_KEYS.map(([key, label, phText, inputId, inputPh]) => {
      const a = autoWmRef(key);
      const on = !!a.on;
      const free = !!a.free;
      const dx = +a.dx || 0;
      const dy = +a.dy || 0;
      const px = a.px == null ? 8 : +a.px;
      const py = a.py == null ? 92 : +a.py;
      const op = a.opacity == null ? 0.9 : a.opacity;
      const open = awPosOpen.has(key);
      return `
      <div class="auto-row${on ? '' : ' off'}" data-key="${key}">
        <div class="auto-row-top">
          <button type="button" class="aw-on${on ? ' on' : ''}" title="点一下开关此水印">${label}</button>
          <input type="text" class="aw-content" data-key="${key}" value="${U.esc(contentOf(key))}" placeholder="${inputPh}">
          <button type="button" class="aw-clear" title="清空内容">×</button>
        </div>
        <div class="auto-row-bot"${on ? '' : ' hidden'}>
          <input type="color" class="aw-color" value="${U.esc(a.color || '#ffffff')}" title="水印颜色">
          <select class="aw-anchor"${free ? ' disabled' : ''} title="位置">
            ${ANCHORS.map(([v, t]) => `<option value="${v}"${a.anchor === v ? ' selected' : ''}>${t}</option>`).join('')}
          </select>
          <button class="aw-pos-chip${open ? ' on' : ''}" type="button" title="自定义位置">位置</button>
        </div>
        <div class="auto-row-bot"${on ? '' : ' hidden'}>
          <div class="wm-slide"><span>字号</span><input type="range" class="aw-size" min="0.4" max="2.6" step="0.05" value="${a.size || 1}"><output class="aw-size-out">${(a.size || 1).toFixed(2)}</output></div>
        </div>
        <div class="auto-row-bot"${on ? '' : ' hidden'}>
          <div class="wm-slide"><span>透明</span><input type="range" class="aw-op" min="0.02" max="1" step="0.01" value="${op}"><output class="aw-op-out">${Math.round(op * 100)}%</output><i class="aw-op-meter" data-lv="1.00,0.80,0.60,0.40,0.20,0.05" style="opacity:${op}" title="拖动时这里会同步变淡，等于水印在深底图上的实际效果"></i></div>
        </div>
        <div class="aw-pospanel"${on && open ? '' : ' hidden'}>
          <div class="wm-pos-mode">
            <button type="button" class="aw-mode-btn${free ? '' : ' on'}" data-mode="anchor">九宫格</button>
            <button type="button" class="aw-mode-btn${free ? ' on' : ''}" data-mode="free">自由定位</button>
          </div>
          <div class="wm-pos-body"${free ? ' hidden' : ''}>
            <div class="wm-pos-line"><label>左右</label><input type="range" class="aw-dx" min="-50" max="50" step="1" value="${dx}"><output>${fmtPct(dx)}</output></div>
            <div class="wm-pos-line"><label>上下</label><input type="range" class="aw-dy" min="-50" max="50" step="1" value="${dy}"><output>${fmtPct(dy)}</output></div>
          </div>
          <div class="wm-pos-free"${free ? '' : ' hidden'}>
            <div class="wm-pos-line"><label>横向</label><input type="range" class="aw-px" min="0" max="100" step="1" value="${px}"><output>${Math.round(px)}%</output></div>
            <div class="wm-pos-line"><label>纵向</label><input type="range" class="aw-py" min="0" max="100" step="1" value="${py}"><output>${Math.round(py)}%</output></div>
          </div>
          <button class="aw-pos-reset wm-pos-reset" type="button">归零</button>
        </div>
        <div class="auto-row-tpl"${on ? '' : ' hidden'}>
          <span class="aw-tpl-label">水印文字</span>
          <input type="text" class="aw-text" value="${U.esc(a.text == null ? AUTO_DEFAULT_TEXT[key] : a.text)}" placeholder="${AUTO_PH[key]}">
        </div>
      </div>`;
    }).join('');
  }

  const autoBox = document.getElementById('autoWmBox');
  if (autoBox) {
    autoBox.addEventListener('click', (e) => {
      const row = e.target.closest('.auto-row');
      if (!row) return;
      const key = row.dataset.key;
      if (e.target.classList.contains('aw-on')) {
        const a = autoWmRef(key);
        a.on = !a.on;
        renderAutoWm();
        commit(true);
        return;
      }
      if (e.target.classList.contains('aw-clear')) {
        setContent(key, '');
        const inp = row.querySelector('.aw-content');
        if (inp) inp.value = '';
        commit();
        return;
      }

      const chip = e.target.closest('.aw-pos-chip');
      if (chip) {
        const panel = row.querySelector('.aw-pospanel');
        const open = panel.hidden;
        panel.hidden = !open;
        chip.classList.toggle('on', open);
        if (open) awPosOpen.add(key); else awPosOpen.delete(key);
        return;
      }

      // 九宫格 / 自由定位
      const modeBtn = e.target.closest('.aw-mode-btn');
      if (modeBtn) {
        const a = autoWmRef(key);
        const toFree = modeBtn.dataset.mode === 'free';
        a.free = toFree;
        if (toFree && a.px == null) { a.px = 7; a.py = 78; }
        awPosOpen.add(key);
        renderAutoWm();
        commit(true);
        return;
      }

      const reset = e.target.closest('.aw-pos-reset');
      if (reset) {
        const a = autoWmRef(key);
        a.dx = 0; a.dy = 0; a.px = 7; a.py = 78;
        const dx = row.querySelector('.aw-dx');
        const dy = row.querySelector('.aw-dy');
        const px = row.querySelector('.aw-px');
        const py = row.querySelector('.aw-py');
        if (dx) { dx.value = 0; dx.parentElement.querySelector('output').textContent = fmtPct(0); }
        if (dy) { dy.value = 0; dy.parentElement.querySelector('output').textContent = fmtPct(0); }
        if (px) { px.value = 7; px.parentElement.querySelector('output').textContent = '7%'; }
        if (py) { py.value = 78; py.parentElement.querySelector('output').textContent = '78%'; }
        commit(true);
      }
    });
    autoBox.addEventListener('change', (e) => {
      if (!e.target.classList.contains('aw-anchor')) return;
      const row = e.target.closest('.auto-row');
      autoWmRef(row.dataset.key).anchor = e.target.value;
      commit(true);
    });
    autoBox.addEventListener('input', (e) => {
      const row = e.target.closest('.auto-row');
      if (!row) return;
      const key = row.dataset.key;
      const a = autoWmRef(key);
      const t = e.target;
      if (t.classList.contains('aw-content')) {
        setContent(key, t.value);
      } else if (t.classList.contains('aw-text')) {
        a.text = t.value;
      } else if (t.classList.contains('aw-size')) {
        a.size = +t.value;
        const o = row.querySelector('.aw-size-out');
        if (o) o.textContent = (+t.value).toFixed(2);
      } else if (t.classList.contains('aw-op')) {
        a.opacity = +t.value;
        const o = row.querySelector('.aw-op-out');
        if (o) o.textContent = Math.round(+t.value * 100) + '%';
        const meter = row.querySelector('.aw-op-meter');
        if (meter) meter.style.opacity = (+t.value).toFixed(2);
      } else if (t.classList.contains('aw-color')) {
        a.color = t.value;
      } else if (t.classList.contains('aw-dx') || t.classList.contains('aw-dy')) {
        const isX = t.classList.contains('aw-dx');
        if (isX) a.dx = +t.value; else a.dy = +t.value;
        const out = t.parentElement.querySelector('output');
        if (out) out.textContent = fmtPct(t.value);
      } else if (t.classList.contains('aw-px') || t.classList.contains('aw-py')) {
        const isX = t.classList.contains('aw-px');
        if (isX) a.px = +t.value; else a.py = +t.value;
        const out = t.parentElement.querySelector('output');
        if (out) out.textContent = Math.round(+t.value) + '%';
      } else return;
      commit();
    });
  }

  /* ---------------- 底图 ---------------- */
  function canvasCfg() {
    if (!state.canvas) state.canvas = { mode: 'solid', color: '#f2efe8', header: true };
    return state.canvas;
  }

  /* ---- 标题 / 相关信息 的样式与位置 ---- */
  function headCfg() {
    if (!state.header) state.header = { title: '', meta: '' };
    const h = state.header;
    if (!h.titleStyle) h.titleStyle = { anchor: 'ml', dx: 0, dy: 0, size: 0, color: '', spacing: null };
    if (!h.metaStyle) h.metaStyle = { anchor: 'mr', dx: 0, dy: 0, size: 0, color: '' };
    return h;
  }

  function styleOf(which) {
    const h = headCfg();
    return which === 'meta' ? h.metaStyle : h.titleStyle;
  }

  // 底图明暗决定「自动色」的默认值，用于色点回显
  function autoInk() {
    const c = String((state.canvas && state.canvas.color) || '#f2efe8').replace('#', '');
    const hex = c.length === 3 ? c.split('').map((x) => x + x).join('') : c;
    const r = parseInt(hex.slice(0, 2), 16) || 0;
    const g = parseInt(hex.slice(2, 4), 16) || 0;
    const b = parseInt(hex.slice(4, 6), 16) || 0;
    return (0.2126 * r + 0.7152 * g + 0.0722 * b) / 255 > 0.6 ? '#16161c' : '#f4f1ea';
  }

  function fmtSigned(v) {
    const n = Math.round(+v || 0);
    return (n > 0 ? '+' : '') + n + '%';
  }

  function syncHeadStyleUI() {
    const h = headCfg();
    [['title', h.titleStyle], ['meta', h.metaStyle]].forEach(([which, st]) => {
      const box = which === 'meta' ? $('#metaStyleBox') : $('#titleStyleBox');
      if (!box) return;
      const anchorSel = box.querySelector('.hs-anchor');
      const colorInp = box.querySelector('.hs-color');
      const sizeInp = box.querySelector('.hs-size');
      const dxInp = box.querySelector('.hs-dx');
      const dyInp = box.querySelector('.hs-dy');
      if (anchorSel) anchorSel.value = st.anchor || (which === 'meta' ? 'mr' : 'ml');
      if (colorInp) colorInp.value = st.color || autoInk();
      if (sizeInp) {
        const def = which === 'meta' ? 0.0152 : 0.047;
        sizeInp.value = st.size > 0 ? st.size : def;
      }
      if (dxInp) dxInp.value = +st.dx || 0;
      if (dyInp) dyInp.value = +st.dy || 0;
      const sizeOut = box.querySelector('.hs-size ~ output, output');
      const outs = box.querySelectorAll('output');
      if (outs[0]) outs[0].textContent = st.size > 0 ? (st.size * 100).toFixed(1) : '自动';
      if (outs[1]) outs[1].textContent = fmtSigned(st.dx);
      if (outs[2]) outs[2].textContent = fmtSigned(st.dy);
      // 颜色是否被用户改过：没改过时标注「自动」
      if (colorInp) colorInp.title = st.color ? '自定义颜色' : '自动（跟随底图明暗）';
    });
  }

  function bindHeadStyle() {
    ['titleStyleBox', 'metaStyleBox'].forEach((id) => {
      const box = document.getElementById(id);
      if (!box) return;
      const which = id === 'metaStyleBox' ? 'meta' : 'title';

      box.addEventListener('change', (e) => {
        const t = e.target;
        const st = styleOf(which);
        if (t.classList.contains('hs-anchor')) { st.anchor = t.value; }
        else if (t.classList.contains('hs-color')) { st.color = t.value; }
        else return;
        syncHeadStyleUI();
        commit(true);
      });

      box.addEventListener('input', (e) => {
        const t = e.target;
        const st = styleOf(which);
        if (t.classList.contains('hs-color')) { st.color = t.value; }
        else if (t.classList.contains('hs-size')) {
          st.size = +t.value;
          const o = box.querySelectorAll('output')[0];
          if (o) o.textContent = (+t.value * 100).toFixed(1);
        } else if (t.classList.contains('hs-dx')) {
          st.dx = +t.value;
          const o = box.querySelectorAll('output')[1];
          if (o) o.textContent = fmtSigned(t.value);
        } else if (t.classList.contains('hs-dy')) {
          st.dy = +t.value;
          const o = box.querySelectorAll('output')[2];
          if (o) o.textContent = fmtSigned(t.value);
        } else return;
        commit();
      });

      box.addEventListener('click', (e) => {
        const b = e.target.closest('.hs-reset');
        if (!b) return;
        const st = styleOf(which);
        st.anchor = which === 'meta' ? 'mr' : 'ml';
        st.dx = 0; st.dy = 0; st.size = 0; st.color = '';
        syncHeadStyleUI();
        commit(true);
      });
    });
  }

  function syncBaseUI() {
    const c = canvasCfg();
    const mode = c.mode || 'solid';
    $$('button', el.baseTabs).forEach((b) => b.classList.toggle('on', b.dataset.mode === mode));
    el.solidPanel.hidden = mode !== 'solid';
    el.tplPanel.hidden = mode !== 'image';
    el.noneTip.hidden = mode !== 'none';

    el.baseColor.value = c.color || '#f2efe8';
    el.showHead.checked = c.header !== false;
    el.headFields.hidden = !el.showHead.checked;
    syncHeadStyleUI();
    $$('button', el.swatches).forEach((b) => {
      b.classList.toggle('on', (b.dataset.c || '').toLowerCase() === String(c.color || '').toLowerCase());
    });

    el.baseState.textContent = mode === 'solid' ? '纯色' : mode === 'image' ? '自定义' : '无底图';
    el.baseState.classList.toggle('on', mode !== 'none');

    const has = !!(state.template && state.template.img);
    el.tplControls.hidden = !has;
    el.tplDrop.hidden = has;
    if (has) {
      if (!el.tplThumb.getAttribute('src')) {
        const c2 = document.createElement('canvas');
        c2.width = 108; c2.height = 108;
        const cx = c2.getContext('2d');
        cx.fillStyle = '#f2f0eb';
        cx.fillRect(0, 0, 108, 108);
        const s = Math.min(108 / state.template.w, 108 / state.template.h);
        const dw = state.template.w * s, dh = state.template.h * s;
        cx.drawImage(state.template.img, (108 - dw) / 2, (108 - dh) / 2, dw, dh);
        el.tplThumb.src = c2.toDataURL('image/jpeg', 0.8);
      }
      el.tplSize.textContent = `${state.template.w} × ${state.template.h} · ${state.template.aspect.toFixed(2)}:1`;
      setSlider('#padT', state.template.pad.t);
      setSlider('#padR', state.template.pad.r);
      setSlider('#padB', state.template.pad.b);
      setSlider('#padL', state.template.pad.l);
    } else {
      el.tplThumb.removeAttribute('src');
    }
  }

  el.baseTabs.addEventListener('click', (e) => {
    const b = e.target.closest('button');
    if (!b) return;
    canvasCfg().mode = b.dataset.mode;
    syncBaseUI();
    commit(true);
  });

  el.baseColor.addEventListener('input', (e) => {
    canvasCfg().color = e.target.value;
    syncBaseUI();
    commit();
  });

  el.swatches.addEventListener('click', (e) => {
    const b = e.target.closest('button');
    if (!b) return;
    canvasCfg().color = b.dataset.c;
    syncBaseUI();
    commit(true);
  });

  el.showHead.addEventListener('change', (e) => {
    canvasCfg().header = e.target.checked;
    el.headFields.hidden = !e.target.checked;
    commit(true);
  });

  bindHeadStyle();

  el.tplDrop.addEventListener('click', () => el.inputTpl.click());

  el.inputTpl.addEventListener('change', async (e) => {
    const f = e.target.files[0];
    e.target.value = '';
    if (!f) return;
    await applyTemplate(f);
  });

  async function applyTemplate(file) {
    try {
      const r = await MN.loadBitmap(file, 3000);
      const prevPad = (state.template && state.template.pad) || { t: 20, r: 4, b: 12, l: 4 };
      state.template = {
        aspect: r.w / r.h,
        pad: Object.assign({}, prevPad),
        img: r.img,
        w: r.w,
        h: r.h,
      };
      canvasCfg().mode = 'image';
      await MN.idb.set('template', file);
      syncBaseUI();
      commit(true);
      MN.toast('底图已应用');
    } catch (err) {
      MN.toast('底图图片无法解析，请换成 JPG / PNG');
    }
  }

  $('#btnTplRemove').addEventListener('click', async () => {
    state.template = null;
    await MN.idb.del('template');
    el.tplThumb.removeAttribute('src');
    syncBaseUI();
    commit(true);
    MN.toast('已移除底图');
  });

  [['#padT', 't'], ['#padR', 'r'], ['#padB', 'b'], ['#padL', 'l']].forEach(([sel, key]) => {
    const input = $(sel);
    input.addEventListener('input', () => {
      if (!state.template) return;
      state.template.pad[key] = +input.value;
      syncOutputOfSlider(input);
      commit();
    });
  });

  $('#showGuides').addEventListener('change', (e) => {
    guides = e.target.checked;
    scheduleRender();
  });

  // 从 IndexedDB 恢复底图
  (async function restoreTemplate() {
    if (!state.template) return;
    const blob = await MN.idb.get('template');
    if (!blob) { state.template = null; syncBaseUI(); return; }
    try {
      const r = await MN.loadBitmap(blob, 3000);
      state.template.img = r.img;
      state.template.w = r.w;
      state.template.h = r.h;
      state.template.aspect = r.w / r.h;
      syncBaseUI();
      scheduleRender();
    } catch (e) {
      state.template = null;
      syncBaseUI();
    }
  })();

  /* ---------------- 版式控件 ---------------- */
  const sliderDefs = [
    ['#cols', 'cols', (v) => `${v} 列`],
    ['#gap', 'gap', (v) => v.toFixed(1) + '%'],
    ['#margin', 'margin', (v) => v.toFixed(1) + '%'],
    ['#radius', 'radius', (v) => v.toFixed(2)],
    ['#quality', null, (v) => Math.round(v * 100) + '%'],
    ['#padT', null, (v) => v + '%'],
    ['#padR', null, (v) => v + '%'],
    ['#padB', null, (v) => v + '%'],
    ['#padL', null, (v) => v + '%'],
  ];

  function syncOutputOfSlider(input) {
    const out = input.parentElement.querySelector('output');
    if (!out) return;
    const def = sliderDefs.find((d) => d[0] === '#' + input.id);
    out.textContent = def ? def[2](+input.value) : input.value;
  }

  function setSlider(sel, val) {
    const input = $(sel);
    if (!input) return;
    input.value = val;
    syncOutputOfSlider(input);
  }

  $('#cols').addEventListener('input', (e) => {
    state.layout.cols = +e.target.value;
    syncOutputOfSlider(e.target);
    syncQuickLayout();
    commit();
  });
  ['gap', 'margin', 'radius'].forEach((k) => {
    $('#' + k).addEventListener('input', (e) => {
      state.layout[k] = +e.target.value;
      syncOutputOfSlider(e.target);
      commit();
    });
  });
  $('#quality').addEventListener('input', (e) => {
    state.export.quality = +e.target.value;
    syncOutputOfSlider(e.target);
    saveDebounced();
  });

  el.quickLayout.addEventListener('click', (e) => {
    const b = e.target.closest('button');
    if (!b) return;
    state.layout.cols = +b.dataset.cols;
    setSlider('#cols', state.layout.cols);
    syncQuickLayout();
    commit(true);
  });

  function syncQuickLayout() {
    $$('button', el.quickLayout).forEach((b) => {
      b.classList.toggle('on', +b.dataset.cols === +state.layout.cols);
    });
    if (el.layoutState) el.layoutState.textContent = `${state.layout.cols} 列`;
  }

  // 比例恒为 16:9，填充恒为不裁剪；这里只做兼容，不再提供切换
  state.layout.aspect = '16:9';
  state.layout.fill = 'contain';

  el.lastRowFill.addEventListener('change', () => {
    state.layout.lastRow = el.lastRowFill.checked ? 'fill' : 'center';
    commit(true);
  });

  el.headerTitle.addEventListener('input', () => {
    state.header.title = el.headerTitle.value;
    commit();
  });
  el.headerMeta.addEventListener('input', () => {
    state.header.meta = el.headerMeta.value;
    commit();
  });

  el.outWidth.addEventListener('change', () => {
    state.export.width = +el.outWidth.value;
    updateOutInfo();
    saveDebounced();
  });
  el.outFormat.addEventListener('change', () => {
    state.export.format = el.outFormat.value;
    el.qualityRow.style.display = state.export.format === 'png' ? 'none' : 'flex';
    syncExpState();
    saveDebounced();
  });

  function syncExpState() {
    const b = $('#expState');
    if (b) b.textContent = (state.export.format === 'png' ? 'PNG' : 'JPG') + ' ' + state.export.width;
  }

  /* ---------------- 初始化控件 ---------------- */
  function syncUI() {
    el.headerTitle.value = state.header.title || '';
    el.headerMeta.value = state.header.meta || '';
    setSlider('#cols', state.layout.cols);
    setSlider('#gap', state.layout.gap);
    setSlider('#margin', state.layout.margin);
    setSlider('#radius', state.layout.radius);
    setSlider('#quality', state.export.quality);
    el.lastRowFill.checked = state.layout.lastRow === 'fill';
    el.outWidth.value = String(state.export.width);
    el.outFormat.value = state.export.format;
    el.qualityRow.style.display = state.export.format === 'png' ? 'none' : 'flex';
    syncExpState();
    syncQuickLayout();
    renderWmList();
    syncBaseUI();
    renderAutoWm();
    renderThumbs();
    syncRatioTip();
    updateOutInfo();
  }

  // 版式提示：告诉用户当前格子用的是 16:9 还是素材自身比例
  function syncRatioTip() {
    const tip = document.getElementById('ratioTip');
    if (!tip) return;
    const asp = MN.Render.pickAspect(state);
    const is169 = Math.abs(asp - 16 / 9) < 0.005;
    if (is169) {
      tip.textContent = '单元格比例 16 : 9（素材多数为此比例）';
      tip.classList.remove('on');
    } else {
      tip.textContent = `单元格跟随素材比例 ${asp.toFixed(2)} : 1`;
      tip.classList.add('on');
    }
  }

  /* ---------------- 导出 ---------------- */
  let exporting = false;

  async function buildCanvas(W) {
    const ctxCanvas = document.createElement('canvas');
    const lay = MN.Render.layout(W, state);
    if (lay.H > 16384) throw new Error('too-tall');
    if (lay.W * lay.H > 130e6) throw new Error('too-big');
    ctxCanvas.width = lay.W;
    ctxCanvas.height = lay.H;
    const ctx = ctxCanvas.getContext('2d');
    MN.Render.paint(ctx, lay, state, { guides: false });
    return { canvas: ctxCanvas, lay };
  }

  function toBlob(canvas, type, quality) {
    return new Promise((resolve, reject) => {
      if (canvas.toBlob) {
        canvas.toBlob((b) => (b ? resolve(b) : reject(new Error('blob'))), type, quality);
      } else {
        try {
          const data = canvas.toDataURL(type, quality);
          const bin = atob(data.split(',')[1]);
          const arr = new Uint8Array(bin.length);
          for (let i = 0; i < bin.length; i++) arr[i] = bin.charCodeAt(i);
          resolve(new Blob([arr], { type }));
        } catch (e) { reject(e); }
      }
    });
  }

  function fileName(ext) {
    const base = (state.folderName || 'Monian').replace(/[\\/:*?"<>|\s]+/g, '_').slice(0, 40);
    const d = new Date();
    const stamp = `${d.getFullYear()}${U.pad2(d.getMonth() + 1)}${U.pad2(d.getDate())}`;
    return `${base}_${state.layout.cols}列_${stamp}.${ext}`;
  }

  async function exportImage() {
    if (!state.files.length) { MN.toast('请先添加素材'); return; }
    if (exporting) return;
    exporting = true;
    const btn = $('#btnExport');
    const btn2 = $('#btnExport2');
    const oldTxt = btn.textContent;
    btn.textContent = '生成中…';
    btn.disabled = btn2.disabled = true;

    try {
      const W = state.export.width;
      const { canvas, lay } = await buildCanvas(W);
      const isPng = state.export.format === 'png';
      const type = isPng ? 'image/png' : 'image/jpeg';
      const blob = await toBlob(canvas, type, isPng ? undefined : state.export.quality);

      const name = fileName(isPng ? 'png' : 'jpg');
      const url = URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url;
      a.download = name;
      document.body.appendChild(a);
      a.click();
      a.remove();
      setTimeout(() => URL.revokeObjectURL(url), 4000);

      MN.toast(`已生成 ${lay.W}×${lay.H} · ${U.bytes(blob.size)}`, 3200);
    } catch (err) {
      console.error(err);
      if (err && err.message === 'too-tall') MN.toast('图片太长，请降低输出宽度或减少图片数量', 3600);
      else if (err && err.message === 'too-big') MN.toast('尺寸过大，请降低输出宽度', 3600);
      else MN.toast('生成失败，请降低输出宽度后重试', 3600);
    } finally {
      exporting = false;
      btn.textContent = oldTxt === '生成中…' ? '导出图片' : oldTxt;
      btn.disabled = btn2.disabled = false;
    }
  }

  $('#btnFit').addEventListener('click', () => {
    fitMode = fitMode === 'fit' ? 'fill' : 'fit';
    $('#btnFit').textContent = fitMode === 'fit' ? '铺满' : '适应';
    try { localStorage.setItem('monian.fit', fitMode); } catch (e) {}
    scheduleRender();
  });

  try {
    const f = localStorage.getItem('monian.fit');
    if (f === 'fill' || f === 'fit') {
      fitMode = f;
      $('#btnFit').textContent = fitMode === 'fit' ? '铺满' : '适应';
    }
  } catch (e) {}

  $('#btnExport').addEventListener('click', exportImage);
  $('#btnExport2').addEventListener('click', exportImage);

  $('#btnCopy').addEventListener('click', async () => {
    if (!state.files.length) { MN.toast('请先添加素材'); return; }
    try {
      if (!navigator.clipboard || !window.ClipboardItem) throw new Error('unsupported');
      const { canvas } = await buildCanvas(state.export.width);
      const blob = await toBlob(canvas, 'image/png');
      await navigator.clipboard.write([new ClipboardItem({ 'image/png': blob })]);
      MN.toast('已复制到剪贴板');
    } catch (e) {
      MN.toast('当前浏览器不支持复制，请用「导出图片」', 2800);
    }
  });

  /* ---------------- 重置 / 说明 ---------------- */
  $('#btnResetAll').addEventListener('click', () => {
    if (!confirm('确定要清空所有素材与设置吗？（水印文字也会重置）')) return;
    MN.store.clear();
    MN.idb.del('template');
    wmPosOpen.clear();
    const d = MN.store.defaultState();
    Object.keys(d).forEach((k) => { state[k] = d[k]; });
    state.files.forEach((f) => f.thumbUrl && URL.revokeObjectURL(f.thumbUrl));
    state.files = [];
    state.template = null;
    el.tplThumb.removeAttribute('src');
    syncUI();
    scheduleRender();
    MN.toast('已重置');
  });

  $('#btnGuide').addEventListener('click', () => { $('#guideModal').hidden = false; });
  $('#btnGuideClose').addEventListener('click', () => { $('#guideModal').hidden = true; });
  $('#guideModal').addEventListener('click', (e) => {
    if (e.target.id === 'guideModal') e.target.hidden = true;
  });

  // 快捷键
  document.addEventListener('keydown', (e) => {
    if ((e.metaKey || e.ctrlKey) && e.key === 's') {
      e.preventDefault();
      exportImage();
    }
  });

  // 窗口尺寸变化
  let resizeTimer = null;
  window.addEventListener('resize', () => {
    clearTimeout(resizeTimer);
    resizeTimer = setTimeout(scheduleRender, 180);
  });

  /* ---------------- 折叠卡片 ---------------- */
  const CARD_KEY = 'monian.cards.v1';
  let cardState = {};
  try {
    const raw = localStorage.getItem(CARD_KEY);
    cardState = raw ? (JSON.parse(raw) || {}) : {};
  } catch (e) { cardState = {}; }
  // 首次使用时 03 / 04 默认收起，避免把预览挤出屏幕
  if (!Object.keys(cardState).length) cardState = { base: true, layout: true };

  $$('.card.collapsible').forEach((card) => {
    const id = card.dataset.card;
    const hd = $('.card-hd', card);
    const apply = (collapsed, remember) => {
      card.classList.toggle('collapsed', collapsed);
      hd.setAttribute('aria-expanded', String(!collapsed));
      if (remember) {
        cardState[id] = collapsed;
        try { localStorage.setItem(CARD_KEY, JSON.stringify(cardState)); } catch (e) {}
      }
    };
    if (cardState[id]) apply(true, false);
    const toggle = () => apply(!card.classList.contains('collapsed'), true);
    hd.addEventListener('click', toggle);
    hd.addEventListener('keydown', (e) => {
      if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); toggle(); }
    });
  });

  /* ---------------- 回到预览 ---------------- */
  const btnJump = $('#btnJump');
  function syncJump() {
    if (!btnJump) return;
    const isMobile = window.matchMedia('(max-width: 920px)').matches;
    const show = isMobile && state.files.length > 0 && window.scrollY > 220;
    btnJump.hidden = !show;
    btnJump.classList.toggle('show', show);
  }
  if (btnJump) {
    btnJump.addEventListener('click', () => {
      window.scrollTo({ top: 0, behavior: 'smooth' });
    });
    let jumpTick = 0;
    window.addEventListener('scroll', () => {
      if (jumpTick) return;
      jumpTick = requestAnimationFrame(() => { jumpTick = 0; syncJump(); });
    }, { passive: true });
  }

  /* ---------------- 启动 ---------------- */
  const supportsDir = 'webkitdirectory' in document.createElement('input');
  if (!supportsDir) {
    el.btnFolder.style.display = 'none';
    $('.dz-title').textContent = '点击选择图片，或直接拖入';
    $('.dz-sub').textContent = '当前浏览器不支持选文件夹，请多选图片后手动填写素材名称';
  }

  syncUI();
  scheduleRender();

  // 衬线宋体加载完成后重绘，保证画布水印用上正确字形
  if (document.fonts && document.fonts.load) {
    document.fonts.load('600 20px "Monian Serif"').then(() => scheduleRender()).catch(() => {});
    document.fonts.load('400 20px "Monian Serif"').then(() => scheduleRender()).catch(() => {});
    document.fonts.ready.then(() => scheduleRender()).catch(() => {});
  }

  // 暴露给调试
  MN.state = state;
})();
