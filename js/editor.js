const Editor = (() => {
  const cv = $('#edCanvas');
  const ctx = cv.getContext('2d');
  const LANE_X = 10, STAGE_W = 400, HEAD_Y = 440, ZOOM = 0.3; // px / ms
  let song, charts, chart, stars = 0, cur = 0, tool = 'note', drag = null, press = null, playing = false, clock = null, loopId = 0;

  function open(s, chartId) {
    if (song?.id !== s.id) cur = 0;
    song = s;
    delete song.shift; // 저장 안 한 보정값은 버림
    charts = loadCharts(s);
    $('#edShift').value = segStart(song) - (song.start || 0) * 1000;
    $('#edTitle').textContent = s.title;
    show('editor');
    selectDiff(Math.max(0, charts.findIndex((c) => c.id === chartId)));
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
      rate();
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
    rate();
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
    $('#edCount').textContent = `노트 ${chart.notes.length}개 · ★${stars.toFixed(2)}`;
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

  // 별점은 노트가 바뀔 때만 다시 계산
  function rate() {
    stars = starRating(chart.notes, chart.keys);
    draw();
  }

  // 난이도
  function selectDiff(i) {
    chart = charts[i];
    $('#edDiff').innerHTML = charts.map((c, j) => `<option value="${j}">${esc(c.name)}</option>`).join('');
    $('#edDiff').value = i;
    $('#edDiffName').value = chart.name;
    $('#edBpm').value = chart.bpm;
    $('#edOffset').value = chart.offset;
    $('#edKeys').value = chart.keys;
    rate();
  }
  const refreshDiffs = () => selectDiff(charts.indexOf(chart));
  $('#edDiff').onchange = (e) => selectDiff(Number(e.target.value));
  // 난이도 이름 = 파일 이름이라 쓸 수 없는 글자는 _ 로, 겹치면 뒤에 숫자
  function uniqueName(name, self) {
    const base = name.replace(/[\\/:*?"<>|]/g, '_').trim() || 'Normal';
    let result = base;
    for (let n = 2; charts.some((c) => c !== self && c.name === result); n++) result = `${base} ${n}`;
    return result;
  }
  $('#edDiffName').onchange = (e) => { chart.name = uniqueName(e.target.value, chart); refreshDiffs(); };
  $('#edDiffAdd').onclick = () => {
    const c = newChart(song, chart);
    c.id = Date.now().toString(36);
    c.name = uniqueName(DIFF_NAMES[charts.length] || 'Extra', c);
    charts.push(c);
    selectDiff(charts.length - 1);
  };
  $('#edDiffDel').onclick = () => {
    if (charts.length < 2) return toast('난이도가 하나뿐이라 지울 수 없습니다');
    if (!confirm(`${chart.name} 을(를) 지울까요?`)) return;
    charts.splice(charts.indexOf(chart), 1);
    save();
    selectDiff(0);
  };

  document.querySelectorAll('[data-tool]').forEach((b) => (b.onclick = () => {
    tool = b.dataset.tool;
    document.querySelectorAll('[data-tool]').forEach((x) => x.classList.toggle('on', x === b));
  }));
  $('#edBpm').onchange = (e) => { chart.bpm = Number(e.target.value) || 120; draw(); };
  $('#edOffset').onchange = (e) => { chart.offset = Number(e.target.value) || 0; draw(); };

  // 곡 시작 보정: 0초 위치를 옮겨도 노트와 박자선은 음악에 붙어 있도록 같이 당김
  function setShift(shift) {
    const delta = Math.round(shift) - (segStart(song) - (song.start || 0) * 1000);
    if (!delta) return;
    song.shift = Math.round(shift);
    for (const c of charts) {
      c.notes.forEach((n) => (n.t -= delta));
      c.offset -= delta;
    }
    const early = chart.notes.filter((n) => n.t < 0).length;
    if (early) toast(`곡 시작보다 앞에 있는 노트가 ${early}개 있습니다`);
    $('#edShift').value = song.shift;
    $('#edOffset').value = chart.offset;
    seek(cur - delta);
    rate();
  }
  $('#edShift').onchange = (e) => setShift(Number(e.target.value) || 0);
  $('#edShiftHere').onclick = () => {
    if (playing) toggle();
    setShift(Number($('#edShift').value) + cur);
  };
  $('#edSnap').onchange = draw;
  $('#edKeys').onchange = (e) => {
    chart.keys = Number(e.target.value);
    const before = chart.notes.length;
    chart.notes = chart.notes.filter((n) => n.l < chart.keys);
    if (chart.notes.length < before) toast(`범위를 벗어난 노트 ${before - chart.notes.length}개를 지웠습니다`);
    rate();
  };
  $('#edPlay').onclick = toggle;
  const save = () => saveCharts(song, charts)
    .then(() => toast('저장했습니다'))
    .catch((e) => toast('파일 저장 실패: ' + e.message));
  $('#edSave').onclick = save;
  $('#edTest').onclick = () => {
    if (playing) toggle();
    save();
    Game.start(song, { chart, from: Math.max(0, cur - 1000), onExit: () => open(song, chart.id) });
  };

  function onKey(e) {
    if (e.code === 'Space' && e.target.tagName !== 'INPUT') { e.preventDefault(); toggle(); }
  }
  function close() {
    if (playing) toggle();
    delete song.shift; // 저장 안 했으면 원래 값으로
  }

  const addDiff = () => $('#edDiffAdd').click();

  return { open, onKey, close, addDiff };
})();
