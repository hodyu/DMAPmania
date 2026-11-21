const Game = (() => {
  const cv = $('#playCanvas');
  const ctx = cv.getContext('2d');
  const W = 1280, H = 720, JUDGE_Y = 600;
  const touchMode = matchMedia('(pointer: coarse)').matches; // 터치 기기는 레인을 넓게
  // [판정 범위(ms), 이름, 점수, 색]
  const J = [[16, 'MAX', 300, '#ffffff'], [40, '300', 300, '#ffd36b'], [73, '200', 200, '#7be38a'],
             [103, '100', 100, '#5ec8ff'], [127, '50', 50, '#c9a7ff']];
  const MISS = 164;
  const RESULT_NAMES = ['MAX', '300', '200', '100', '50', 'MISS'];

  let song, opts, chart, diffName, keys, COL, left, total, binds, colors, runId = 0, paused, startAt, started;
  let lanes, next, holds, pressed, flash, stats, last, errors, hp, endTime, clock;

  function start(s, o = {}) {
    song = s; opts = o;
    const run = ++runId; // 이전 루프는 runId 가 달라져서 멈춤
    chart = o.chart || loadCharts(s)[0];
    const from = o.from || 0;
    diffName = diffLabel(chart) + " " + starText(chart);
    keys = chart.keys;
    binds = settings.binds[keys];
    COL = touchMode ? Math.min(150, Math.floor(1100 / keys)) : 76;
    left = (W - COL * keys) / 2;
    colors = binds.map((_, i) => laneColor(i, keys));
    show('play');
    $('#result').classList.add('hidden');
    $('#pause').classList.add('hidden');
    loadVideo(s).then(() => {
      if (run !== runId) return;
      const notes = (chart.notes.length ? chart.notes : autoChart(chart, segLength(s)))
        .filter((n) => n.t >= from && n.l < keys).sort((a, b) => a.t - b.t);
      lanes = colors.map((_, l) => notes.filter((n) => n.l === l));
      total = notes.length;
      endTime = Math.min(total ? Math.max(...notes.map((n) => n.t + n.d)) + 1500 : Infinity, segLength(s) + 300);
      next = Array(keys).fill(0);
      holds = Array(keys).fill(null);
      pressed = Array(keys).fill(false);
      flash = Array(keys).fill(0);
      stats = { sum: 0, combo: 0, maxCombo: 0, count: [0, 0, 0, 0, 0, 0], errSum: 0, errCount: 0 };
      errors = []; hp = 1; last = null;
      video.pause();
      seekSong(s, from);
      startAt = performance.now() + 1500;
      started = false; paused = false; clock = null;
      loop(run);
    }).catch((e) => { toast(e.message); exit(); });
  }

  // currentTime 이 띄엄띄엄 갱신돼서 performance.now() 로 보간
  function now() {
    const p = performance.now();
    if (!started) return (opts.from || 0) - (startAt - p);
    const media = songTime(song);
    if (!clock || video.paused) clock = { media, p };
    let t = clock.media + (p - clock.p) * video.playbackRate;
    if (Math.abs(t - media) > 60) { clock = { media, p }; t = media; }
    return t - settings.offset;
  }

  function judge(i, err) {
    stats.count[i]++;
    last = { i, at: performance.now() };
    if (i === 5) { stats.combo = 0; hp = Math.max(0, hp - 0.08); return; }
    stats.sum += J[i][2];
    stats.maxCombo = Math.max(stats.maxCombo, ++stats.combo);
    hp = Math.min(1, hp + 0.02);
    stats.errSum += err;
    stats.errCount++;
    errors.push({ err, at: last.at, color: J[i][3] });
    if (errors.length > 40) errors.shift();
  }
  const hit = (err) => { const i = J.findIndex((j) => Math.abs(err) <= j[0]); judge(i < 0 ? 5 : i, err); };
  const miss = () => judge(5);

  function keyDown(l) {
    pressed[l] = true;
    flash[l] = performance.now();
    const n = lanes[l][next[l]], t = now();
    if (!n || Math.abs(n.t - t) > MISS) return;
    next[l]++;
    hit(t - n.t);
    if (n.d > 0) holds[l] = n;
  }
  function keyUp(l) {
    pressed[l] = false;
    const n = holds[l];
    holds[l] = null;
    if (n && now() < n.t + n.d - MISS) miss(); // 롱노트를 너무 일찍 뗌
  }

  function loop(run) {
    if (run !== runId) return;
    if (!paused) {
      if (!started && performance.now() >= startAt) { started = true; video.play(); }
      const t = now();
      for (let l = 0; l < keys; l++) {
        while (next[l] < lanes[l].length && t - lanes[l][next[l]].t > MISS) { next[l]++; miss(); }
        if (holds[l] && t >= holds[l].t + holds[l].d) holds[l] = null;
      }
      draw(t);
      if (hp <= 0 && !opts.onExit) return finish(true); // 체력 0 = 실패 (에디터 테스트는 제외)
      if (t > endTime || video.ended) return finish(false);
    }
    requestAnimationFrame(() => loop(run));
  }

  function drawNote(n, x, t, speed, held) {
    const w = COL - 6, head = held ? JUDGE_Y : JUDGE_Y - (n.t - t) * speed; // 누르고 있는 롱노트는 판정선에 붙음
    if (n.d > 0) {
      const tail = JUDGE_Y - (n.t + n.d - t) * speed;
      ctx.globalAlpha = 0.6;
      ctx.fillRect(x + 8, tail, w - 16, head - tail);
      ctx.globalAlpha = 1;
      ctx.fillRect(x, tail - 6, w, 8);
    }
    ctx.fillRect(x, head - 20, w, 20);
  }

  function draw(t) {
    const speed = 0.6 * settings.speed; // px / ms
    const tMax = t + JUDGE_Y / speed; // 이보다 늦은 노트는 화면 밖
    const p = performance.now(), stageW = COL * keys, cx = left + stageW / 2;
    ctx.clearRect(0, 0, W, H);
    ctx.fillStyle = 'rgba(0,0,0,0.88)';
    ctx.fillRect(left, 0, stageW, H);
    ctx.fillStyle = 'rgba(255,255,255,0.35)';
    ctx.fillRect(left - 2, 0, 2, H);
    ctx.fillRect(left + stageW, 0, 2, H);
    ctx.fillStyle = '#ffffff';
    ctx.fillRect(left, JUDGE_Y, stageW, 3);

    // 레인: 누른 빛, 노트, 키
    ctx.textAlign = 'center';
    ctx.font = '700 18px sans-serif';
    ctx.lineWidth = 2;
    for (let l = 0; l < keys; l++) {
      const x = left + l * COL, c = colors[l], lit = pressed[l] || p - flash[l] < 80;
      if (pressed[l]) { ctx.fillStyle = c + '30'; ctx.fillRect(x, JUDGE_Y - 300, COL, 300); }
      ctx.fillStyle = c;
      if (holds[l]) drawNote(holds[l], x + 3, t, speed, true);
      for (let k = next[l]; k < lanes[l].length && lanes[l][k].t < tMax; k++) drawNote(lanes[l][k], x + 3, t, speed);
      ctx.beginPath();
      ctx.roundRect(x + 6, JUDGE_Y + 12, COL - 12, 56, 8);
      ctx.fillStyle = lit ? c : '#111111';
      ctx.fill();
      ctx.strokeStyle = c;
      ctx.stroke();
      ctx.fillStyle = lit ? '#000000' : c;
      ctx.fillText(keyLabel(binds[l]), x + COL / 2, JUDGE_Y + 46);
    }

    // 체력
    const hx = left + stageW + 10, hh = JUDGE_Y - 80;
    ctx.fillStyle = 'rgba(255,255,255,0.12)';
    ctx.fillRect(hx, 80, 8, hh);
    ctx.fillStyle = hp > 0.3 ? '#7be38a' : '#ff6b6b';
    ctx.fillRect(hx, JUDGE_Y - hh * hp, 8, hh * hp);

    // 콤보, 판정
    ctx.fillStyle = '#ffffff';
    ctx.font = '800 54px sans-serif';
    if (stats.combo > 0) ctx.fillText(stats.combo, cx, 250);
    if (last && p - last.at < 600) {
      const scale = 1.3 - 0.3 * Math.min(1, (p - last.at) / 80);
      ctx.save();
      ctx.translate(cx, 340);
      ctx.scale(scale, scale);
      ctx.globalAlpha = 1 - Math.max(0, (p - last.at - 400) / 200);
      ctx.fillStyle = last.i === 5 ? '#ff4d4d' : J[last.i][3];
      ctx.font = '800 40px sans-serif';
      ctx.fillText(RESULT_NAMES[last.i], 0, 0);
      ctx.restore();
    }

    // 오차 막대
    const ew = 260, ey = H - 14;
    for (let i = J.length - 1; i >= 0; i--) {
      const bw = (J[i][0] / MISS) * ew;
      ctx.fillStyle = J[i][3] + '40';
      ctx.fillRect(W / 2 - bw / 2, ey - 3, bw, 6);
    }
    for (const e of errors) {
      const age = p - e.at;
      if (age > 3000) continue;
      ctx.globalAlpha = 1 - age / 3000;
      ctx.fillStyle = e.color;
      ctx.fillRect(W / 2 + (e.err / MISS) * (ew / 2) - 1, ey - 10, 2, 20);
    }
    ctx.globalAlpha = 1;
    ctx.fillStyle = '#ffffff';
    ctx.fillRect(W / 2 - 1, ey - 12, 2, 24);

    // 진행도, 점수, 정확도
    ctx.fillRect(0, 0, W * Math.max(0, Math.min(1, t / endTime)), 3);
    ctx.textAlign = 'right';
    ctx.font = '800 44px sans-serif';
    ctx.fillText(String(score()).padStart(7, '0'), W - 28, 58);
    ctx.font = '600 24px sans-serif';
    ctx.fillText(acc().toFixed(2) + '%', W - 28, 92);

    // 곡 정보
    ctx.textAlign = 'left';
    ctx.font = '700 18px sans-serif';
    ctx.fillText(song.title, 24, 40);
    ctx.font = '13px sans-serif';
    ctx.fillStyle = '#888888';
    ctx.fillText(`${diffName} · ${keys}K · 속도 ${settings.speed} · 오프셋 ${settings.offset}ms${touchMode ? '' : ' · Esc 일시정지 · -/= 오프셋'}`, 24, 62);
  }

  const judged = () => stats.count.reduce((a, b) => a + b, 0);
  const acc = () => (judged() ? (stats.sum / (judged() * 300)) * 100 : 100);
  const score = () => Math.round((stats.sum / (Math.max(total, 1) * 300)) * 1000000);

  function pause() {
    paused = true;
    video.pause();
    pressed.fill(false); holds.fill(null); touches.clear();
    $('#pause').classList.remove('hidden');
  }
  function resume() {
    $('#pause').classList.add('hidden');
    paused = false; clock = null;
    if (started) video.play();
    else startAt = performance.now() + 1000;
  }

  function finish(failed) {
    runId++;
    video.pause();
    const a = acc();
    const grade = failed ? 'F' : a >= 100 ? 'SS' : a >= 95 ? 'S' : a >= 90 ? 'A' : a >= 80 ? 'B' : a >= 70 ? 'C' : 'D';
    // 실패했거나 에디터 테스트면 기록 안 함
    if (!failed && !opts.onExit) saveScore(song, chart, { score: score(), acc: a, combo: stats.maxCombo, grade, at: Date.now() });
    // 평균 오차: +면 늦게 친 것 → 오프셋을 그만큼 올리면 맞음
    const avgErr = stats.errCount ? Math.round(stats.errSum / stats.errCount) : 0;
    const offsetHint = stats.errCount >= 10 && Math.abs(avgErr) >= 3
      ? `<div class="dim">평균 ${avgErr > 0 ? '+' + avgErr + 'ms 늦게' : avgErr + 'ms 빠르게'} 쳤어요 <button id="fixOffset">오프셋 ${settings.offset} → ${settings.offset + avgErr}ms</button></div>` : '';
    $('#result').innerHTML = `${failed ? '<h2 class="failed">실패</h2>' : ''}<div class="grade">${grade}</div>
      <div class="rscore">${score().toLocaleString()}</div>
      <div>정확도 ${a.toFixed(2)}% · 최대 콤보 ${stats.maxCombo}x</div>
      <div class="counts">${stats.count.map((c, i) => `<span><b>${RESULT_NAMES[i]}</b>${c}</span>`).join('')}</div>
      ${offsetHint}
      <div><button id="retry">다시 하기</button> <button id="back" class="accent">돌아가기</button></div>`;
    $('#result').classList.remove('hidden');
    if (offsetHint) $('#fixOffset').onclick = () => { changeOffset(avgErr); $('#fixOffset').disabled = true; };
    $('#retry').onclick = () => start(song, opts);
    $('#back').onclick = exit;
  }

  function exit() {
    runId++;
    video.pause();
    $('#pause').classList.add('hidden');
    if (opts.onExit) opts.onExit();
    else Select.open('play');
  }

  $('#pResume').onclick = resume;
  $('#pRetry').onclick = () => start(song, opts);
  $('#pQuit').onclick = exit;
  $('#pauseBtn').onclick = () => (paused ? resume() : lanes && pause());

  // 터치: 손가락(pointerId)마다 레인을 기억, 옆 레인으로 미끄러져도 따라감
  const touches = new Map();
  function laneAt(clientX) {
    const r = cv.getBoundingClientRect(), s = Math.min(r.width / W, r.height / H);
    const x = (clientX - r.left - (r.width - W * s) / 2) / s;
    return Math.max(0, Math.min(keys - 1, Math.floor((x - left) / COL)));
  }
  const playable = () => lanes && !paused && $('#result').classList.contains('hidden');
  const release = (l) => [...touches.values()].includes(l) || keyUp(l); // 같은 레인을 누른 손가락이 없을 때만 뗌
  cv.onpointerdown = (e) => {
    if (!playable()) return;
    e.preventDefault();
    cv.setPointerCapture(e.pointerId);
    const l = laneAt(e.clientX);
    touches.set(e.pointerId, l);
    keyDown(l);
  };
  cv.onpointermove = (e) => {
    const old = touches.get(e.pointerId), l = laneAt(e.clientX);
    if (old === undefined || l === old || !playable()) return;
    touches.set(e.pointerId, l);
    release(old);
    keyDown(l);
  };
  cv.onpointerup = cv.onpointercancel = (e) => {
    const l = touches.get(e.pointerId);
    if (l === undefined) return;
    touches.delete(e.pointerId);
    if (lanes) release(l);
  };

  // 오프셋 직접 조절: 플레이 중 - / = 키 (5ms씩), 결과 화면 버튼
  function changeOffset(ms) {
    settings.offset += ms;
    saveSettings();
    toast(`오프셋 ${settings.offset}ms`);
  }

  function onKey(e, down) {
    if (!lanes || !$('#result').classList.contains('hidden')) return;
    if (down && e.code === 'Escape') return paused ? resume() : pause();
    if (down && e.code === 'Minus') return changeOffset(-5);
    if (down && e.code === 'Equal') return changeOffset(5);
    const l = binds.indexOf(e.code);
    if (paused || l < 0 || e.repeat) return;
    e.preventDefault();
    down ? keyDown(l) : keyUp(l);
  }

  return { start, onKey };
})();
