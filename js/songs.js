// DMAP-Plus db.js 파서. row: [title, artist, start, end, suburl, musicId]
// 문자열이 글자마다 +1 인코딩된 파일도 있음
const DB_FILES = ['DB/db.js'];
const STREAM_URL = (suburl) => `https://media.dema.mil.kr/mediavod/_definst_/smil:dematv/${suburl}/playlist.m3u8`;
const SONGS = [{ id: 'demo', title: '데모 메트로놈', artist: 'DMAPmania', bpm: 120, url: 'demo.mp4' }];
const DB_ROW = /\[\s*(['"])((?:\\.|.)*?)\1\s*,\s*(['"])((?:\\.|.)*?)\3\s*,\s*(-?[\d.]+)\s*,\s*(-?[\d.]+)\s*,\s*(['"])((?:\\.|.)*?)\7\s*,\s*(\d+)\s*\]/g;

function parseDbJs(text) {
  const live = text.replace(/\/\*[\s\S]*?\*\//g, '').replace(/^\s*\/\/.*$/gm, '');
  const encoded = /charCodeAt\(\)\s*-\s*1/.test(live);
  const dec = (s) => (encoded ? [...s].map((c) => String.fromCharCode(c.charCodeAt(0) - 1)).join('') : s);
  return [...live.matchAll(DB_ROW)].map((m) => {
    const title = dec(m[2]);
    return {
      id: 'dmap:' + m[9],
      title: title.replace(/^\[new\]\s*/i, ''),
      isNew: /^\[new\]/i.test(title),
      artist: dec(m[4]),
      start: Number(m[5]),
      end: Number(m[6]),
      url: STREAM_URL(dec(m[8])),
    };
  });
}

// 같은 id 는 먼저 나온 것만 남김
function mergeSongs(...lists) {
  const seen = new Set();
  return lists.flat().filter((s) => !seen.has(s.id) && seen.add(s.id));
}

async function loadSongs() {
  const fromFiles = await Promise.all(DB_FILES.map((path) =>
    fetch(path).then((res) => (res.ok ? res.text() : '')).then(parseDbJs).catch(() => [])));
  return mergeSongs(SONGS, ...fromFiles, store.get('dbSongs', []));
}

async function importDbFiles(files) {
  const lists = await Promise.all([...files].map(async (f) => parseDbJs(await f.text())));
  const saved = mergeSongs(store.get('dbSongs', []), ...lists);
  store.set('dbSongs', saved);
  return { added: lists.flat().length, saved };
}

// 초성 검색: "ㅇㅇㅈㅇ" → "아이즈원"
const CHO = 'ㄱㄲㄴㄷㄸㄹㅁㅂㅃㅅㅆㅇㅈㅉㅊㅋㅌㅍㅎ';
const chosung = (s) => [...s].map((c) => {
  const k = c.charCodeAt(0) - 0xac00;
  return k >= 0 && k < 11172 ? CHO[Math.floor(k / 588)] : c;
}).join('');
