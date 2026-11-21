const esc = (s) => String(s).replace(/[&<>"']/g, (c) => `&#${c.charCodeAt(0)};`);
const Select = {
  songs: [],
  current: null,
  charts: [],
  diff: 0,
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
    this.hits = hits.slice(0, 200);
    const list = $('#songList');
    list.innerHTML = '';
    for (const s of hits.slice(0, 200)) {
      const li = document.createElement('li');
      const pips = (s === this.current ? this.charts : loadCharts(s))
        .map((c) => `<i style="--c:${levelColor(c.level)}"></i>`).join('');
      li.innerHTML = `<b>${s.isNew ? '<em>NEW</em>' : ''}${esc(s.title)}</b>
        <small>${esc(s.artist || '')}${s.end ? ' · ' + fmt(segLength(s)) : ''}</small>
        <span class="pips">${pips}</span>`;
      li.classList.toggle('sel', s === this.current);
      li.onclick = () => this.pick(s);
      list.appendChild(li);
    }
    $('#songCount').textContent = hits.length > 200 ? `${hits.length}곡 중 200곡 표시 · 검색으로 좁혀 보세요` : `${hits.length}곡`;
  },

  async pick(song) {
    if (song !== this.current) this.diff = 0;
    this.current = song;
    this.charts = loadCharts(song);
    this.diff = Math.min(this.diff, this.charts.length - 1);
    this.render();
    this.renderDiffs();
    $('#selTitle').textContent = song.title;
    $('#selArtist').textContent = song.artist || '';
    $('#songList li.sel')?.scrollIntoView({ block: 'nearest' });
    try {
      await loadVideo(song);
      if (this.current !== song) return;
      seekSong(song, segLength(song) * 0.3);
      video.play().catch(() => {});
      this.renderDiffs();
    } catch (e) {
      toast(e.message);
    }
  },

  renderDiffs() {
    const chart = this.charts[this.diff];
    $('#diffList').innerHTML = this.charts.map((c, i) =>
      `<button data-d="${i}" class="diff-row${i === this.diff ? ' on' : ''}" style="--c:${levelColor(c.level)}">
        <span class="lv">${c.level}</span><span class="dn">${esc(c.name)}</span><span class="dk">${c.keys}K</span>
      </button>`).join('');
    const len = segLength(this.current);
    const stat = (k, v) => `<div><small>${k}</small><b>${v}</b></div>`;
    $('#selStats').innerHTML = stat('길이', len ? fmt(len) : '-') + stat('BPM', chart.bpm) +
      stat('노트', chart.notes.length || '자동') + stat('키', chart.keys + 'K');
  },

  move(d) {
    const h = this.hits || [];
    if (!h.length) return;
    const i = h.indexOf(this.current);
    this.pick(h[(i < 0 ? 0 : i + d + h.length) % h.length]);
  },
  moveDiff(d) {
    if (!this.current) return;
    this.diff = Math.max(0, Math.min(this.charts.length - 1, this.diff + d));
    this.renderDiffs();
  },

  hidePreview() {
    video.pause();
  },

  start() {
    if (!this.current) return toast('곡을 선택하세요');
    video.play().catch(() => {});
    this.hidePreview();
    if (this.mode === 'play') Game.start(this.current, { chart: this.charts[this.diff] });
    else Editor.open(this.current, this.diff);
  },
};

$('#diffList').onclick = (e) => {
  const d = e.target.closest('[data-d]')?.dataset.d;
  if (d === undefined) return;
  Select.diff = Number(d);
  Select.renderDiffs();
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
