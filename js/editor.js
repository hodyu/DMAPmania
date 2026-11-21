const Editor = (() => {
  const cv = $('#edCanvas');
  const ctx = cv.getContext('2d');
  const LANE_X = 10, STAGE_W = 400, HEAD_Y = 440, ZOOM = 0.3; // px / ms
  let song, charts, chart, cur = 0, tool = 'note', drag = null, press = null, playing = false, clock = null, loopId = 0;

  function open(s, idx = 0) {
    if (song?.id !== s.id) cur = 0;
    song = s;
    charts = loadCharts(s);
    $('#edTitle').textContent = s.title;
    show('editor');
    selectDiff(Math.min(idx, charts.length - 1));
    loadVideo(s).then(() => { seekSong(song, cur); draw(); }).catch((e) => toast(e.message));
  }

  const laneW = () => STAGE_W / chart.keys;
  const snapMs = () => 60000 / chart.bpm / Number($('#edSnap').value);
  const snap = (t) => Math.round(Math.round((t - chart.offset) / snapMs()) * snapMs() + chart.offset);
  const yOf = (t) => HEAD_Y - (t - cur) * ZOOM;
  const tOf = (y) => cur + (HEAD_Y - y) / ZOOM;
  const duration = () => segLength(song);

  // 캔버스 좌표 → { 레인, 시간 }
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

  // 노트 도구: 탭하면 놓기, 위아래로 끌면 스크롤 / 롱노트 도구: 끌어서 길이 정하기
  cv.onpointerdown = (e) => {
    const p = pointer(e);
    if (p.l < 0 || p.l >= chart.keys) return;
    cv.setPointerCapture(e.pointerId);
    if (e.button === 2 || tool === 'erase') {
      const n = noteAt(p);
      chart.notes = chart.notes.filter((x) => x !== n);
    } else if (tool === 'long') {
      const t = snap(p.t);
      if (!noteAt({ l: p.l, t })) drag = { l: p.l, t, d: 0 };
    } else {
      press = { l: p.l, t: snap(p.t), y: e.clientY, cur, moved: false };
    }
    draw();
  };
  cv.onpointermove = (e) => {
    if (drag) { drag.d = Math.max(0, snap(pointer(e).t) - drag.t); return draw(); }
    if (!press) return;
    const dy = e.clientY - press.y;
    if (Math.abs(dy) > 10) press.moved = true;
    if (press.moved) seek(press.cur + (dy * cv.height) / cv.getBoundingClientRect().height / ZOOM);
  };
  cv.onpointerup = cv.onpointercancel = (e) => {
    if (e.type === 'pointerup') {
      if (drag) chart.notes.push(drag);
      else if (press && !press.moved && !noteAt(press)) chart.notes.push({ t: press.t, l: press.l, d: 0 });
    }
    drag = press = null;
    draw();
  };
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

  function toggle() {
    playing = !playing;
    $('#edPlay').textContent = playing ? '❚❚' : '▶';
    clock = null;
    if (playing) { seekSong(song, cur); video.play(); tick(++loopId); }
    else video.pause();
  }
  // currentTime 이 띄엄띄엄 갱신돼서 performance.now() 로 보간
  function tick(id) {
    if (!playing || id !== loopId) return;
    const media = songTime(song), p = performance.now();
    if (!clock || Math.abs(clock.media + (p - clock.p) - media) > 80) clock = { media, p };
    cur = Math.min(clock.media + (p - clock.p), duration());
    if (video.ended || cur >= duration()) toggle();
    draw();
    requestAnimationFrame(() => tick(id));
  }

  function draw() {
    if (!chart) return;
    ctx.fillStyle = '#000000';
    ctx.fillRect(0, 0, cv.width, cv.height);
    // 박자선: 마디 > 박 > 스냅 순으로 진하게
    const beat = 60000 / chart.bpm, sub = snapMs();
    for (let t = snap(tOf(cv.height)) - sub; t <= tOf(0); t += sub) {
      const k = Math.round(((t - chart.offset) / beat) * 1000) / 1000;
      ctx.fillStyle = k % 4 === 0 ? 'rgba(255,255,255,0.5)' : Number.isInteger(k) ? 'rgba(255,255,255,0.2)' : 'rgba(255,255,255,0.07)';
      ctx.fillRect(LANE_X, yOf(t), STAGE_W, 1);
    }
    ctx.fillStyle = '#222222';
    for (let i = 0; i <= chart.keys; i++) ctx.fillRect(LANE_X + i * laneW(), 0, 1, cv.height);
    const w = laneW();
    for (const n of drag ? [...chart.notes, drag] : chart.notes) {
      const head = yOf(n.t), tail = yOf(n.t + n.d), x = LANE_X + n.l * w + 3;
      if (head < -20 || tail > cv.height + 20) continue;
      ctx.fillStyle = laneColor(n.l, chart.keys);
      if (n.d > 0) { ctx.globalAlpha = 0.5; ctx.fillRect(x + 8, tail, w - 22, head - tail); ctx.globalAlpha = 1; }
      ctx.fillRect(x, head - 8, w - 6, 16);
    }
    ctx.fillStyle = '#ffffff';
    ctx.fillRect(0, HEAD_Y, cv.width, 3);
    $('#edTime').textContent = `${fmt(cur)} / ${fmt(duration())}`;
    $('#edCount').textContent = `노트 ${chart.notes.length}개`;
    drawBar();
  }

  // 아래 타임바: 진행 위치, 노트 위치 눈금, 드래그로 이동
  const bar = $('#edBar'), barCv = $('#edBarCv'), bctx = barCv.getContext('2d');
  let scrub = null;
  const barT = (clientX) => {
    const r = bar.getBoundingClientRect();
    return Math.min(1, Math.max(0, (clientX - r.left) / r.width)) * duration();
  };
  function drawBar() {
    const dpr = devicePixelRatio || 1, w = bar.clientWidth, h = bar.clientHeight;
    if (barCv.width !== Math.round(w * dpr)) { barCv.width = Math.round(w * dpr); barCv.height = Math.round(h * dpr); }
    const px = (t) => (t / (duration() || 1)) * w, y = h / 2 - 3, x = px(cur);
    bctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    bctx.clearRect(0, 0, w, h);
    bctx.fillStyle = '#1f1f1f';
    bctx.fillRect(0, y, w, 6);
    bctx.fillStyle = '#555555';
    bctx.fillRect(0, y, x, 6);
    bctx.fillStyle = 'rgba(255,255,255,0.35)';
    for (const n of chart.notes) bctx.fillRect(Math.round(px(n.t)), y - 5, 1, 4);
    bctx.fillStyle = '#ffffff';
    bctx.fillRect(x - 1, 2, 2, h - 4);
    bctx.beginPath();
    bctx.arc(x, h / 2, 6, 0, Math.PI * 2);
    bctx.fill();
  }
  bar.onpointerdown = (e) => {
    bar.setPointerCapture(e.pointerId);
    scrub = { resume: playing }; // 재생 중이었으면 놓을 때 다시 재생
    if (playing) toggle();
    bar.classList.add('drag');
    bar.onpointermove(e);
  };
  bar.onpointermove = (e) => {
    const hover = $('#edHover');
    hover.style.left = e.clientX - bar.getBoundingClientRect().left + 'px';
    hover.textContent = fmt(barT(e.clientX));
    if (scrub) seek(barT(e.clientX));
  };
  bar.onpointerup = bar.onpointercancel = () => {
    if (!scrub) return;
    bar.classList.remove('drag');
    if (scrub.resume) toggle();
    scrub = null;
  };
  window.addEventListener('resize', () => chart && drawBar());

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
  $('#edLevel').onchange = (e) => { chart.level = Math.max(1, Math.round(e.target.value) || 1); refreshDiffs(); };
  $('#edDiffAdd').onclick = () => {
    const c = newChart(song, chart);
    c.name = DIFF_NAMES[charts.length] || 'Extra ' + charts.length;
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
  $('#edTest').onclick = () => {
    if (playing) toggle();
    saveCharts(song, charts);
    const idx = charts.indexOf(chart);
    Game.start(song, { chart, from: Math.max(0, cur - 1000), onExit: () => open(song, idx) });
  };

  function onKey(e) {
    if (e.code === 'Space' && e.target.tagName !== 'INPUT') { e.preventDefault(); toggle(); }
  }
  const close = () => playing && toggle();

  return { open, onKey, close };
})();
