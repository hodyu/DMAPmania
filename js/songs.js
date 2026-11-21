// DMAP-Plus db.js 파서
// row: [title, artist, start, end, suburl, musicId]
// 문자열이 +1 인코딩된 경우가 있음

const DB_FILES = [
  'DB/db.js',
  // 'DB/db2.js',
];

const STREAM_URL = (suburl) => `https://media.dema.mil.kr/mediavod/_definst_/smil:dematv/${suburl}/playlist.m3u8`;

const SONGS = [
  { id: 'demo', title: '데모 메트로놈', artist: 'DMAPmania', bpm: 120, url: 'demo.mp4' },
  { id: 'sample-5s', title: '샘플 영상 (5초)', artist: 'samplelib.com', bpm: 120, url: 'https://samplelib.com/mp4/sample-5s.mp4' },
];

function parseDbJs(text) {
  const live = text.replace(/\/\*[\s\S]*?\*\//g, '').replace(/^\s*\/\/.*$/gm, '');
  const encoded = /charCodeAt\(\)\s*-\s*1/.test(live);
  const dec = (s) => (encoded ? [...s].map((c) => String.fromCharCode(c.charCodeAt(0) - 1)).join('') : s);
  const str = `(['"])((?:\\\\.|(?!\\1).)*)\\1`; // '...' 또는 "..."
  const num = `(-?[\\d.]+)`;
  const row = new RegExp(`\\[\\s*${str}\\s*,\\s*${str.replace(/1/g, '3')}\\s*,\\s*${num}\\s*,\\s*${num}\\s*,\\s*${str.replace(/1/g, '7')}\\s*,\\s*(\\d+)\\s*\\]`, 'g');
  const songs = [];
  for (const m of live.matchAll(row)) {
    const rawTitle = dec(m[2]);
    songs.push({
      id: 'dmap:' + m[9],
      musicId: Number(m[9]),
      title: rawTitle.replace(/^\[(New|NEW)\]\s*/, ''),
      isNew: /^\[(New|NEW)\]/.test(rawTitle),
      artist: dec(m[4]),
      start: Number(m[5]),
      end: Number(m[6]),
      url: STREAM_URL(dec(m[8])),
    });
  }
  return songs;
}

function mergeSongs(...lists) {
  const seen = new Set();
  return lists.flat().filter((s) => !seen.has(s.id) && seen.add(s.id));
}

async function loadSongs() {
  const fromFiles = await Promise.all(DB_FILES.map(async (path) => {
    try {
      const res = await fetch(path);
      return res.ok ? parseDbJs(await res.text()) : [];
    } catch {
      return [];
    }
  }));
  let saved = [];
  try { saved = JSON.parse(store.get('dbSongs') || '[]'); } catch {}
  return mergeSongs(SONGS, ...fromFiles, saved);
}

async function importDbFiles(files) {
  const lists = await Promise.all([...files].map(async (f) => parseDbJs(await f.text())));
  let saved = [];
  try { saved = JSON.parse(store.get('dbSongs') || '[]'); } catch {}
  saved = mergeSongs(saved, ...lists);
  store.set('dbSongs', JSON.stringify(saved));
  return { added: lists.flat().length, saved };
}

const CHO = 'ㄱㄲㄴㄷㄸㄹㅁㅂㅃㅅㅆㅇㅈㅉㅊㅋㅌㅍㅎ';
const chosung = (s) => [...s].map((c) => {
  const k = c.charCodeAt(0) - 0xac00;
  return k >= 0 && k < 11172 ? CHO[Math.floor(k / 588)] : c;
}).join('');
