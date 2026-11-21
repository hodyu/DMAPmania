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
  return { name: 'Normal', level: 1, keys: base.keys || settings.keyCount, bpm: base.bpm || song.bpm || 120, offset: base.offset || 0, notes: [] };
}
const loadCharts = (song) => store.get('charts:' + song.id, null) || [newChart(song)];
function saveCharts(song, charts) {
  charts.forEach((c) => c.notes.sort((a, b) => a.t - b.t));
  store.set('charts:' + song.id, charts);
}
const diffLabel = (c) => `${c.name} Lv.${c.level}`;
const levelColor = (lv) => LV_COLORS[Math.min(LV_COLORS.length - 1, Math.floor((lv - 1) / 2))];

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

// .m3u8 은 hls.js 로 재생 (사파리는 기본 지원)
const HLS_JS = 'https://cdnjs.cloudflare.com/ajax/libs/hls.js/1.5.20/hls.min.js';
let hls = null;
function loadVideo(song) {
  return new Promise((resolve, reject) => {
    if (video.dataset.src === song.url && video.readyState >= 1) return resolve();
    const fail = () => { video.dataset.src = ''; reject(new Error('영상을 불러올 수 없습니다: ' + song.title)); };
    video.dataset.src = song.url;
    if (hls) { hls.destroy(); hls = null; }
    video.onloadedmetadata = resolve;
    video.onerror = fail;
    if (!song.url.includes('.m3u8') || video.canPlayType('application/vnd.apple.mpegurl')) return (video.src = song.url);
    const attach = () => {
      if (!Hls.isSupported()) return fail();
      hls = new Hls();
      hls.on(Hls.Events.ERROR, (_, data) => data.fatal && fail());
      hls.loadSource(song.url);
      hls.attachMedia(video);
    };
    if (window.Hls) return attach();
    const script = document.createElement('script');
    script.src = HLS_JS; script.onload = attach; script.onerror = fail;
    document.head.appendChild(script);
  });
}

const fmt = (ms) => {
  const s = Math.max(0, Math.floor(ms / 1000));
  return Math.floor(s / 60) + ':' + String(s % 60).padStart(2, '0');
};
const esc = (s) => String(s).replace(/[&<>"']/g, (c) => `&#${c.charCodeAt(0)};`);
