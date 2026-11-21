// 시작: 메뉴 버튼, 뒤로 가기, 설정, 키보드 연결
const current = () => document.querySelector('.screen.active')?.id;

document.querySelectorAll('[data-go]').forEach((b) => (b.onclick = () => {
  const go = b.dataset.go;
  if (go === 'settings') Settings.open();
  else Select.open(go); // 'play' | 'edit'
}));

document.querySelectorAll('[data-back]').forEach((b) => (b.onclick = () => {
  const id = current();
  if (id === 'select') { Select.hidePreview(); show('menu'); }
  if (id === 'editor') { Editor.close(); Select.open('edit'); }
  if (id === 'settings') { Settings.save(); show('menu'); }
}));

// ---- 설정 화면: 4~7키 모드, 키마다 따로 지정 ----
const Settings = {
  mode: 4,
  waiting: -1, // 키 입력을 기다리는 칸 번호

  open() {
    this.mode = settings.keyCount;
    $('#setSpeed').value = settings.speed;
    $('#setOffset').value = settings.offset;
    $('#setVolume').value = settings.volume;
    $('#setBg').checked = settings.bgVideo;
    $('#speedVal').textContent = settings.speed;
    this.render();
    show('settings');
  },

  render() {
    $('#keyModes').innerHTML = [4, 5, 6, 7].map((k) => `<button class="${k === this.mode ? 'on' : ''}" data-k="${k}">${k}K</button>`).join('');
    $('#keySlots').innerHTML = settings.binds[this.mode].map((code, i) =>
      `<button style="--c:${laneColor(i, this.mode)}" class="${i === this.waiting ? 'wait' : ''}" data-i="${i}">${i === this.waiting ? '?' : keyLabel(code)}</button>`).join('');
  },

  // 키 입력을 가로챘으면 true
  capture(e) {
    if (this.waiting < 0) return false;
    e.preventDefault();
    if (e.code !== 'Escape') {
      const b = settings.binds[this.mode];
      const dup = b.indexOf(e.code);
      if (dup >= 0) b[dup] = b[this.waiting]; // 이미 쓰는 키면 서로 바꿈
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
  const k = e.target.dataset.k;
  if (k) { Settings.mode = Number(k); Settings.waiting = -1; Settings.render(); }
};
$('#keySlots').onclick = (e) => {
  const i = e.target.dataset.i;
  if (i !== undefined) { Settings.waiting = Number(i); Settings.render(); }
};
$('#resetKeys').onclick = () => {
  settings.binds[Settings.mode] = [...DEFAULT_BINDS[Settings.mode]];
  Settings.render();
};
$('#setSpeed').oninput = (e) => ($('#speedVal').textContent = e.target.value);

// ---- 키보드 ----
window.addEventListener('keydown', (e) => {
  const id = current();
  if (id === 'settings' && Settings.capture(e)) return;
  if (id === 'play') Game.onKey(e, true);
  if (id === 'editor') Editor.onKey(e);
  if (id === 'select' && e.key === 'Enter') Select.start();
});
window.addEventListener('keyup', (e) => {
  if (current() === 'play') Game.onKey(e, false);
});

saveSettings();
show('menu');
