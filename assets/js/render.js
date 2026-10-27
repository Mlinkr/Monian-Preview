/* ===========================================================
   Monian · render.js
   画布排版与绘制（预览与导出共用同一套比例逻辑）

   核心约束：素材全部是 16:9，任何模式下都【不裁剪】。
   格子比例恒为 16:9，图片用 contain 完整贴合。
   =========================================================== */
(function () {
  'use strict';

  const MN = window.MN;
  const U = MN.util;

  // 与示例图一致的衬线宋体；无衬线只作系统兜底
  const FONT = '"Monian Serif","Noto Serif SC","Source Han Serif SC","Songti SC","SimSun",serif';
  const CELL_ASPECT = 16 / 9;

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

  // 完整显示、绝不裁剪：等比缩放到能装进目标框，居中，多余部分留透明
  function drawContain(ctx, src, sw0, sh0, dx, dy, dw, dh) {
    const k = Math.min(dw / sw0, dh / sh0);
    const w = sw0 * k;
    const h = sh0 * k;
    drawSmooth(ctx, src, 0, 0, sw0, sh0, dx + (dw - w) / 2, dy + (dh - h) / 2, w, h);
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
  // 画布里要处理的对象：文字水印 + 图片水印
  // kind: 'text' | 'image'
  function isImageItem(it) { return it && it.kind === 'image'; }

  function computeLayout(W, st) {
    const n = st.files.length;
    const L = st.layout;
    const radius = (W * L.radius) / 100;
    const mode = (st.canvas && st.canvas.mode) || 'solid';
    const gap = mode === 'none' ? (W * L.gap) / 100 : (W * L.gap) / 100;

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

      // 格子恒为 16:9：先按可用宽度算，若超出可用高度再按高度回缩
      let cw = Math.max(1, (area.w - gap * (cols - 1)) / cols);
      let ch = cw / CELL_ASPECT;
      const maxH = Math.max(1, (area.h - gap * (rows - 1)) / rows);
      if (ch > maxH) {
        ch = maxH;
        cw = ch * CELL_ASPECT;
      }
      const gridH = rows * ch + (rows - 1) * gap;
      const gridTop = area.y + Math.max(0, (area.h - gridH) / 2);

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
      return { W, H, cells, area, mode: 'image', radius, gap, cols, rows, cellW: cw, cellH: ch, gridTop };
    }

    // 纯色底图 / 无底图
    const noBase = mode === 'none';
    const margin = noBase ? 0 : (W * L.margin) / 100;
    const cols = Math.max(1, Math.min(L.cols, n || 1));
    const rows = Math.max(1, Math.ceil(n / cols));
    const cellW = Math.max(1, (W - margin * 2 - gap * (cols - 1)) / cols);
    // 恒 16:9，绝不拉伸
    let cellH = cellW / CELL_ASPECT;

    const title = ((st.header && st.header.title) || '').trim();
    const meta = ((st.header && st.header.meta) || '').trim();
    const hasHead = !noBase && (!st.canvas || st.canvas.header !== false) &&
      !!(title || meta || st.folderName);

    const headerH = hasHead ? W * 0.152 : 0;
    const footGap = noBase ? 0 : W * 0.068;
    const padTop = margin + headerH + (hasHead ? gap * 1.6 : 0);
    const padBottom = noBase ? 0 : gap * 2 + footGap + margin;

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

    // 末行不满格：可选「铺满整行」（仍然保持 16:9，只放大尺寸不改变比例）
    let finalH = H;
    if (L.lastRow === 'fill' && n > cols && n % cols !== 0) {
      const lastRow = rows - 1;
      const inRow = n - lastRow * cols;
      const fullW = cols * cellW + (cols - 1) * gap;
      const rowW0 = inRow * cellW + (inRow - 1) * gap;
      const k = fullW / rowW0;
      const bh = cellH * k;
      if (padTop + gridH + (bh - cellH) + padBottom <= W * 2.6) {
        const baseY = padTop + lastRow * (cellH + gap);
        cells.forEach((cell) => {
          if (cell.i >= lastRow * cols) {
            cell.w *= k;
            cell.h = bh;               // 等比放大，比例仍是 16:9
            cell.y = baseY;
          }
        });
        finalH = Math.max(1, Math.round(padTop + gridH + (bh - cellH) + padBottom));
      }
    }

    return {
      W, H: finalH, cells, mode: noBase ? 'none' : 'solid', radius, gap, cols, rows, cellW, cellH, margin,
      headerH, hasHead, headerTop: margin, gridTop: padTop,
    };
  }

  function measureLineW(ctx, ln) {
    setFont(ctx, ln.fs, ln.weight || 400);
    return ctx.measureText(ln.text).width;
  }

  /* ---------------- 图片水印（PNG 花纹） ---------------- */
  // it: { kind:'image', img, naturalW, naturalH, mode:'tile'|'single',
  //       opacity, scale, tile (每屏横向重复次数), anchor, dx, dy, free, px, py, rotate }
  function drawImageWatermark(ctx, it, rect) {
    if (!isImageItem(it) || !it.img) return;
    const op = U.clamp(it.opacity == null ? 0.18 : +it.opacity, 0, 1);
    const iw = it.naturalW || it.img.width;
    const ih = it.naturalH || it.img.height;
    if (!iw || !ih) return;

    ctx.save();
    ctx.globalAlpha = op;

    const tile = it.mode !== 'single';

    if (tile) {
      // 平铺：取「画布宽 / reps」为基准块宽，再按 scale 放大块数并对齐到画布边缘，
      // 保证每一块的左右边界都落在画布整像素上，不产生重叠或缝隙
      const reps = Math.max(1, Math.round(it.tile == null ? 1 : +it.tile));
      const scale = U.clamp(it.scale == null ? 1 : +it.scale, 0.1, 4);
      let w = (rect.w / reps) * scale;
      const h = (w * ih) / iw;

      // 横向块数向上取整，blockW 用「实际块数」重新均分，消除累积误差
      const nx = Math.max(1, Math.round(rect.w / w));
      const bw = rect.w / nx;
      const bh = (bw * ih) / iw;

      const a = it.anchor || 'tl';
      const offX = (rect.w * U.clamp(+(it.dx || 0), -60, 60)) / 100;
      const offY = (rect.h * U.clamp(+(it.dy || 0), -60, 60)) / 100;
      const yBase = a[0] === 'b' ? rect.y + rect.h - bh : a[0] === 'm' ? rect.y + (rect.h - bh) / 2 : rect.y;

      ctx.save();
      ctx.beginPath();
      ctx.rect(rect.x, rect.y, rect.w, rect.h);
      ctx.clip();

      // 横向从 -1 块开始画，覆盖负偏移；纵向同理
      const startC = Math.floor(offX / bw) - 1;
      for (let c = startC; c * bw < rect.w + bw; c++) {
        const x = rect.x + c * bw + (offX % bw);
        for (let k = Math.floor(offY / bh) - 1; k * bh < rect.h + bh; k++) {
          const y = yBase + k * bh + (offY % bh);
          ctx.drawImage(it.img, Math.round(x), Math.round(y), Math.ceil(bw) + 1, Math.ceil(bh) + 1);
        }
      }
      ctx.restore();
    } else {
      // 单张：按宽度百分比缩放，九宫格或自由定位
      const w = rect.w * U.clamp(it.scale == null ? 0.5 : +it.scale, 0.02, 3);
      const h = (w * ih) / iw;
      let x, y;
      if (it.free) {
        x = rect.x + (rect.w * U.clamp(it.px == null ? 50 : +it.px, 0, 100)) / 100 - w / 2;
        y = rect.y + (rect.h * U.clamp(it.py == null ? 50 : +it.py, 0, 100)) / 100 - h / 2;
      } else {
        const a = it.anchor || 'mc';
        const pad = rect.w * 0.02;
        x = a[1] === 'l' ? rect.x + pad : a[1] === 'r' ? rect.x + rect.w - w - pad : rect.x + (rect.w - w) / 2;
        y = a[0] === 't' ? rect.y + pad : a[0] === 'b' ? rect.y + rect.h - h - pad : rect.y + (rect.h - h) / 2;
        x += (rect.w * U.clamp(+(it.dx || 0), -60, 60)) / 100;
        y += (rect.h * U.clamp(+(it.dy || 0), -60, 60)) / 100;
      }
      if (it.rotate) {
        ctx.translate(x + w / 2, y + h / 2);
        ctx.rotate((+it.rotate * Math.PI) / 180);
        ctx.drawImage(it.img, -w / 2, -h / 2, w, h);
      } else {
        ctx.drawImage(it.img, x, y, w, h);
      }
    }

    ctx.restore();
  }

  /* ---------------- 水印分组绘制 ---------------- */
  function drawWatermarkGroup(ctx, items, rect, baseSize, vars, padMul) {
    if (!items || !items.length) return;

    // 先画图片水印（在文字下层）
    for (const it of items) {
      if (isImageItem(it)) drawImageWatermark(ctx, it, rect);
    }

    const groups = {};
    for (const it of items) {
      if (isImageItem(it)) continue;
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
    const hasTextWm = (st.wmPer || []).some((w) => !isImageItem(w) && w.text && w.text.trim());
    for (const cell of lay.cells) {
      const f = st.files[cell.i];
      ctx.save();
      U.roundRect(ctx, cell.x, cell.y, cell.w, cell.h, lay.radius);
      ctx.clip();

      // 占位底色
      ctx.fillStyle = '#15151a';
      ctx.fillRect(cell.x, cell.y, cell.w, cell.h);

      if (f && f.img) {
        // 关键：contain 而非 cover，完整显示不裁剪
        drawContain(ctx, f.img, f.w, f.h, cell.x, cell.y, cell.w, cell.h);

        // 底部衬底渐变，让浅色画面上文字也清晰
        if (hasTextWm) {
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

      // 每张图水印（含图片水印）
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
    CELL_ASPECT,
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
