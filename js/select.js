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

  // 곡 목록. 선택한 곡 아래에 난이도가 펼쳐짐 (제목/아티스트/초성 검색, 200곡까지)
  render() {
    const q = $('#search').value.trim().toLowerCase();
    const all = this.songs.filter((s) => {
      const text = (s.title + ' ' + (s.artist || '')).toLowerCase();
      return text.includes(q) || chosung(text).includes(q);
    });
    this.hits = all.slice(0, 200);
    $('#songList').innerHTML = this.hits.map((s, i) => {
      const open = s === this.current;
      const charts = open ? this.charts : loadCharts(s);
      const pips = charts.map((c) => `<i style="--c:${starColor(chartStars(c))}"></i>`).join('');
      const diffs = open ? charts.map((c, d) => {
        const stars = chartStars(c);
        return `<li class="diff ${d === this.diff ? 'on' : ''}" data-d="${d}" style="--c:${starColor(stars)}">
          <span class="star">${starText(c)}</span><b>${esc(c.name)}</b><small>Lv.${c.level} · ${c.keys}K</small></li>`;
      }).join('') : '';
      return `<li class="song ${open ? 'sel' : ''}" data-i="${i}">
        <b>${s.isNew ? '<em>NEW</em>' : ''}${esc(s.title)}</b>
        <small>${esc(s.artist || '')}${s.end ? ' · ' + fmt(segLength(s)) : ''}</small>
        <span class="pips">${pips}</span></li>${diffs}`;
    }).join('');
    $('#songCount').textContent = all.length > 200 ? `${all.length}곡 중 200곡 표시` : `${all.length}곡`;
  },

  async pick(song) {
    if (song !== this.current) this.diff = 0;
    this.current = song;
    this.charts = loadCharts(song);
    this.diff = Math.min(this.diff, this.charts.length - 1);
    this.render();
    this.renderInfo();
    $('#songList .sel')?.scrollIntoView({ block: 'nearest' });
    try {
      await loadVideo(song);
      if (this.current !== song) return;
      seekSong(song, segLength(song) * 0.3);
      video.play().catch(() => {});
      this.renderInfo(); // 영상 길이를 알게 된 뒤 다시
    } catch (e) {
      toast(e.message);
    }
  },

  selectDiff(d) {
    if (d === this.diff) return this.start(); // 고른 난이도를 한 번 더 누르면 시작
    this.diff = d;
    this.render();
    this.renderInfo();
  },

  // 왼쪽: 곡 정보 + 선택한 난이도 + 랭킹
  renderInfo() {
    const song = this.current, chart = this.charts[this.diff], len = segLength(song);
    $('#selTitle').textContent = song.title;
    $('#selArtist').textContent = song.artist || '';
    $('#selDiff').innerHTML = `<span class="star" style="--c:${starColor(chartStars(chart))}">${starText(chart)}</span>
      <b>${esc(chart.name)}</b> <small>Lv.${chart.level}</small>`;
    const stat = (k, v) => `<div><small>${k}</small><b>${v}</b></div>`;
    $('#selStats').innerHTML = stat('길이', len ? fmt(len) : '-') + stat('BPM', chart.bpm) +
      stat('노트', chart.notes.length || '자동') + stat('키', chart.keys + 'K');
    const scores = loadScores(song, chart);
    $('#ranking').innerHTML = scores.length ? scores.map((r, i) => `<li>
      <span class="rank">${i + 1}</span><span class="grade">${r.grade}</span>
      <span class="rs">${r.score.toLocaleString()}</span>
      <small>${r.acc.toFixed(2)}%<br>${r.combo}x</small><time>${timeAgo(r.at)}</time></li>`).join('')
      : '<li class="empty">아직 기록이 없습니다</li>';
  },

  move(d) {
    const h = this.hits, i = h.indexOf(this.current);
    if (h.length) this.pick(h[i < 0 ? 0 : (i + d + h.length) % h.length]);
  },
  moveDiff(d) {
    if (!this.current) return;
    this.diff = Math.max(0, Math.min(this.charts.length - 1, this.diff + d));
    this.render();
    this.renderInfo();
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
  if (!li) return;
  if (li.dataset.d) Select.selectDiff(Number(li.dataset.d));
  else if (Select.hits[li.dataset.i] !== Select.current) Select.pick(Select.hits[li.dataset.i]);
};
$('#search').oninput = () => Select.render();
$('#startBtn').onclick = () => Select.start();
$('#localFile').onchange = (e) => {
  const f = e.target.files[0];
  if (!f) return;
  const song = { id: 'local:' + f.name, title: f.name.replace(/\.mp4$/i, ''), artist: '로컬 파일', bpm: 120, url: URL.createObjectURL(f) };
  Select.songs.push(song);
  Select.pick(song);
};
