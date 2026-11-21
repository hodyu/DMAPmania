const $ = (s) => document.querySelector(s);
const video = $('#video');

function show(id) {
  document.querySelectorAll('.screen').forEach((s) => s.classList.toggle('active', s.id === id));
  document.body.classList.toggle('bg-video', id === 'play' && settings.bgVideo);
  document.body.classList.toggle('bg-select', id === 'select');
}

function toast(msg) {
  const t = $('#toast');
  t.textContent = msg;
  t.classList.add('show');
  clearTimeout(toast.timer);
  toast.timer = setTimeout(() => t.classList.remove('show'), 2000);
}

// localStorage 가 막혀 있어도 동작하게
const store = {
  get(k, fallback) { try { return JSON.parse(localStorage.getItem(k)) ?? fallback; } catch { return fallback; } },
  set(k, v) { try { localStorage.setItem(k, JSON.stringify(v)); } catch {} },
};

// settings (키는 e.code 기준이라 한글 입력 상태에서도 동작)
const DEFAULT_BINDS = {
  4: ['KeyD', 'KeyF', 'KeyJ', 'KeyK'],
  5: ['KeyD', 'KeyF', 'Space', 'KeyJ', 'KeyK'],
  6: ['KeyS', 'KeyD', 'KeyF', 'KeyJ', 'KeyK', 'KeyL'],
  7: ['KeyS', 'KeyD', 'KeyF', 'Space', 'KeyJ', 'KeyK', 'KeyL'],
};
const settings = Object.assign(
  { speed: 1, offset: 0, volume: 0.8, bgVideo: true, keyCount: 4, binds: structuredClone(DEFAULT_BINDS) },
  store.get('settings', {})
);
function saveSettings() {
  store.set('settings', settings);
  video.volume = settings.volume;
}
const keyLabel = (code) => code.replace(/^Key|^Digit/, '').replace('Space', '␣');

function laneColor(i, k) {
  if (k % 2 && i === (k - 1) / 2) return '#ffd36b';
  return Math.min(i, k - 1 - i) % 2 ? '#5ec8ff' : '#eeeeee';
}

// chart: 곡마다 난이도 배열 [{ name, level, keys, bpm, offset, notes: [{ t: ms, l: lane, d: hold ms }] }]
const DIFF_NAMES = ['Normal', 'Hard', 'Insane', 'Expert'];
const LV_COLORS = ['#6ec6ff', '#6ee7a8', '#e8e36a', '#ffb35c', '#ff6b6b', '#c78bff'];

function newChart(song, base = {}) {
  return { id: 'default', name: 'Normal', level: 1, keys: base.keys || settings.keyCount, bpm: base.bpm || song.bpm || 120, offset: base.offset || 0, notes: [] };
}
function loadCharts(song) {
  const charts = store.get('charts:' + song.id, null) || [newChart(song)];
  charts.forEach((c) => (c.id ||= c.name)); // 랭킹을 난이도 id 로 저장하므로 id 가 없으면 이름으로
  return charts;
}
function saveCharts(song, charts) {
  for (const c of charts) {
    c.notes.sort((a, b) => a.t - b.t);
    c.stars = starRating(c.notes, c.keys); // 목록에서 매번 계산하지 않게 저장해 둠
  }
  store.set('charts:' + song.id, charts);
}

// 랭킹: 곡+난이도마다 점수 상위 20개
const scoreKey = (song, chart) => `scores:${song.id}:${chart.id}`;
const loadScores = (song, chart) => store.get(scoreKey(song, chart), []);
function saveScore(song, chart, entry) {
  store.set(scoreKey(song, chart), [...loadScores(song, chart), entry].sort((a, b) => b.score - a.score).slice(0, 20));
}
function timeAgo(at) {
  const m = Math.floor((Date.now() - at) / 60000);
  if (m < 1) return '방금';
  if (m < 60) return m + '분 전';
  if (m < 1440) return Math.floor(m / 60) + '시간 전';
  return Math.floor(m / 1440) + '일 전';
}
const diffLabel = (c) => `${c.name} Lv.${c.level}`;
const levelColor = (lv) => LV_COLORS[Math.min(LV_COLORS.length - 1, Math.floor((lv - 1) / 2))];
const starColor = (stars) => LV_COLORS[Math.min(LV_COLORS.length - 1, Math.floor(stars / 1.5))];

// 채보가 비어 있으면 박자에 맞춰 대충 생성
function autoChart(chart, durationMs) {
  const beat = 60000 / chart.bpm, k = chart.keys, notes = [];
  let lane = 0;
  for (let t = chart.offset + beat * 4; t < durationMs - beat; t += beat) {
    lane = (lane + 1 + Math.floor(Math.random() * (k - 1))) % k;
    notes.push({ t: Math.round(t), l: lane, d: Math.random() < 0.1 ? Math.round(beat * 2) : 0 });
    if (Math.random() < 0.25) notes.push({ t: Math.round(t + beat / 2), l: (lane + Math.ceil(k / 2)) % k, d: 0 });
  }
  return notes;
}

// DMAP 곡은 긴 영상의 start~end 구간
const segStart = (song) => (song.start || 0) * 1000;
const segLength = (song) => (song.end ? song.end * 1000 - segStart(song) : (video.duration || 0) * 1000);
const seekSong = (song, ms) => (video.currentTime = (segStart(song) + ms) / 1000);
const songTime = (song) => video.currentTime * 1000 - segStart(song);

// DMAP 스트림(.m3u8)은 브라우저 기본 재생에 맡김
function loadVideo(song) {
  return new Promise((resolve, reject) => {
    if (video.dataset.src === song.url && video.readyState >= 1) return resolve();
    video.dataset.src = song.url;
    video.onloadedmetadata = resolve;
    video.onerror = () => { video.dataset.src = ''; reject(new Error('영상을 불러올 수 없습니다: ' + song.title)); };
    video.src = song.url;
  });
}

const fmt = (ms) => {
  const s = Math.max(0, Math.floor(ms / 1000));
  return Math.floor(s / 60) + ':' + String(s % 60).padStart(2, '0');
};
const esc = (s) => String(s).replace(/[&<>"']/g, (c) => `&#${c.charCodeAt(0)};`);

// 별점: osu!mania 난이도 계산(ppy/osu ManiaDifficultyCalculator + Strain 스킬)을 옮긴 것
// 노트마다 "레인별 부담(individual)" + "전체 부담(overall)"을 쌓고,
// 400ms 구간마다 최고값을 모아 큰 순서로 0.9 씩 가중합 → 0.018 배
const STAR_SCALING_FACTOR = 0.018;
const INDIVIDUAL_DECAY_BASE = 0.125;
const OVERALL_DECAY_BASE = 0.3;
const RELEASE_THRESHOLD = 30;
const SECTION_LENGTH = 400;
const DECAY_WEIGHT = 0.9;

function starRating(notes, keys) {
  if (notes.length < 2) return 0;
  const sorted = [...notes].sort((a, b) => Math.round(a.t) - Math.round(b.t));
  const applyDecay = (value, deltaTime, decayBase) => value * Math.pow(decayBase, deltaTime / 1000);
  const bigger = (a, b) => a - 1 > b; // Precision.DefinitelyBigger(a, b, 1)
  const startTimes = Array(keys).fill(0), endTimes = Array(keys).fill(0), individualStrains = Array(keys).fill(0);
  let individualStrain = 0, overallStrain = 1, peaks = [], sectionPeak = 0, sectionEnd = 0;

  for (let i = 1; i < sorted.length; i++) {
    const note = sorted[i], prevStart = sorted[i - 1].t;
    const startTime = note.t, endTime = note.t + (note.d || 0), column = note.l, deltaTime = startTime - prevStart;

    // 400ms 구간이 바뀌면 지난 구간의 최고값을 저장하고, 새 구간은 감쇠된 값부터 시작
    if (i === 1) sectionEnd = Math.ceil(startTime / SECTION_LENGTH) * SECTION_LENGTH;
    while (startTime > sectionEnd) {
      peaks.push(sectionPeak);
      const offset = sectionEnd - prevStart;
      sectionPeak = applyDecay(individualStrain, offset, INDIVIDUAL_DECAY_BASE) + applyDecay(overallStrain, offset, OVERALL_DECAY_BASE);
      sectionEnd += SECTION_LENGTH;
    }

    let isOverlapping = false, closestEndTime = Math.abs(endTime - startTime), holdFactor = 1, holdAddition = 0;
    for (let k = 0; k < keys; k++) {
      // 다른 롱노트 끝이 이 노트 몸통과 겹침
      isOverlapping ||= bigger(endTimes[k], startTime) && bigger(endTime, endTimes[k]) && bigger(startTime, startTimes[k]);
      // 다른 레인을 누르고 있는 중이면 전부 조금 어려워짐
      if (bigger(endTimes[k], endTime) && bigger(startTime, startTimes[k])) holdFactor = 1.25;
      closestEndTime = Math.min(closestEndTime, Math.abs(endTime - endTimes[k]));
    }
    // 겹친 롱노트를 따로 떼야 하면 가산 (비슷한 때 같이 떼면 쉬움)
    if (isOverlapping) holdAddition = 1 / (1 + Math.exp(0.27 * (RELEASE_THRESHOLD - closestEndTime)));

    individualStrains[column] = applyDecay(individualStrains[column], startTime - startTimes[column], INDIVIDUAL_DECAY_BASE) + 2 * holdFactor;
    // 동시치기는 그중 가장 어려운 레인 값을 씀
    individualStrain = deltaTime <= 1 ? Math.max(individualStrain, individualStrains[column]) : individualStrains[column];
    overallStrain = applyDecay(overallStrain, deltaTime, OVERALL_DECAY_BASE) + (1 + holdAddition) * holdFactor;

    startTimes[column] = startTime;
    endTimes[column] = endTime;
    sectionPeak = Math.max(sectionPeak, individualStrain + overallStrain);
  }
  peaks.push(sectionPeak);

  let difficulty = 0, weight = 1;
  for (const strain of peaks.filter((p) => p > 0).sort((a, b) => b - a)) {
    difficulty += strain * weight;
    weight *= DECAY_WEIGHT;
  }
  return difficulty * STAR_SCALING_FACTOR;
}
const chartStars = (chart) => chart.stars ?? starRating(chart.notes, chart.keys);
const starText = (chart) => (chart.notes.length ? '★' + chartStars(chart).toFixed(2) : '★ -');
