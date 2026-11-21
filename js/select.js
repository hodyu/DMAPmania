const Select = {
  songs: [],
  hits: [],
  current: null,
  charts: [],
  diff: 0,
  mode: 'play', // 'play' | 'edit'

  async open(mode) {
    this.mode = mode;
    $('#startBtn').textContent = mode === 'play' ? '시작' : '편집하기';
    if (!this.songs.length) this.songs = await loadSongs();
    show('select');
    if (this.current) this.pick(this.current);
    else this.render();
  },

  // 제목/아티스트/초성 검색, 200곡까지만 그림
  render() {
    const q = $('#search').value.trim().toLowerCase();
    const all = this.songs.filter((s) => {
      const text = (s.title + ' ' + (s.artist || '')).toLowerCase();
      return text.includes(q) || chosung(text).includes(q);
    });
    this.hits = all.slice(0, 200);
    $('#songList').innerHTML = this.hits.map((s, i) => {
      const pips = loadCharts(s).map((c) => `<i style="--c:${levelColor(c.level)}"></i>`).join('');
      return `<li data-i="${i}" class="${s === this.current ? 'sel' : ''}">
        <b>${s.isNew ? '<em>NEW</em>' : ''}${esc(s.title)}</b>
        <small>${esc(s.artist || '')}${s.end ? ' · ' + fmt(segLength(s)) : ''}</small>
        <span class="pips">${pips}</span></li>`;
    }).join('');
    $('#songCount').textContent = all.length > 200 ? `${all.length}곡 중 200곡 표시` : `${all.length}곡`;
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
    $('#songList .sel')?.scrollIntoView({ block: 'nearest' });
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
    const chart = this.charts[this.diff], len = segLength(this.current);
    $('#diffList').innerHTML = this.charts.map((c, i) =>
      `<button data-d="${i}" class="diff-row ${i === this.diff ? 'on' : ''}" style="--c:${levelColor(c.level)}">
        <span class="lv">${c.level}</span><span class="dn">${esc(c.name)}</span><span class="dk">${c.keys}K</span></button>`).join('');
    const stat = (k, v) => `<div><small>${k}</small><b>${v}</b></div>`;
    $('#selStats').innerHTML = stat('길이', len ? fmt(len) : '-') + stat('BPM', chart.bpm) +
      stat('노트', chart.notes.length || '자동') + stat('키', chart.keys + 'K');
  },

  move(d) {
    const h = this.hits, i = h.indexOf(this.current);
    if (h.length) this.pick(h[i < 0 ? 0 : (i + d + h.length) % h.length]);
  },
  moveDiff(d) {
    if (!this.current) return;
    this.diff = Math.max(0, Math.min(this.charts.length - 1, this.diff + d));
    this.renderDiffs();
  },

  start() {
    if (!this.current) return toast('곡을 선택하세요');
    video.play().catch(() => {}); // iOS: 탭 안에서 한 번 재생해야 소리가 남
    video.pause();
    if (this.mode === 'play') Game.start(this.current, { chart: this.charts[this.diff] });
    else Editor.open(this.current, this.diff);
  },
};

$('#songList').onclick = (e) => {
  const li = e.target.closest('li');
  if (li) Select.pick(Select.hits[li.dataset.i]);
};
$('#diffList').onclick = (e) => {
  const b = e.target.closest('[data-d]');
  if (b) { Select.diff = Number(b.dataset.d); Select.renderDiffs(); }
};
$('#search').oninput = () => Select.render();
$('#startBtn').onclick = () => Select.start();
$('#dbFiles').onchange = async (e) => {
  if (!e.target.files.length) return;
  const { added, saved } = await importDbFiles(e.target.files);
  Select.songs = mergeSongs(Select.songs, saved);
  Select.render();
  toast(added ? `db.js에서 ${added}곡을 읽었습니다` : '곡을 찾지 못했습니다');
  e.target.value = '';
};
$('#localFile').onchange = (e) => {
  const f = e.target.files[0];
  if (!f) return;
  const song = { id: 'local:' + f.name, title: f.name.replace(/\.mp4$/i, ''), artist: '로컬 파일', bpm: 120, url: URL.createObjectURL(f) };
  Select.songs.push(song);
  Select.pick(song);
};
