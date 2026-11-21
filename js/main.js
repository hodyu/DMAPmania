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

// settings screen
const Settings = {
  mode: 4,
  waiting: -1,

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

  capture(e) {
    if (this.waiting < 0) return false;
    e.preventDefault();
    if (e.code !== 'Escape') {
      const b = settings.binds[this.mode];
      const dup = b.indexOf(e.code);
      if (dup >= 0) b[dup] = b[this.waiting];
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

window.addEventListener('keydown', (e) => {
  const id = current();
  if (id === 'settings' && Settings.capture(e)) return;
  if (id === 'play') Game.onKey(e, true);
  if (id === 'editor') Editor.onKey(e);
  if (id === 'menu') {
    const go = { KeyP: 'play', KeyE: 'edit', KeyS: 'settings' }[e.code];
    if (go) document.querySelector(`[data-go="${go}"]`).click();
  }
  const typing = e.target.tagName === 'INPUT' && /ArrowLeft|ArrowRight/.test(e.code);
  if (id === 'select' && !typing) {
    if (e.key === 'Enter') Select.start();
    else if (e.code === 'ArrowDown') { e.preventDefault(); Select.move(1); }
    else if (e.code === 'ArrowUp') { e.preventDefault(); Select.move(-1); }
    else if (e.code === 'ArrowRight') { e.preventDefault(); Select.moveDiff(1); }
    else if (e.code === 'ArrowLeft') { e.preventDefault(); Select.moveDiff(-1); }
    else if (e.code === 'Escape') document.querySelector('#select [data-back]').click();
  }
});
window.addEventListener('keyup', (e) => {
  if (current() === 'play') Game.onKey(e, false);
});

saveSettings();
show('menu');
