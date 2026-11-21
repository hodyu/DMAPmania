// 곡 DB: DMAP-Plus 의 DB/db.js 를 그대로 사용 (github.com/wei756/DMAP-Plus)
// 한 줄 형식: [title, singer, startTime(초), endTime(초), suburl, id]
// index.html 에서 <script src="DB/db.js"> 로 먼저 읽으면 전역 db 에 복호화된 배열이 들어 있음
const STREAM_URL = (suburl) => `https://media.dema.mil.kr/mediavod/_definst_/smil:dematv/${suburl}/playlist.m3u8`;
const SONGS = []; // 기본 곡 없음: DB/db.js 의 곡만 사용

// id 는 채보/랭킹 저장 키로 씀 (곡 순서가 바뀌어도 그대로)
function rowToSong([title, singer, startTime, endTime, suburl, id]) {
  return {
    id: 'dmap:' + id,
    title: title.replace(/^\[new\]\s*/i, ''),
    isNew: /^\[new\]/i.test(title),
    artist: singer,
    start: Number(startTime),
    end: Number(endTime),
    url: STREAM_URL(suburl),
  };
}

// 설정에서 db.js 파일을 추가로 불러올 때: 코드를 실행하지 않고 글자만 읽음
// 복호화 코드(charCodeAt() - 1)가 살아 있으면 글자마다 -1
const DB_ROW = /\[\s*(['"])((?:\\.|.)*?)\1\s*,\s*(['"])((?:\\.|.)*?)\3\s*,\s*(-?[\d.]+)\s*,\s*(-?[\d.]+)\s*,\s*(['"])((?:\\.|.)*?)\7\s*,\s*(\d+)\s*\]/g;
function parseDbJs(text) {
  const live = text.replace(/\/\*[\s\S]*?\*\//g, '').replace(/^\s*\/\/.*$/gm, '');
  const encoded = /charCodeAt\(\)\s*-\s*1/.test(live);
  const dec = (s) => (encoded ? [...s].map((c) => String.fromCharCode(c.charCodeAt(0) - 1)).join('') : s);
  return [...live.matchAll(DB_ROW)].map((m) => rowToSong([dec(m[2]), dec(m[4]), m[5], m[6], dec(m[8]), m[9]]));
}

// 같은 id 는 먼저 나온 것만 남김
function mergeSongs(...lists) {
  const seen = new Set();
  return lists.flat().filter((s) => !seen.has(s.id) && seen.add(s.id));
}

function loadSongs() {
  const fromDb = typeof db === 'undefined' ? [] : db.map(rowToSong); // DB/db.js 가 없으면 빈 목록
  return mergeSongs(SONGS, fromDb, store.get('dbSongs', []));
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
