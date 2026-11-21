const $ = (s) => document.querySelector(s);
const video = $('#video');

function show(id) {
  document.querySelectorAll('.screen').forEach((s) => s.classList.toggle('active', s.id === id));
  document.body.classList.toggle('bg-video', id === 'play' && settings.bgVideo);
}

function toast(msg) {
  const t = $('#toast');
  t.textContent = msg;
  t.classList.add('show');
  clearTimeout(toast.timer);
  toast.timer = setTimeout(() => t.classList.remove('show'), 2000);
}

const store = {
  get(k) { try { return localStorage.getItem(k); } catch { return null; } },
  set(k, v) { try { localStorage.setItem(k, v); } catch {} },
};

// settings
// e.code 기준 (한글 IME 대응)
const DEFAULT_BINDS = {
  4: ['KeyD', 'KeyF', 'KeyJ', 'KeyK'],
  5: ['KeyD', 'KeyF', 'Space', 'KeyJ', 'KeyK'],
  6: ['KeyS', 'KeyD', 'KeyF', 'KeyJ', 'KeyK', 'KeyL'],
  7: ['KeyS', 'KeyD', 'KeyF', 'Space', 'KeyJ', 'KeyK', 'KeyL'],
};
const settings = Object.assign(
  { speed: 1, offset: 0, volume: 0.8, bgVideo: true, keyCount: 4, binds: structuredClone(DEFAULT_BINDS) },
  JSON.parse(store.get('settings') || '{}')
);
function saveSettings() {
  store.set('settings', JSON.stringify(settings));
  video.volume = settings.volume;
}
const keyLabel = (code) => code.replace(/^Key|^Digit/, '').replace('Semicolon', ';').replace('Space', '␣');

function laneColor(i, k) {
  if (k % 2 && i === (k - 1) / 2) return '#ffd36b';
  return Math.min(i, k - 1 - i) % 2 ? '#5ec8ff' : '#eeeeee';
}

// chart
// notes: { t: ms, l: lane, d: hold ms }
function loadChart(song) {
  const saved = store.get('chart:' + song.id);
  if (saved) return Object.assign({ keys: 4 }, JSON.parse(saved));
  return { keys: settings.keyCount, bpm: song.bpm || 120, offset: song.offset || 0, notes: [] };
}
function saveChart(song, chart) {
  chart.notes.sort((a, b) => a.t - b.t);
  store.set('chart:' + song.id, JSON.stringify(chart));
}

// 채보 없으면 대충 자동 생성
function autoChart(chart, durationMs) {
  const beat = 60000 / chart.bpm, k = chart.keys;
  const notes = [];
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
const segLength = (song) => (song.end ? (song.end - (song.start || 0)) * 1000 : (video.duration || 0) * 1000);
const seekSong = (song, ms) => (video.currentTime = (segStart(song) + ms) / 1000);
const songTime = (song) => video.currentTime * 1000 - segStart(song);

// video
const HLS_JS = 'https://cdnjs.cloudflare.com/ajax/libs/hls.js/1.5.20/hls.min.js';
let hls = null;
function loadScript(src) {
  return new Promise((ok, fail) => {
    if (document.querySelector(`script[src="${src}"]`)) return ok();
    const s = document.createElement('script');
    s.src = src; s.onload = ok; s.onerror = fail;
    document.head.appendChild(s);
  });
}
function loadVideo(song) {
  const url = song.url;
  return new Promise(async (resolve, reject) => {
    if (video.dataset.src === url && video.readyState >= 1) return resolve();
    const fail = () => reject(new Error('영상을 불러올 수 없습니다: ' + song.title));
    video.dataset.src = url;
    if (hls) { hls.destroy(); hls = null; }
    video.onloadedmetadata = () => resolve();
    video.onerror = fail;
    if (/\.m3u8/.test(url) && !video.canPlayType('application/vnd.apple.mpegurl')) {
      try { await loadScript(HLS_JS); } catch { return fail(); }
      if (!window.Hls || !Hls.isSupported()) return fail();
      hls = new Hls();
      hls.on(Hls.Events.ERROR, (_, d) => { if (d.fatal) { video.dataset.src = ''; fail(); } });
      hls.loadSource(url);
      hls.attachMedia(video);
    } else {
      video.src = url;
    }
  });
}

const fmt = (ms) => {
  const s = Math.max(0, Math.floor(ms / 1000));
  return Math.floor(s / 60) + ':' + String(s % 60).padStart(2, '0');
};
