const esc = (s) => String(s).replace(/[&<>"']/g, (c) => `&#${c.charCodeAt(0)};`);
const Select = {
  songs: [],
  current: null,
  mode: 'play', // 'play' | 'edit'

  async open(mode) {
    this.mode = mode;
    $('#startBtn').textContent = mode === 'play' ? '시작' : '편집하기';
    if (!this.songs.length) this.songs = await loadSongs();
    show('select');
    this.render();
    if (this.current) this.pick(this.current);
  },

  // 초성 검색 지원, 200곡까지만 렌더
  render() {
    const q = $('#search').value.trim().toLowerCase();
    const hits = this.songs.filter((s) => {
      if (!q) return true;
      const text = (s.title + ' ' + (s.artist || '')).toLowerCase();
      return text.includes(q) || chosung(text).includes(q);
    });
    const list = $('#songList');
    list.innerHTML = '';
    for (const s of hits.slice(0, 200)) {
      const li = document.createElement('li');
      li.innerHTML = `${s.isNew ? '<em>NEW</em> ' : ''}${esc(s.title)}<small>${esc(s.artist || '')}${s.end ? ' · ' + fmt(segLength(s)) : ''}</small>`;
      li.classList.toggle('sel', s === this.current);
      li.onclick = () => this.pick(s);
      list.appendChild(li);
    }
    $('#songCount').textContent = hits.length > 200 ? `${hits.length}곡 중 200곡 표시 · 검색으로 좁혀 보세요` : `${hits.length}곡`;
  },

  async pick(song) {
    this.current = song;
    this.render();
    const chart = loadChart(song);
    $('#selTitle').textContent = song.title;
    $('#selInfo').textContent = `${song.artist || ''} · ${chart.keys}K · BPM ${chart.bpm} · 노트 ${chart.notes.length || '자동'}`;
    try {
      await loadVideo(song);
      const r = $('#preview').getBoundingClientRect();
      Object.assign(video.style, { left: r.left + 'px', top: r.top + 'px', width: r.width + 'px', height: r.height + 'px', opacity: 1, zIndex: 1 });
      seekSong(song, segLength(song) * 0.3);
      video.play();
    } catch (e) {
      $('#selInfo').textContent = e.message;
    }
  },

  hidePreview() {
    video.pause();
    video.removeAttribute('style');
  },

  start() {
    if (!this.current) return toast('곡을 선택하세요');
    video.play().catch(() => {});
    this.hidePreview();
    if (this.mode === 'play') Game.start(this.current);
    else Editor.open(this.current);
  },
};

$('#search').oninput = () => Select.render();
$('#startBtn').onclick = () => Select.start();
$('#dbFiles').onchange = async (e) => {
  if (!e.target.files.length) return;
  const { added, saved } = await importDbFiles(e.target.files);
  Select.songs = mergeSongs(Select.songs, saved);
  Select.render();
  toast(added ? `db.js에서 ${added}곡을 읽었습니다` : '곡을 찾지 못했습니다. db.js 형식인지 확인하세요');
  e.target.value = '';
};
$('#localFile').onchange = (e) => {
  const f = e.target.files[0];
  if (!f) return;
  const song = { id: 'local:' + f.name, title: f.name.replace(/\.mp4$/i, ''), artist: '로컬 파일', bpm: 120, url: URL.createObjectURL(f) };
  Select.songs.push(song);
  Select.pick(song);
};
