const Select = {
  songs: [],
  hits: [],
  current: null,
  charts: [],
  diff: 0,
  mode: 'play', // 'play' | 'edit'

  // play: 채보(노트)가 있는 곡과 난이도만 / edit: DB 전체 곡
  async open(mode) {
    await chartsReady;
    this.mode = mode;
    $('#startBtn').textContent = mode === 'play' ? '시작' : '채보 만들기';
    if (!this.songs.length) this.songs = loadSongs();
    show('select');
    if (this.list().includes(this.current)) return this.pick(this.current);
    this.current = null;
    this.render();
    $('#selTitle').textContent = mode === 'play' ? '곡을 선택하세요' : '채보를 만들 곡을 선택하세요';
    $('#selArtist').textContent = $('#selDiff').innerHTML = $('#selStats').innerHTML = $('#ranking').innerHTML = '';
  },

  chartsOf(song) {
    const charts = loadCharts(song);
    return this.mode === 'play' ? charts.filter((c) => c.notes.length) : charts;
  },
  list() {
    return this.mode === 'play' ? this.songs.filter((s) => this.chartsOf(s).length) : this.songs;
  },

  // 곡 목록. 선택한 곡 아래에 난이도가 펼쳐짐 (제목/아티스트/초성 검색, 200곡까지)
  render() {
    const q = $('#search').value.trim().toLowerCase();
    const all = this.list().filter((s) => {
      const text = (s.title + ' ' + (s.artist || '')).toLowerCase();
      return text.includes(q) || chosung(text).includes(q);
    });
    this.hits = all.slice(0, 200);
    $('#songList').innerHTML = this.hits.map((s, i) => {
      const open = s === this.current;
      const charts = open ? this.charts : this.chartsOf(s);
      const pips = charts.map((c) => `<i style="--c:${starColor(chartStars(c))}"></i>`).join('');
      const diffs = open ? charts.map((c, d) => {
        const stars = chartStars(c);
        return `<li class="diff ${d === this.diff ? 'on' : ''}" data-d="${d}" style="--c:${starColor(stars)}">
          <span class="star">${starText(c)}</span><b>${esc(c.name)}</b><small>${c.keys}K</small></li>`;
      }).join('') : '';
      return `<li class="song ${open ? 'sel' : ''}" data-i="${i}">
        <b>${s.isNew ? '<em>NEW</em>' : ''}${esc(s.title)}</b>
        <small>${esc(s.artist || '')}${s.end ? ' · ' + fmt(segLength(s)) : ''}</small>
        <span class="pips">${pips}</span></li>${diffs}`;
    }).join('') || `<li class="empty">${this.mode === 'play' && !q
      ? '채보가 있는 곡이 없습니다.<br>메인 화면의 \'DB에서 곡 추가\'에서 채보를 만들어 보세요.' : '검색 결과가 없습니다'}</li>`;
    $('#songCount').textContent = all.length > 200 ? `${all.length}곡 중 200곡 표시` : `${all.length}곡`;
  },

  async pick(song) {
    if (song !== this.current) this.diff = 0;
    this.current = song;
    this.charts = this.chartsOf(song);
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
      <b>${esc(chart.name)}</b>`;
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
    else Editor.open(this.current, this.charts[this.diff].id);
  },
};

$('#songList').onclick = (e) => {
  const li = e.target.closest('li');
  if (!li || li.classList.contains('empty')) return;
  if (li.dataset.d) Select.selectDiff(Number(li.dataset.d));
  else if (Select.hits[li.dataset.i] !== Select.current) Select.pick(Select.hits[li.dataset.i]);
};
$('#search').oninput = () => Select.render();
$('#startBtn').onclick = () => Select.start();

// 곡 우클릭(폰은 길게 누르기): 난이도 추가 / 에디터에서 열기
$('#songList').oncontextmenu = (e) => {
  const li = e.target.closest('li.song, li.diff');
  if (!li) return;
  e.preventDefault();
  if (li.dataset.i && Select.hits[li.dataset.i] !== Select.current) Select.pick(Select.hits[li.dataset.i]);
  if (li.dataset.d) { Select.diff = Number(li.dataset.d); Select.render(); Select.renderInfo(); }
  const menu = $('#ctxMenu');
  menu.style.left = Math.min(e.clientX, innerWidth - 190) + 'px';
  menu.style.top = Math.min(e.clientY, innerHeight - 100) + 'px';
  menu.classList.remove('hidden');
};
$('#ctxMenu').onclick = (e) => {
  const act = e.target.dataset.act;
  $('#ctxMenu').classList.add('hidden');
  if (!act || !Select.current) return;
  video.pause();
  Editor.open(Select.current, Select.charts[Select.diff]?.id);
  if (act === 'add') Editor.addDiff();
};
window.addEventListener('pointerdown', (e) => {
  if (!e.target.closest('#ctxMenu')) $('#ctxMenu').classList.add('hidden');
});
