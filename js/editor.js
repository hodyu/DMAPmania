const Editor = (() => {
  const cv = $('#edCanvas');
  const ctx = cv.getContext('2d');
  const LANE_X = 10, STAGE_W = 400, HEAD_Y = 440, ZOOM = 0.3; // px / ms
  const laneW = () => STAGE_W / chart.keys;
  let song, charts, chart, cur = 0, tool = 'note', drag = null, playing = false;

  function open(s, idx = 0) {
    if (!song || song.id !== s.id) cur = 0;
    song = s;
    charts = loadCharts(s);
    $('#edTitle').textContent = s.title;
    selectDiff(Math.min(idx, charts.length - 1));
    show('editor');
    loadVideo(s).then(() => { seekSong(song, cur); draw(); }).catch((e) => toast(e.message));
    draw();
  }

  const snapMs = () => 60000 / chart.bpm / Number($('#edSnap').value);
  const snap = (t) => Math.round((t - chart.offset) / snapMs()) * snapMs() + chart.offset;
  const yOf = (t) => HEAD_Y - (t - cur) * ZOOM;
  const tOf = (y) => cur + (HEAD_Y - y) / ZOOM;
  const duration = () => segLength(song);

  function pointer(e) {
    const r = cv.getBoundingClientRect();
    const x = ((e.clientX - r.left) / r.width) * cv.width;
    const y = ((e.clientY - r.top) / r.height) * cv.height;
    return { l: Math.floor((x - LANE_X) / laneW()), t: tOf(y) };
  }
  function noteAt(p) {
    const h = snapMs() / 2;
    return chart.notes.find((n) => n.l === p.l && p.t >= n.t - h && p.t <= n.t + n.d + h);
  }
  function remove(n) { chart.notes = chart.notes.filter((x) => x !== n); }

  let press = null;
  cv.onpointerdown = (e) => {
    const p = pointer(e);
    if (p.l < 0 || p.l >= chart.keys) return;
    try { cv.setPointerCapture(e.pointerId); } catch {}
    if (e.button === 2 || tool === 'erase') { const n = noteAt(p); if (n) remove(n); return draw(); }
    const t = Math.round(snap(p.t));
    if (tool === 'long') { if (!noteAt({ l: p.l, t })) drag = { l: p.l, t, end: t }; return draw(); }
    press = { l: p.l, t, y: e.clientY, cur, moved: false };
  };
  cv.onpointermove = (e) => {
    if (drag) { drag.end = Math.round(snap(pointer(e).t)); return draw(); }
    if (!press) return;
    const dy = e.clientY - press.y;
    if (Math.abs(dy) > 10) press.moved = true;
    if (press.moved) seek(press.cur + (dy * cv.height) / cv.getBoundingClientRect().height / ZOOM);
  };
  cv.onpointerup = () => {
    if (drag) chart.notes.push({ t: drag.t, l: drag.l, d: Math.max(0, drag.end - drag.t) });
    else if (press && !press.moved && !noteAt(press)) chart.notes.push({ t: press.t, l: press.l, d: 0 });
    drag = null; press = null;
    draw();
  };
  cv.onpointercancel = () => { drag = null; press = null; draw(); };
  cv.oncontextmenu = (e) => e.preventDefault();
  cv.onwheel = (e) => {
    e.preventDefault();
    seek(cur - Math.sign(e.deltaY) * snapMs());
  };

  function seek(t) {
    cur = Math.min(Math.max(0, t), duration());
    seekSong(song, cur);
    clock = null;
    draw();
  }

  let clock = null, loopId = 0;
  function toggle() {
    playing = !playing;
    $('#edPlay').textContent = playing ? '❚❚' : '▶';
    clock = null;
    if (playing) { seekSong(song, cur); video.play(); tick(++loopId); }
    else video.pause();
  }
  // currentTime 이 띄엄띄엄 갱신돼서 보간
  function tick(id) {
    if (!playing || id !== loopId) return;
    const media = songTime(song), p = performance.now();
    if (!clock || video.paused || Math.abs(clock.media + (p - clock.p) * video.playbackRate - media) > 80) clock = { media, p };
    cur = Math.min(clock.media + (p - clock.p) * video.playbackRate, duration());
    if (video.ended || cur >= duration()) toggle();
    draw();
    requestAnimationFrame(() => tick(id));
  }

  // timeline
  const bar = $('#edBar'), barCv = $('#edBarCv'), bctx = barCv.getContext('2d');
  let hoverX = -1, scrub = null;
  const barT = (clientX) => {
    const r = bar.getBoundingClientRect();
    return Math.min(1, Math.max(0, (clientX - r.left) / r.width)) * duration();
  };
  function drawBar() {
    const dpr = devicePixelRatio || 1, w = bar.clientWidth, h = bar.clientHeight;
    if (!w) return;
    if (barCv.width !== Math.round(w * dpr) || barCv.height !== Math.round(h * dpr)) {
      barCv.width = Math.round(w * dpr); barCv.height = Math.round(h * dpr);
    }
    bctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    bctx.clearRect(0, 0, w, h);
    const d = duration() || 1, px = (t) => (t / d) * w;
    const ty = h / 2 - 3;
    bctx.fillStyle = '#1f1f1f';
    bctx.fillRect(0, ty, w, 6);
    bctx.fillStyle = '#555';
    bctx.fillRect(0, ty, px(cur), 6);
    // 노트 위치
    bctx.fillStyle = 'rgba(255,255,255,0.35)';
    let lastX = -1;
    for (const n of chart.notes) {
      const x = Math.round(px(n.t));
      if (x === lastX) continue;
      lastX = x;
      bctx.fillRect(x, ty - 5, 1, 4);
    }
    if (hoverX >= 0) {
      bctx.fillStyle = 'rgba(255,255,255,0.4)';
      bctx.fillRect(Math.round(hoverX), 4, 1, h - 8);
    }
    const x = px(cur);
    bctx.fillStyle = '#fff';
    bctx.fillRect(Math.round(x) - 1, 2, 2, h - 4);
    bctx.beginPath(); bctx.arc(x, h / 2, 6, 0, Math.PI * 2); bctx.fill();
  }
  function hover(e) {
    const r = bar.getBoundingClientRect();
    hoverX = Math.min(r.width, Math.max(0, e.clientX - r.left));
    const hv = $('#edHover');
    hv.style.left = hoverX + 'px';
    hv.textContent = fmt(barT(e.clientX));
  }
  bar.onpointerdown = (e) => {
    try { bar.setPointerCapture(e.pointerId); } catch {}
    scrub = { resume: playing };
    if (playing) toggle();
    bar.classList.add('drag');
    hover(e);
    seek(barT(e.clientX));
  };
  bar.onpointermove = (e) => {
    hover(e);
    if (scrub) seek(barT(e.clientX));
    else drawBar();
  };
  const endScrub = () => {
    if (!scrub) return;
    bar.classList.remove('drag');
    if (scrub.resume) toggle();
    scrub = null;
  };
  bar.onpointerup = endScrub;
  bar.onpointercancel = endScrub;
  bar.onpointerleave = () => { if (!scrub) { hoverX = -1; drawBar(); } };
  window.addEventListener('resize', () => chart && drawBar());

  function draw() {
    if (!chart) return;
    ctx.fillStyle = '#000000';
    ctx.fillRect(0, 0, cv.width, cv.height);
    const beat = 60000 / chart.bpm, sub = snapMs();
    const tTop = tOf(0), tBottom = tOf(cv.height);
    for (let t = snap(tBottom) - sub; t <= tTop; t += sub) {
      const k = Math.round((t - chart.offset) / beat * 1000) / 1000;
      ctx.fillStyle = k % 4 === 0 ? 'rgba(255,255,255,0.5)' : Number.isInteger(k) ? 'rgba(255,255,255,0.2)' : 'rgba(255,255,255,0.07)';
      ctx.fillRect(LANE_X, yOf(t), STAGE_W, 1);
    }
    for (let i = 0; i <= chart.keys; i++) { ctx.fillStyle = '#222222'; ctx.fillRect(LANE_X + i * laneW(), 0, 1, cv.height); }
    const list = drag ? [...chart.notes, { t: drag.t, l: drag.l, d: Math.max(0, drag.end - drag.t) }] : chart.notes;
    list.forEach((n) => {
      const W = laneW(), head = yOf(n.t), tail = yOf(n.t + n.d), x = LANE_X + n.l * W + 3;
      if (head < -20 || tail > cv.height + 20) return;
      ctx.fillStyle = laneColor(n.l, chart.keys);
      if (n.d > 0) { ctx.globalAlpha = 0.5; ctx.fillRect(x + 8, tail, W - 22, head - tail); ctx.globalAlpha = 1; }
      ctx.fillRect(x, head - 8, W - 6, 16);
    });
    ctx.fillStyle = '#ffffff';
    ctx.fillRect(0, HEAD_Y, cv.width, 3);
    $('#edTime').textContent = `${fmt(cur)} / ${fmt(duration())}`;
    drawBar();
    $('#edCount').textContent = `노트 ${chart.notes.length}개`;
  }

  document.querySelectorAll('[data-tool]').forEach((b) => (b.onclick = () => {
    tool = b.dataset.tool;
    document.querySelectorAll('[data-tool]').forEach((x) => x.classList.toggle('on', x === b));
  }));
  $('#edBpm').onchange = (e) => { chart.bpm = Number(e.target.value) || 120; draw(); };
  $('#edOffset').onchange = (e) => { chart.offset = Number(e.target.value) || 0; draw(); };
  $('#edSnap').onchange = draw;
  $('#edKeys').onchange = (e) => {
    chart.keys = Number(e.target.value);
    const before = chart.notes.length;
    chart.notes = chart.notes.filter((n) => n.l < chart.keys);
    if (chart.notes.length < before) toast(`범위를 벗어난 노트 ${before - chart.notes.length}개를 지웠습니다`);
    draw();
  };
  $('#edPlay').onclick = toggle;
  $('#edSave').onclick = () => { saveCharts(song, charts); toast('저장했습니다'); };

  // 난이도
  function selectDiff(i) {
    chart = charts[i];
    $('#edDiff').innerHTML = charts.map((c, j) => `<option value="${j}">${esc(diffLabel(c))}</option>`).join('');
    $('#edDiff').value = i;
    $('#edDiffName').value = chart.name;
    $('#edLevel').value = chart.level;
    $('#edBpm').value = chart.bpm;
    $('#edOffset').value = chart.offset;
    $('#edKeys').value = chart.keys;
    draw();
  }
  const refreshDiffs = () => selectDiff(charts.indexOf(chart));
  $('#edDiff').onchange = (e) => selectDiff(Number(e.target.value));
  $('#edDiffName').onchange = (e) => { chart.name = e.target.value.trim() || 'Normal'; refreshDiffs(); };
  $('#edLevel').onchange = (e) => { chart.level = Math.max(1, Math.round(Number(e.target.value)) || 1); refreshDiffs(); };
  $('#edDiffAdd').onclick = () => {
    const used = charts.map((c) => c.name);
    const c = newChart(song, chart);
    const top = Math.max(-1, ...used.map((n) => DIFF_NAMES.indexOf(n)));
    c.name = [...DIFF_NAMES.slice(top + 1), ...DIFF_NAMES].find((n) => !used.includes(n)) || 'Diff ' + (charts.length + 1);
    c.level = Math.max(...charts.map((x) => x.level)) + 1;
    charts.push(c);
    selectDiff(charts.length - 1);
  };
  $('#edDiffDel').onclick = () => {
    if (charts.length < 2) return toast('난이도가 하나뿐이라 지울 수 없습니다');
    if (!confirm(`${diffLabel(chart)} 을(를) 지울까요?`)) return;
    charts.splice(charts.indexOf(chart), 1);
    saveCharts(song, charts);
    selectDiff(0);
  };

  $('#edTest').onclick = () => {
    if (playing) toggle();
    saveCharts(song, charts);
    const idx = charts.indexOf(chart);
    Game.start(song, { chart, from: Math.max(0, cur - 1000), onExit: () => open(song, idx) });
  };

  function onKey(e) {
    if (e.target.tagName === 'INPUT') return;
    if (e.code === 'Space') { e.preventDefault(); toggle(); }
  }
  function close() { if (playing) toggle(); }

  return { open, onKey, close };
})();
