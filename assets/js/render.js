/* ===========================================================
   莫念 Monian · render.js
   画布排版与绘制（预览与导出共用同一套比例逻辑）
   =========================================================== */
(function () {
  'use strict';

  const MN = window.MN;
  const U = MN.util;

  const FONT = '"LXGW WenKai","PingFang SC","Hiragino Sans GB","Microsoft YaHei","Noto Sans SC",system-ui,-apple-system,sans-serif';

  /* ---------------- 平滑缩放绘制 ---------------- */
  function drawSmooth(ctx, src, sx, sy, sw, sh, dx, dy, dw, dh) {
    let cur = src, csx = sx, csy = sy, csw = sw, csh = sh;
    let guard = 0;
    while (Math.max(csw / Math.max(dw, 1), csh / Math.max(dh, 1)) > 2.05 && guard++ < 8) {
      const nw = Math.max(1, Math.round(csw / 2));
      const nh = Math.max(1, Math.round(csh / 2));
      const c = document.createElement('canvas');
      c.width = nw; c.height = nh;
      const cx = c.getContext('2d');
      cx.imageSmoothingEnabled = true;
      cx.imageSmoothingQuality = 'high';
      cx.drawImage(cur, csx, csy, csw, csh, 0, 0, nw, nh);
      cur = c; csx = 0; csy = 0; csw = nw; csh = nh;
    }
    ctx.imageSmoothingEnabled = true;
    ctx.imageSmoothingQuality = 'high';
    ctx.drawImage(cur, csx, csy, csw, csh, dx, dy, dw, dh);
  }

  function drawCover(ctx, src, sw0, sh0, dx, dy, dw, dh) {
    const scale = Math.max(dw / sw0, dh / sh0);
    const cw = Math.min(sw0, dw / scale);
    const ch = Math.min(sh0, dh / scale);
    const sx = (sw0 - cw) / 2;
    const sy = (sh0 - ch) / 2;
    drawSmooth(ctx, src, sx, sy, cw, ch, dx, dy, dw, dh);
  }

  /* ---------------- 文本工具 ---------------- */
  function measure(ctx, text) {
    const m = ctx.measureText(text);
    return {
      w: m.width,
      asc: m.fontBoundingBoxAscent || m.actualBoundingBoxAscent || 0,
      desc: m.fontBoundingBoxDescent || m.actualBoundingBoxDescent || 0,
    };
  }

  function setFont(ctx, size, weight) {
    ctx.font = `${weight || 400} ${Math.max(1, size)}px ${FONT}`;
  }

  function drawSpaced(ctx, text, x, y, spacing, align) {
    const chars = Array.from(text);
    let total = 0;
    const ws = chars.map((c) => {
      const w = ctx.measureText(c).width;
      total += w + spacing;
      return w;
    });
    total -= spacing;
    if (total < 0) total = 0;
    let cur = align === 'center' ? x - total / 2 : align === 'right' ? x - total : x;
    const prevAlign = ctx.textAlign;
    ctx.textAlign = 'left';
    chars.forEach((c, i) => {
      ctx.fillText(c, cur, y);
      cur += ws[i] + spacing;
    });
    ctx.textAlign = prevAlign;
    return total;
  }

  function subst(text, vars) {
    if (!text) return '';
    return String(text).replace(/\{(\w+)\}/g, (m, k) => (vars[k] != null && vars[k] !== '' ? vars[k] : ''));
  }

  /* ---------------- 版式计算 ---------------- */
  function computeLayout(W, st) {
    const n = st.files.length;
    const L = st.layout;
    const radius = (W * L.radius) / 100;
    const mode = (st.canvas && st.canvas.mode) || 'solid';

    // 自定义底图：画布比例由底图决定，图片放进设定的放置区域
    if (mode === 'image' && st.template && st.template.img) {
      const asp = st.template.aspect || 1.4;
      const H = Math.max(1, Math.round(W / asp));
      const p = st.template.pad || { t: 20, r: 4, b: 12, l: 4 };
      const area = {
        x: (W * p.l) / 100,
        y: (H * p.t) / 100,
        w: W * (1 - (p.l + p.r) / 100),
        h: H * (1 - (p.t + p.b) / 100),
      };
      const cols = Math.max(1, Math.min(L.cols, n || 1));
      const rows = Math.max(1, Math.ceil(n / cols));
      const gap = (area.w * L.gap) / 100;
      const cellW = Math.max(1, (area.w - gap * (cols - 1)) / cols);
      let cellH = Math.max(1, (area.h - gap * (rows - 1)) / rows);
      let cw = cellW;
      let ch = cellH;
      let gridTop = area.y;

      // 保持比例：按图片比例反推格子尺寸，保证不裁剪，整块居中
      if (L.fill === 'contain') {
        let asp2;
        if (L.aspect === 'auto') {
          const f = st.files[0];
          asp2 = f && f.w && f.h ? f.w / f.h : 0.75;
          asp2 = U.clamp(asp2, 0.4, 2.4);
        } else {
          asp2 = parseFloat(L.aspect) || 0.75;
        }
        const maxH = Math.max(1, (area.h - gap * (rows - 1)) / rows);
        ch = cellW / asp2;
        if (ch > maxH) { ch = maxH; cw = ch * asp2; }
        const gridH = rows * ch + (rows - 1) * gap;
        gridTop = area.y + Math.max(0, (area.h - gridH) / 2);
      }

      const cells = [];
      for (let i = 0; i < n; i++) {
        const r = Math.floor(i / cols), c = i % cols;
        const inRow = Math.min(cols, n - r * cols);
        const rowW = inRow * cw + (inRow - 1) * gap;
        const startX = area.x + (area.w - rowW) / 2;
        cells.push({
          x: startX + c * (cw + gap),
          y: gridTop + r * (ch + gap),
          w: cw, h: ch, i,
        });
      }
      return { W, H, cells, area, mode: 'image', radius, gap, cols, rows, cellW, cellH, gridTop };
    }

    // 纯色底图 / 无底图
    const noBase = mode === 'none';
    const margin = noBase ? 0 : (W * L.margin) / 100;
    const gap = (W * L.gap) / 100;
    const cols = Math.max(1, Math.min(L.cols, n || 1));
    const rows = Math.max(1, Math.ceil(n / cols));
    const cellW = Math.max(1, (W - margin * 2 - gap * (cols - 1)) / cols);

    let aspect;
    if (L.aspect === 'auto') {
      const f = st.files[0];
      aspect = f && f.w && f.h ? f.w / f.h : 0.75;
      // 收窄范围：避免极长条比例把格子拉得过高，导致整张图很长
      aspect = U.clamp(aspect, 0.55, 1.8);
    } else {
      aspect = parseFloat(L.aspect) || 0.75;
    }
    let cellH = cellW / aspect;

    const title = ((st.header && st.header.title) || '').trim();
    const meta = ((st.header && st.header.meta) || '').trim();
    const hasHead = !noBase && (!st.canvas || st.canvas.header !== false) &&
      !!(title || meta || st.folderName);

    const headerH = hasHead ? W * 0.152 : 0;
    const footGap = noBase ? 0 : W * 0.068;
    let padTop = margin + headerH + (hasHead ? gap * 1.6 : 0);
    let padBottom = noBase ? 0 : gap * 2 + footGap + margin;

    // 纯色底图且开启标题栏时：限制整体高宽比，避免竖图 + 多行导致下半截空出一大片
    if (!noBase && hasHead) {
      const maxRatio = 2.25;
      const fixed = padTop + padBottom + (rows - 1) * gap;
      const maxGridH = W * maxRatio - fixed;
      if (rows * cellH > maxGridH) {
        const fitH = Math.max(W * 0.1, maxGridH / rows);
        cellH = fitH;
        padTop = margin + headerH + (hasHead ? gap * 1.6 : 0);
        padBottom = noBase ? 0 : gap * 2 + footGap + margin;
      }
    }

    const gridH = rows * cellH + (rows - 1) * gap;
    const H = Math.max(1, Math.round(padTop + gridH + padBottom));

    const cells = [];
    for (let i = 0; i < n; i++) {
      const r = Math.floor(i / cols), c = i % cols;
      const inRow = Math.min(cols, n - r * cols);
      const rowW = inRow * cellW + (inRow - 1) * gap;
      const startX = (W - rowW) / 2;
      cells.push({
        x: startX + c * (cellW + gap),
        y: padTop + r * (cellH + gap),
        w: cellW, h: cellH, i,
      });
    }

    // 末行不满格：可选「铺满整行」（等比放大）
    let finalH = H;
    if (L.lastRow === 'fill' && n > cols && n % cols !== 0) {
      const lastRow = rows - 1;
      const inRow = n - lastRow * cols;
      const fullW = cols * cellW + (cols - 1) * gap;
      const rowW0 = inRow * cellW + (inRow - 1) * gap;
      const k = fullW / rowW0;
      // 放大后如果有图片总高超过上限则放弃
      const bh = cellH * k;
      if (padTop + gridH + (bh - cellH) + padBottom <= W * 2.6) {
        const baseY = padTop + lastRow * (cellH + gap);
        cells.forEach((cell) => {
          if (cell.i >= lastRow * cols) {
            cell.w *= k;
            cell.h = bh;
            cell.y = baseY;
          }
        });
        finalH = Math.max(1, Math.round(padTop + gridH + (bh - cellH) + padBottom));
      }
    }

    return {
      W, H: finalH, cells, mode: noBase ? 'none' : 'solid', radius, gap, cols, rows, cellW, cellH, margin,
      headerH, hasHead,
      headerTop: margin,
      gridTop: padTop,
    };
  }

  function measureLineW(ctx, ln) {
    setFont(ctx, ln.fs, ln.weight || 400);
    return ctx.measureText(ln.text).width;
  }

  /* ---------------- 水印分组绘制 ---------------- */
  function drawWatermarkGroup(ctx, items, rect, baseSize, vars, padMul) {
    if (!items || !items.length) return;

    const groups = {};
    for (const it of items) {
      const txt = subst(it.text, vars);
      if (!txt || !txt.trim()) continue;
      const a = it.anchor || 'bl';
      const dx = U.clamp(+(it.dx || 0), -60, 60);
      const dy = U.clamp(+(it.dy || 0), -60, 60);
      const free = !!it.free;
      const px = U.clamp(it.px == null ? 8 : +it.px, 0, 100);
      const py = U.clamp(it.py == null ? 92 : +it.py, 0, 100);
      const key = `${a}|${dx}|${dy}|${free ? 1 : 0}|${free ? px.toFixed(1) + '_' + py.toFixed(1) : ''}`;
      if (!groups[key]) groups[key] = { anchor: a, dx, dy, free, px, py, list: [] };
      groups[key].list.push(Object.assign({}, it, { txt }));
    }

    const pad = baseSize * (padMul == null ? 1.5 : padMul);

    for (const key in groups) {
      const G = groups[key];
      const list = G.list;
      const v = G.anchor[0];
      const h = G.anchor[1];
      // 左右分列时限制单行宽度，避免两侧文字撞在一起
      const maxW = h === 'c' ? rect.w - pad * 2 : rect.w * 0.58 - pad;

      const lines = [];
      let prevFs = 0;
      for (const it of list) {
        let fs = Math.max(6, baseSize * (it.size || 1));
        setFont(ctx, fs, it.weight || 400);
        const parts = String(it.txt).split('\n');
        for (const p of parts) {
          if (!p) { lines.push({ text: '', fs, lh: fs * 0.7, op: 0, extra: 0 }); prevFs = fs; continue; }
          // 超宽自动缩字号
          let w = ctx.measureText(p).width;
          if (maxW > 0 && w > maxW) {
            fs = Math.max(5, fs * (maxW / w));
            setFont(ctx, fs, it.weight || 400);
            w = ctx.measureText(p).width;
          }
          // 大字号后接小字号时补一点间距，避免视觉上贴在一起
          const extra = prevFs > fs * 1.15 ? prevFs * 0.13 : 0;
          lines.push({ text: p, fs, lh: fs * 1.55, op: it.opacity == null ? 1 : it.opacity, weight: it.weight, extra, color: it.color });
          prevFs = fs;
        }
      }
      if (!lines.length) continue;

      const totalH = lines.reduce((s, l) => s + l.lh + (l.extra || 0), 0);
      const maxLineW = lines.reduce((m, l) => Math.max(m, l.text ? measureLineW(ctx, l) : 0), 0);

      let y, x, align;
      if (G.free) {
        // 自由定位：px/py 是文字块左上角的百分比位置，整块按自身大小贴到位
        const bw = maxLineW;
        const bh = totalH;
        x = rect.x + (rect.w * G.px) / 100;
        y = rect.y + (rect.h * G.py) / 100;
        // 防止跑出画面
        x = U.clamp(x, rect.x + pad * 0.3, rect.x + Math.max(pad * 0.3, rect.w - bw - pad * 0.3));
        y = U.clamp(y, rect.y + pad * 0.3, rect.y + Math.max(pad * 0.3, rect.h - bh - pad * 0.3));
        align = 'left';
      } else {
        if (v === 't') y = rect.y + pad;
        else if (v === 'b') y = rect.y + rect.h - pad - totalH;
        else y = rect.y + (rect.h - totalH) / 2;

        if (h === 'l') { x = rect.x + pad; align = 'left'; }
        else if (h === 'r') { x = rect.x + rect.w - pad; align = 'right'; }
        else { x = rect.x + rect.w / 2; align = 'center'; }

        // 自定义位置微调（相对当前格子的百分比）
        x += (rect.w * G.dx) / 100;
        y += (rect.h * G.dy) / 100;
      }

      for (const ln of lines) {
        y += ln.extra || 0;
        if (!ln.text) { y += ln.lh; continue; }
        setFont(ctx, ln.fs, ln.weight || 400);
        const baseline = y + ln.fs * 1.16;

        ctx.textAlign = align;
        ctx.textBaseline = 'alphabetic';
        const op = U.clamp(ln.op, 0, 1);
        ctx.shadowColor = `rgba(0,0,0,${(0.62 * op).toFixed(3)})`;
        ctx.shadowBlur = Math.max(1, ln.fs * 0.42);
        ctx.shadowOffsetY = Math.max(0.5, ln.fs * 0.04);
        ctx.globalAlpha = op;
        ctx.fillStyle = ln.color || '#ffffff';
        ctx.fillText(ln.text, x, baseline);
        ctx.globalAlpha = 1;
        ctx.shadowColor = 'transparent';
        ctx.shadowBlur = 0;
        ctx.shadowOffsetY = 0;
        y += ln.lh;
      }
    }
  }

  /* ---------------- 背景 / 标题 ---------------- */
  function isLightColor(hex) {
    const m = /^#?([0-9a-f]{6})$/i.exec(String(hex || '').trim());
    if (!m) return false;
    const v = parseInt(m[1], 16);
    const r = (v >> 16) & 255, g = (v >> 8) & 255, b = v & 255;
    return (0.2126 * r + 0.7152 * g + 0.0722 * b) / 255 > 0.6;
  }

  function paintHeader(ctx, lay, st) {
    const W = lay.W;
    const x0 = lay.margin;
    const x1 = W - lay.margin;
    const title = (st.header.title || st.folderName || '').trim();
    const metaLines = (st.header.meta || '').split('\n').map((s) => s.trim()).filter(Boolean);
    if (!title && !metaLines.length) return;

    const light = isLightColor(st.canvas && st.canvas.color);
    const ink = light ? 'rgba(22,22,28,.94)' : '#f4f1ea';
    const ink2 = light ? 'rgba(22,22,28,.86)' : 'rgba(240,240,246,.92)';
    const ink3 = light ? 'rgba(22,22,28,.5)' : 'rgba(255,255,255,.55)';
    const lineColor = light ? 'rgba(0,0,0,.12)' : 'rgba(255,255,255,.09)';
    const accent = light ? 'rgba(158,116,54,.8)' : 'rgba(216,177,117,.6)';

    // 标题
    if (title) {
      const maxTitleW = W * (metaLines.length ? 0.56 : 0.9) - lay.margin * 2;
      let ts = W * 0.047;
      setFont(ctx, ts, 600);
      let tw = measure(ctx, title).w;
      if (tw > maxTitleW) { ts = Math.max(W * 0.022, ts * (maxTitleW / tw)); setFont(ctx, ts, 600); }

      ctx.fillStyle = ink;
      ctx.textAlign = 'left';
      ctx.textBaseline = 'alphabetic';
      const baseline = lay.headerTop + lay.headerH * 0.615;
      drawSpaced(ctx, title, x0, baseline, W * 0.0016, 'left');
    }

    // 右侧信息
    if (metaLines.length) {
      const fs = W * 0.0152;
      const lh = fs * 1.62;
      const total = (metaLines.length - 1) * lh;
      let y = lay.headerTop + (lay.headerH - total) / 2 + fs * 0.3;
      ctx.textAlign = 'right';
      ctx.textBaseline = 'alphabetic';
      metaLines.forEach((line, i) => {
        setFont(ctx, fs, i === 0 ? 500 : 400);
        ctx.fillStyle = i === 0 ? ink2 : ink3;
        ctx.fillText(line, x1, y);
        y += lh;
      });
    }

    // 分隔线 + 金色短标记
    const ly = lay.headerTop + lay.headerH;
    const lw = Math.max(1, W * 0.0006);
    ctx.fillStyle = lineColor;
    ctx.fillRect(x0, ly, x1 - x0, lw);
    ctx.fillStyle = accent;
    ctx.fillRect(x0, ly, W * 0.05, lw);
  }

  /* ---------------- 主绘制 ---------------- */
  function paint(ctx, lay, st, opts) {
    const { W, H } = lay;
    ctx.save();
    ctx.imageSmoothingEnabled = true;
    ctx.imageSmoothingQuality = 'high';

    // 背景：先铺底色，再叠自定义底图
    ctx.fillStyle = (st.canvas && st.canvas.color) || '#0f0f14';
    ctx.fillRect(0, 0, W, H);
    if (lay.mode === 'image') {
      const t = st.template;
      if (t && t.img) {
        drawSmooth(ctx, t.img, 0, 0, t.img.naturalWidth || t.img.width, t.img.naturalHeight || t.img.height, 0, 0, W, H);
      }
    }

    // 每张图
    const n = st.files.length;
    const hasWm = st.wmPer.some((w) => w.text && w.text.trim());
    for (const cell of lay.cells) {
      const f = st.files[cell.i];
      ctx.save();
      U.roundRect(ctx, cell.x, cell.y, cell.w, cell.h, lay.radius);
      ctx.clip();

      // 占位底色
      ctx.fillStyle = '#15151a';
      ctx.fillRect(cell.x, cell.y, cell.w, cell.h);

      if (f && f.img) {
        drawCover(ctx, f.img, f.w, f.h, cell.x, cell.y, cell.w, cell.h);

        // 底部衬底渐变，让浅色画面上文字也清晰
        if (hasWm) {
          const g = ctx.createLinearGradient(0, cell.y + cell.h * 0.52, 0, cell.y + cell.h);
          g.addColorStop(0, 'rgba(0,0,0,0)');
          g.addColorStop(0.5, 'rgba(0,0,0,0.24)');
          g.addColorStop(1, 'rgba(0,0,0,0.68)');
          ctx.fillStyle = g;
          ctx.fillRect(cell.x, cell.y, cell.w, cell.h);
        }
      } else if (f) {
        ctx.fillStyle = 'rgba(255,255,255,.28)';
        setFont(ctx, cell.w * 0.05, 400);
        ctx.textAlign = 'center';
        ctx.textBaseline = 'middle';
        ctx.fillText('载入中…', cell.x + cell.w / 2, cell.y + cell.h / 2);
      }

      // 每张图水印
      const vars = {
        folder: st.folderName || '',
        date: st.dateText || '',
        price: st.priceText || '',
        index: `${U.pad2(cell.i + 1)}/${U.pad2(n)}`,
        count: n,
      };
      drawWatermarkGroup(ctx, st.wmPer, cell, cell.w * 0.042, vars, 1.5);
      ctx.restore();

      // 细边框
      ctx.save();
      U.roundRect(ctx, cell.x + 0.5, cell.y + 0.5, cell.w - 1, cell.h - 1, lay.radius);
      ctx.strokeStyle = 'rgba(255,255,255,.07)';
      ctx.lineWidth = Math.max(1, W * 0.0006);
      ctx.stroke();
      ctx.restore();
    }

    // 纯色底图的标题栏
    if (lay.mode === 'solid' && lay.hasHead) {
      paintHeader(ctx, lay, st);
    }

    // 整图水印
    if (st.wmGlobal && st.wmGlobal.length) {
      const vars = {
        folder: st.folderName || '',
        date: st.dateText || '',
        price: st.priceText || '',
        index: '',
        count: st.files.length,
      };
      drawWatermarkGroup(ctx, st.wmGlobal, { x: 0, y: 0, w: W, h: H }, W * 0.0125, vars, 2.2);
    }

    // 参考线（不导出）
    if (opts && opts.guides && lay.mode === 'image') {
      ctx.save();
      ctx.strokeStyle = 'rgba(216,177,117,.55)';
      ctx.setLineDash([W * 0.012, W * 0.008]);
      ctx.lineWidth = Math.max(1, W * 0.0012);
      ctx.strokeRect(lay.area.x, lay.area.y, lay.area.w, lay.area.h);
      ctx.restore();
    }

    ctx.restore();
  }

  /* ---------------- 对外 ---------------- */
  MN.Render = {
    layout: computeLayout,
    paint,
    renderTo(ctx, W, st, opts) {
      const lay = computeLayout(W, st);
      if (ctx.canvas.width !== lay.W || ctx.canvas.height !== lay.H) {
        ctx.canvas.width = lay.W;
        ctx.canvas.height = lay.H;
      }
      ctx.clearRect(0, 0, lay.W, lay.H);
      paint(ctx, lay, st, opts || {});
      return lay;
    },
  };
})();
