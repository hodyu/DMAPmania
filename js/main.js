const current = () => $('.screen.active')?.id;

document.querySelectorAll('[data-go]').forEach((b) => (b.onclick = () => {
  if (b.dataset.go === 'settings') Settings.open();
  else Select.open(b.dataset.go);
}));

function goBack() {
  const id = current();
  if (id === 'select') { video.pause(); show('menu'); }
  if (id === 'editor') { Editor.close(); Select.open('edit'); }
  if (id === 'settings') { Settings.save(); show('menu'); }
}
document.querySelectorAll('[data-back]').forEach((b) => (b.onclick = goBack));

const Settings = {
  mode: 4,
  waiting: -1, // 키 입력을 기다리는 칸

  open() {
    this.mode = settings.keyCount;
    $('#setSpeed').value = $('#speedVal').textContent = settings.speed;
    $('#setOffset').value = settings.offset;
    $('#setVolume').value = settings.volume;
    $('#setBg').checked = settings.bgVideo;
    $('#dbCount').textContent = `저장된 곡 ${store.get('dbSongs', []).length}개`;
    this.render();
    show('settings');
  },

  render() {
    $('#keyModes').innerHTML = [4, 5, 6, 7].map((k) => `<button class="${k === this.mode ? 'on' : ''}" data-k="${k}">${k}K</button>`).join('');
    $('#keySlots').innerHTML = settings.binds[this.mode].map((code, i) =>
      `<button style="--c:${laneColor(i, this.mode)}" class="${i === this.waiting ? 'wait' : ''}" data-i="${i}">${i === this.waiting ? '?' : keyLabel(code)}</button>`).join('');
  },

  capture(e) {
    if (this.waiting < 0) return false;
    e.preventDefault();
    const b = settings.binds[this.mode], dup = b.indexOf(e.code);
    if (e.code !== 'Escape') {
      if (dup >= 0) b[dup] = b[this.waiting]; // 이미 쓰는 키면 자리 바꿈
      b[this.waiting] = e.code;
    }
    this.waiting = -1;
    this.render();
    return true;
  },

  save() {
    settings.keyCount = this.mode;
    settings.speed = Number($('#setSpeed').value);
    settings.offset = Number($('#setOffset').value) || 0;
    settings.volume = Number($('#setVolume').value);
    settings.bgVideo = $('#setBg').checked;
    saveSettings();
  },
};

$('#keyModes').onclick = (e) => {
  if (e.target.dataset.k) { Settings.mode = Number(e.target.dataset.k); Settings.waiting = -1; Settings.render(); }
};
$('#keySlots').onclick = (e) => {
  if (e.target.dataset.i) { Settings.waiting = Number(e.target.dataset.i); Settings.render(); }
};
$('#resetKeys').onclick = () => {
  settings.binds[Settings.mode] = [...DEFAULT_BINDS[Settings.mode]];
  Settings.render();
};
$('#dbFiles').onchange = async (e) => {
  if (!e.target.files.length) return;
  const { added, saved } = await importDbFiles(e.target.files);
  if (Select.songs.length) Select.songs = mergeSongs(Select.songs, saved);
  $('#dbCount').textContent = `저장된 곡 ${saved.length}개`;
  toast(added ? `db.js에서 ${added}곡을 읽었습니다` : '곡을 찾지 못했습니다');
  e.target.value = '';
};
$('#setSpeed').oninput = (e) => ($('#speedVal').textContent = e.target.value);

const SELECT_KEYS = {
  ArrowDown: () => Select.move(1),
  ArrowUp: () => Select.move(-1),
  ArrowRight: () => Select.moveDiff(1),
  ArrowLeft: () => Select.moveDiff(-1),
  Enter: () => Select.start(),
  Escape: goBack,
};
window.addEventListener('keydown', (e) => {
  const id = current();
  if (id === 'settings' && Settings.capture(e)) return;
  if (id === 'play') Game.onKey(e, true);
  if (id === 'editor') Editor.onKey(e);
  if (id === 'menu') $(`[data-key="${e.code}"]`)?.click();
  const action = SELECT_KEYS[e.code];
  const typing = e.target.tagName === 'INPUT' && /Left|Right/.test(e.code); // 검색창 커서 이동은 그대로
  if (id === 'select' && action && !typing) { e.preventDefault(); action(); }
});
window.addEventListener('keyup', (e) => current() === 'play' && Game.onKey(e, false));

saveSettings();
show('menu');
