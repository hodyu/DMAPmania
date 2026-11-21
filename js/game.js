// 플레이 화면 (osu!mania 스타일): 4~7키, 판정, 콤보, 점수, 체력, 오차 막대, 일시정지
//
// 최적화 포인트
// - 노트를 레인별 배열로 나누고 "다음 판정할 노트" 위치(next)만 기억 → 매 프레임 전체 노트를 돌지 않음
// - 화면에 보이는 노트만 그림 (보이는 범위를 벗어나면 바로 멈춤)
// - 같은 색 노트는 Path2D 하나로 모아서 한 번에 칠함
// - 스테이지(검은 배경, 줄)는 미리 그려 두고 복사만 함, 레인 빛 그라데이션도 미리 만들어 둠
// - 영상 시간(currentTime)은 갱신이 띄엄띄엄이라 노트가 끊겨 보임 → performance.now() 로 보간
// - 루프가 두 개 돌지 않도록 실행 번호(runId)로 관리
const Game = (() => {
  const cv = $('#playCanvas');
  const ctx = cv.getContext('2d');
  const W = 1280, H = 720, JUDGE_Y = 600;
  const touchMode = matchMedia('(pointer: coarse)').matches; // 터치 기기면 레인을 넓게
  let COL = 76;
  // [창(ms), 이름, 점수, 색]  — osu!mania 판정 이름
  const J = [[16, 'MAX', 300, '#ffffff'], [40, '300', 300, '#ffd36b'], [73, '200', 200, '#7be38a'],
             [103, '100', 100, '#5ec8ff'], [127, '50', 50, '#c9a7ff']];
  const MISS = 164;
  const stage = document.createElement('canvas'); // 미리 그린 스테이지
  stage.width = W; stage.height = H;

  let song, opts, keys, left, total, binds, colors, glows, runId = 0, paused, startAt, started;
  let lanes, next, holds, pressed, flash, stats, last, errors, hp, endTime, clock;

  function start(s, o = {}) {
    song = s; opts = o;
    const run = ++runId; // 이전 루프는 자동으로 멈춤
    const chart = o.chart || loadChart(s);
    keys = chart.keys;
    binds = settings.binds[keys];
    COL = touchMode ? Math.min(150, Math.floor(1100 / keys)) : 76;
    left = (W - COL * keys) / 2;
    colors = Array.from({ length: keys }, (_, i) => laneColor(i, keys));
    show('play');
    $('#result').classList.add('hidden');
    $('#pause').classList.add('hidden');
    loadVideo(s).then(() => {
      if (run !== runId) return;
      const src = chart.notes.length ? chart.notes : autoChart(chart, segLength(s));
      lanes = Array.from({ length: keys }, () => []);
      endTime = 0; total = 0;
      for (const n of src) {
        if (n.t < (o.from || 0) || n.l >= keys) continue;
        lanes[n.l].push({ t: n.t, l: n.l, d: n.d || 0 });
        endTime = Math.max(endTime, n.t + (n.d || 0));
        total++;
      }
      lanes.forEach((a) => a.sort((x, y) => x.t - y.t));
      endTime = Math.min(total ? endTime + 1500 : Infinity, segLength(s) + 300);
      next = Array(keys).fill(0);
      holds = Array(keys).fill(null);
      pressed = Array(keys).fill(false);
      flash = Array(keys).fill(0);
      stats = { sum: 0, combo: 0, maxCombo: 0, count: [0, 0, 0, 0, 0, 0] }; // MAX 300 200 100 50 MISS
      errors = []; hp = 1; last = null;
      prepareStage();
      video.pause();
      seekSong(s, o.from || 0);
      startAt = performance.now() + 1500; // 준비 시간
      started = false; paused = false; clock = null;
      requestAnimationFrame(() => loop(run));
    }).catch((e) => { toast(e.message); exit(); });
  }

  function prepareStage() {
    const g = stage.getContext('2d');
    g.clearRect(0, 0, W, H);
    g.fillStyle = 'rgba(0,0,0,0.88)';
    g.fillRect(left, 0, COL * keys, H);
    g.fillStyle = 'rgba(255,255,255,0.06)';
    for (let i = 1; i < keys; i++) g.fillRect(left + i * COL, 0, 1, H);
    g.fillStyle = 'rgba(255,255,255,0.35)';
    g.fillRect(left - 2, 0, 2, H); g.fillRect(left + COL * keys, 0, 2, H);
    g.fillStyle = '#ffffff';
    g.fillRect(left, JUDGE_Y, COL * keys, 3);
    glows = colors.map((c) => {
      const gr = ctx.createLinearGradient(0, JUDGE_Y, 0, JUDGE_Y - 300);
      gr.addColorStop(0, c + '55'); gr.addColorStop(1, c + '00');
      return gr;
    });
  }

  // 현재 곡 시간(ms). 영상 시간을 기준으로 부드럽게 보간, 시작 전엔 음수 쪽으로
  function now() {
    const p = performance.now();
    if (!started) return (opts.from || 0) - (startAt - p);
    const media = songTime(song);
    if (!clock || video.paused) clock = { media, p };
    let t = clock.media + (p - clock.p) * video.playbackRate;
    if (Math.abs(t - media) > 60) { clock = { media, p }; t = media; } // 많이 어긋나면 다시 맞춤
    return t - settings.offset;
  }

  function hit(err) {
    const i = J.findIndex((j) => Math.abs(err) <= j[0]);
    if (i < 0) return miss();
    stats.count[i]++;
    stats.sum += J[i][2];
    stats.combo++;
    stats.maxCombo = Math.max(stats.maxCombo, stats.combo);
    hp = Math.min(1, hp + 0.02);
    errors.push({ err, at: performance.now(), color: J[i][3] });
    if (errors.length > 40) errors.shift();
    last = { i, at: performance.now() };
  }
  function miss() {
    stats.count[5]++;
    stats.combo = 0;
    hp = Math.max(0, hp - 0.08);
    last = { i: 5, at: performance.now() };
  }

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
    if (!n) return;
    holds[l] = null;
    if (now() < n.t + n.d - MISS) miss(); // 롱노트를 너무 일찍 뗌
  }

  function loop(run) {
    if (run !== runId) return;
    if (!paused) {
      if (!started && performance.now() >= startAt) { started = true; video.play(); }
      const t = now();
      for (let l = 0; l < keys; l++) {
        const a = lanes[l];
        while (next[l] < a.length && t - a[next[l]].t > MISS) { next[l]++; miss(); } // 지나간 노트 = MISS
        if (holds[l] && t >= holds[l].t + holds[l].d) holds[l] = null; // 롱노트 끝
      }
      draw(t);
      if (t > endTime || video.ended) return finish();
    }
    requestAnimationFrame(() => loop(run));
  }

  // ---- 그리기 ----
  function draw(t) {
    const speed = 0.6 * settings.speed; // px / ms
    const tMax = t + (JUDGE_Y + 30) / speed; // 이보다 늦은 노트는 화면 밖
    const p = performance.now();
    ctx.clearRect(0, 0, W, H);
    ctx.drawImage(stage, 0, 0);

    // 누른 레인 빛
    for (let i = 0; i < keys; i++) {
      if (!pressed[i]) continue;
      ctx.fillStyle = glows[i];
      ctx.fillRect(left + i * COL, JUDGE_Y - 300, COL, 300);
    }

    // 노트: 레인(=색)마다 Path2D 하나로 모아서 한 번에 칠함
    const w = COL - 6;
    for (let l = 0; l < keys; l++) {
      const heads = new Path2D(), bodies = new Path2D(), x = left + l * COL + 3, a = lanes[l];
      const h = holds[l];
      if (h) { // 누르고 있는 롱노트
        const tail = JUDGE_Y - (h.t + h.d - t) * speed;
        bodies.rect(x + 8, tail, w - 16, JUDGE_Y - tail);
        heads.roundRect(x, tail - 6, w, 10, 4);
        heads.roundRect(x, JUDGE_Y - 22, w, 22, 5);
      }
      for (let k = next[l]; k < a.length; k++) {
        const n = a[k];
        if (n.t > tMax) break; // 여기부터는 전부 화면 밖
        const head = JUDGE_Y - (n.t - t) * speed;
        if (n.d > 0) {
          const tail = JUDGE_Y - (n.t + n.d - t) * speed;
          bodies.rect(x + 8, tail, w - 16, head - tail);
          heads.roundRect(x, tail - 6, w, 10, 4);
        }
        heads.roundRect(x, head - 22, w, 22, 5);
      }
      ctx.fillStyle = colors[l];
      ctx.globalAlpha = 0.6; ctx.fill(bodies);
      ctx.globalAlpha = 1; ctx.fill(heads);
    }

    // 리셉터(키)
    ctx.textAlign = 'center';
    ctx.font = '700 18px "Exo 2", sans-serif';
    ctx.lineWidth = 2;
    for (let i = 0; i < keys; i++) {
      const x = left + i * COL, c = colors[i];
      const lit = pressed[i] || p - flash[i] < 80;
      ctx.beginPath(); ctx.roundRect(x + 6, JUDGE_Y + 12, COL - 12, 56, 8);
      ctx.fillStyle = lit ? c : '#16112b'; ctx.fill();
      ctx.strokeStyle = c; ctx.stroke();
      ctx.fillStyle = lit ? '#0b0816' : c;
      ctx.fillText(keyLabel(binds[i]), x + COL / 2, JUDGE_Y + 46);
    }

    // 체력 (스테이지 오른쪽)
    const hx = left + COL * keys + 10;
    ctx.fillStyle = 'rgba(255,255,255,0.12)'; ctx.fillRect(hx, 80, 8, JUDGE_Y - 80);
    ctx.fillStyle = hp > 0.3 ? '#7be38a' : '#ff6b6b';
    ctx.fillRect(hx, JUDGE_Y - (JUDGE_Y - 80) * hp, 8, (JUDGE_Y - 80) * hp);

    // 콤보 / 판정 (튀어나오는 애니메이션)
    const cx = left + (COL * keys) / 2;
    if (stats.combo > 0) {
      ctx.fillStyle = '#ffffff'; ctx.font = '800 54px "Exo 2", sans-serif';
      ctx.fillText(stats.combo, cx, 250);
    }
    if (last && p - last.at < 600) {
      const k = Math.min(1, (p - last.at) / 80), s = 1.3 - 0.3 * k;
      ctx.save();
      ctx.translate(cx, 340); ctx.scale(s, s);
      ctx.globalAlpha = 1 - Math.max(0, (p - last.at - 400) / 200);
      ctx.fillStyle = last.i === 5 ? '#ff4d4d' : J[last.i][3];
      ctx.font = '800 40px "Exo 2", sans-serif';
      ctx.fillText(last.i === 5 ? 'MISS' : J[last.i][1], 0, 0);
      ctx.restore();
    }

    // 오차 막대 (화면 아래 가운데)
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
    ctx.fillStyle = '#ffffff'; ctx.fillRect(W / 2 - 1, ey - 12, 2, 24);

    // 점수 / 정확도 / 진행 (오른쪽 위)
    ctx.textAlign = 'right';
    ctx.font = '800 44px "Exo 2", sans-serif';
    ctx.fillText(String(score()).padStart(7, '0'), W - 28, 58);
    ctx.font = '600 24px "Exo 2", sans-serif';
    ctx.fillText(acc().toFixed(2) + '%', W - 28, 92);
    const prog = Math.max(0, Math.min(1, t / endTime));
    ctx.beginPath(); ctx.moveTo(W - 160, 82);
    ctx.arc(W - 160, 82, 12, -Math.PI / 2, -Math.PI / 2 + prog * Math.PI * 2);
    ctx.fillStyle = 'rgba(255,255,255,0.7)'; ctx.fill();
    ctx.beginPath(); ctx.arc(W - 160, 82, 12, 0, Math.PI * 2);
    ctx.strokeStyle = '#ffffff'; ctx.stroke();

    // 곡 정보 (왼쪽 위)
    ctx.textAlign = 'left'; ctx.fillStyle = '#ffffff';
    ctx.font = '700 18px "Noto Sans KR", sans-serif';
    ctx.fillText(song.title, 24, 40);
    ctx.font = '13px "Noto Sans KR", sans-serif'; ctx.fillStyle = '#b8aee0';
    ctx.fillText(`${keys}K · 속도 ${settings.speed}${touchMode ? "" : " · Esc 일시정지"}`, 24, 62);
  }

  const judged = () => stats.count.reduce((a, b) => a + b, 0);
  const acc = () => (judged() ? (stats.sum / (judged() * 300)) * 100 : 100);
  const score = () => Math.round((stats.sum / (Math.max(total, 1) * 300)) * 1000000);

  // ---- 일시정지 / 결과 ----
  function pause() {
    paused = true; video.pause();
    pressed.fill(false); holds.fill(null); touches.clear();
    $('#pause').classList.remove('hidden');
  }
  function resume() {
    $('#pause').classList.add('hidden');
    paused = false; clock = null;
    if (started) video.play(); else startAt = performance.now() + 1000;
  }
  $('#pResume').onclick = resume;
  $('#pRetry').onclick = () => start(song, opts);
  $('#pQuit').onclick = () => exit();

  function finish() {
    runId++;
    video.pause();
    const a = acc();
    const grade = a >= 100 ? 'SS' : a >= 95 ? 'S' : a >= 90 ? 'A' : a >= 80 ? 'B' : a >= 70 ? 'C' : 'D';
    const names = ['MAX', '300', '200', '100', '50', 'MISS'];
    const r = $('#result');
    r.innerHTML = `<div class="grade">${grade}</div>
      <div class="rscore">${score().toLocaleString()}</div>
      <div>정확도 ${a.toFixed(2)}% · 최대 콤보 ${stats.maxCombo}x</div>
      <div class="counts">${stats.count.map((c, i) => `<span><b>${names[i]}</b>${c}</span>`).join('')}</div>
      <div><button id="retry">다시 하기</button> <button id="back" class="accent">돌아가기</button></div>`;
    r.classList.remove('hidden');
    $('#retry').onclick = () => start(song, opts);
    $('#back').onclick = exit;
  }

  function exit() {
    runId++;
    video.pause();
    $('#pause').classList.add('hidden');
    if (opts && opts.onExit) opts.onExit();
    else Select.open('play');
  }

  // ---- 터치 / 마우스 ----
  // 손가락마다(pointerId) 레인을 기억해서 여러 손가락 동시 입력, 레인 사이로 미끄러져도 따라감
  const touches = new Map();
  function laneAt(clientX) {
    const r = cv.getBoundingClientRect();
    const s = Math.min(r.width / W, r.height / H); // 캔버스가 화면에 맞춰 줄어든 비율
    const x = (clientX - r.left - (r.width - W * s) / 2) / s;
    return Math.max(0, Math.min(keys - 1, Math.floor((x - left) / COL))); // 스테이지 밖은 가장 가까운 레인
  }
  const playable = () => lanes && !paused && $('#result').classList.contains('hidden');
  cv.addEventListener('pointerdown', (e) => {
    if (!playable()) return;
    e.preventDefault();
    try { cv.setPointerCapture(e.pointerId); } catch {}
    const l = laneAt(e.clientX);
    touches.set(e.pointerId, l);
    keyDown(l);
  });
  cv.addEventListener('pointermove', (e) => {
    if (!touches.has(e.pointerId) || !playable()) return;
    const l = laneAt(e.clientX), old = touches.get(e.pointerId);
    if (l === old) return;
    touches.set(e.pointerId, l);
    if (![...touches.values()].includes(old)) keyUp(old);
    keyDown(l);
  });
  const lift = (e) => {
    if (!touches.has(e.pointerId)) return;
    const l = touches.get(e.pointerId);
    touches.delete(e.pointerId);
    if (lanes && ![...touches.values()].includes(l)) keyUp(l); // 같은 레인을 누른 다른 손가락이 없을 때만 뗌
  };
  cv.addEventListener('pointerup', lift);
  cv.addEventListener('pointercancel', lift);
  $('#pauseBtn').onclick = () => (paused ? resume() : lanes && pause());

  function onKey(e, down) {
    if (!lanes || $('#play').classList.contains('active') === false) return;
    if (!$('#result').classList.contains('hidden')) return;
    if (down && e.code === 'Escape') return paused ? resume() : pause();
    if (paused) return;
    const l = binds.indexOf(e.code);
    if (l < 0 || e.repeat) return;
    e.preventDefault();
    down ? keyDown(l) : keyUp(l);
  }

  return { start, onKey };
})();
