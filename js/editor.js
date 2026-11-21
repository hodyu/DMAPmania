// 곡 에디터: 노트 배치 / 삭제 / 롱노트, BPM·오프셋·스냅, 저장·내보내기
const Editor = (() => {
  const cv = $('#edCanvas');
  const ctx = cv.getContext('2d');
  const LANE_X = 10, STAGE_W = 400, HEAD_Y = 440, ZOOM = 0.3; // px / ms
  const laneW = () => STAGE_W / chart.keys;
  let song, chart, cur = 0, tool = 'note', drag = null, playing = false;

  function open(s) {
    if (!song || song.id !== s.id) cur = 0;
    song = s;
    chart = loadChart(s);
    $('#edTitle').textContent = s.title;
    $('#edBpm').value = chart.bpm;
    $('#edOffset').value = chart.offset;
    $('#edKeys').value = chart.keys;
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

  // 마우스·터치 공용 (Pointer Events)
  // 노트 도구: 탭/클릭하면 놓기, 위아래로 끌면 화면 이동 / 롱노트 도구: 끌어서 길이 정하기
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
    draw();
  }

  function toggle() {
    playing = !playing;
    $('#edPlay').textContent = playing ? '❚❚' : '▶';
    if (playing) { seekSong(song, cur); video.play(); tick(); }
    else video.pause();
  }
  function tick() {
    if (!playing) return;
    cur = songTime(song);
    if (video.ended || cur >= duration()) toggle();
    draw();
    requestAnimationFrame(tick);
  }

  function draw() {
    if (!chart) return;
    ctx.fillStyle = '#0b0816';
    ctx.fillRect(0, 0, cv.width, cv.height);
    // 박자선
    const beat = 60000 / chart.bpm, sub = snapMs();
    const tTop = tOf(0), tBottom = tOf(cv.height);
    for (let t = snap(tBottom) - sub; t <= tTop; t += sub) {
      const k = Math.round((t - chart.offset) / beat * 1000) / 1000;
      ctx.fillStyle = k % 4 === 0 ? 'rgba(242,238,252,0.5)' : Number.isInteger(k) ? 'rgba(242,238,252,0.2)' : 'rgba(255,255,255,0.07)';
      ctx.fillRect(LANE_X, yOf(t), STAGE_W, 1);
    }
    for (let i = 0; i <= chart.keys; i++) { ctx.fillStyle = '#241b45'; ctx.fillRect(LANE_X + i * laneW(), 0, 1, cv.height); }
    // 노트
    const list = drag ? [...chart.notes, { t: drag.t, l: drag.l, d: Math.max(0, drag.end - drag.t) }] : chart.notes;
    list.forEach((n) => {
      const W = laneW(), head = yOf(n.t), tail = yOf(n.t + n.d), x = LANE_X + n.l * W + 3;
      if (head < -20 || tail > cv.height + 20) return;
      ctx.fillStyle = laneColor(n.l, chart.keys);
      if (n.d > 0) { ctx.globalAlpha = 0.5; ctx.fillRect(x + 8, tail, W - 22, head - tail); ctx.globalAlpha = 1; }
      ctx.fillRect(x, head - 8, W - 6, 16);
    });
    // 재생 위치
    ctx.fillStyle = '#e23a7f';
    ctx.fillRect(0, HEAD_Y, cv.width, 3);
    $('#edTime').textContent = `${fmt(cur)} / ${fmt(duration())}`;
    $('#edSeek').value = duration() ? (cur / duration()) * 1000 : 0;
    $('#edCount').textContent = `노트 ${chart.notes.length}개`;
  }

  // ---- 패널 / 버튼 ----
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
  $('#edSeek').oninput = (e) => seek((e.target.value / 1000) * duration());
  $('#edPlay').onclick = toggle;
  $('#edSave').onclick = () => { saveChart(song, chart); toast('저장했습니다'); };
  $('#edExport').onclick = async () => {
    try {
      await navigator.clipboard.writeText(JSON.stringify(chart));
      toast('채보 JSON을 클립보드에 복사했습니다');
    } catch {
      toast('복사하지 못했습니다');
    }
  };
  $('#edImport').onchange = async (e) => {
    const f = e.target.files[0];
    if (!f) return;
    chart = JSON.parse(await f.text());
    $('#edBpm').value = chart.bpm;
    $('#edOffset').value = chart.offset;
    $('#edKeys').value = chart.keys = chart.keys || 4;
    draw();
  };
  $('#edTest').onclick = () => {
    if (playing) toggle();
    saveChart(song, chart);
    Game.start(song, { chart, from: Math.max(0, cur - 1000), onExit: () => open(song) });
  };

  function onKey(e) {
    if (e.target.tagName === 'INPUT') return;
    if (e.code === 'Space') { e.preventDefault(); toggle(); }
  }
  function close() { if (playing) toggle(); }

  return { open, onKey, close };
})();
