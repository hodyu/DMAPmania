// ===== 곡 데이터베이스 =====
// DMAP-Plus 의 db.js 파일을 그대로 읽어서 곡 목록을 만듭니다.
//
// db.js 한 줄 형식: [제목, 가수, 시작(초), 끝(초), suburl, musicId]
// - 국방홍보원 영상 하나에 여러 곡이 들어 있어서, 시작~끝 구간이 곡 하나입니다.
// - 제목·가수·suburl 은 검색 방지용으로 글자마다 +1 되어 있을 수 있어서, 파일에 복호화 코드가 있으면 -1 해서 읽습니다.
// - 여러 db.js 에 같은 musicId 가 있으면 먼저 읽은 것을 씁니다.

// 서버에 함께 올린 db.js 경로들 (여러 개 가능)
const DB_FILES = [
  'DB/db.js',
  // 'DB/db2.js',
];

// suburl → 실제 스트림 주소 (DMAP-Plus 의 VideoPlayer.js 와 같은 주소)
const STREAM_URL = (suburl) => `https://media.dema.mil.kr/mediavod/_definst_/smil:dematv/${suburl}/playlist.m3u8`;

// 기본 곡 (db.js 없이도 바로 해볼 수 있게)
const SONGS = [
  { id: 'demo', title: '데모 메트로놈', artist: 'BEATLINE', bpm: 120, url: 'demo.mp4' },
  { id: 'sample-5s', title: '샘플 영상 (5초)', artist: 'samplelib.com', bpm: 120, url: 'https://samplelib.com/mp4/sample-5s.mp4' },
];

// db.js 텍스트 → 곡 배열 (코드를 실행하지 않고 글자만 읽음)
function parseDbJs(text) {
  const live = text.replace(/\/\*[\s\S]*?\*\//g, '').replace(/^\s*\/\/.*$/gm, ''); // 주석 제거
  const encoded = /charCodeAt\(\)\s*-\s*1/.test(live); // 복호화 코드가 살아 있으면 암호화된 파일
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

// 여러 목록을 합치고 같은 musicId 는 하나만 남김
function mergeSongs(...lists) {
  const seen = new Set();
  return lists.flat().filter((s) => !seen.has(s.id) && seen.add(s.id));
}

// 시작할 때: 기본 곡 + 서버의 db.js 들 + 전에 불러온 db.js 들
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

// 컴퓨터에 있는 db.js 파일들을 골라서 추가 (여러 개 한 번에)
async function importDbFiles(files) {
  const lists = await Promise.all([...files].map(async (f) => parseDbJs(await f.text())));
  let saved = [];
  try { saved = JSON.parse(store.get('dbSongs') || '[]'); } catch {}
  saved = mergeSongs(saved, ...lists);
  store.set('dbSongs', JSON.stringify(saved));
  return { added: lists.flat().length, saved };
}

// 초성 검색용: "ㅇㅇㅈ" 로 "아이즈원" 찾기
const CHO = 'ㄱㄲㄴㄷㄸㄹㅁㅂㅃㅅㅆㅇㅈㅉㅊㅋㅌㅍㅎ';
const chosung = (s) => [...s].map((c) => {
  const k = c.charCodeAt(0) - 0xac00;
  return k >= 0 && k < 11172 ? CHO[Math.floor(k / 588)] : c;
}).join('');
