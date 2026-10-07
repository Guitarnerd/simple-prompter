// Keyboard / Bluetooth remote mapping and the "Remote setup" panel.

const $ = id => document.getElementById(id);

// Covers the keys common Bluetooth prompter remotes send (keyboard, page-turner and media modes)
export const DEFAULTS = {
  toggle: [' ', 'Enter', 'MediaPlayPause', 'MediaPlay', 'MediaPause', 'k', 'p', 'b', '.'],
  faster: ['ArrowUp', 'AudioVolumeUp', 'ArrowRight'],
  slower: ['ArrowDown', 'AudioVolumeDown', 'ArrowLeft'],
  forward: ['PageDown', 'MediaTrackNext', 'MediaFastForward'],
  back: ['PageUp', 'MediaTrackPrevious', 'MediaRewind', 'Backspace'],
  bigger: ['+', '='],
  smaller: ['-', '_'],
  restart: ['r', 'R', 'Home', 'Escape'],
};

const clone = o => JSON.parse(JSON.stringify(o));
const nameOf = e => e.key === ' ' ? 'Space' : e.key && e.key !== 'Unidentified' ? e.key : (e.code || 'keyCode ' + e.keyCode);
const idOf = e => e.key && e.key !== 'Unidentified' ? e.key : (e.code || 'kc' + e.keyCode);

// actions: { id: { label, run } }. canRun() says whether the prompter is on screen and should take keys.
export function createRemote({ actions, canRun, saved, onSave }) {
  const panel = $('remote');
  const list = $('rpList');
  const map = Object.assign(clone(DEFAULTS), saved);
  let listening = null;

  function renderList() {
    list.replaceChildren(...Object.entries(actions).map(([id, action]) => {
      const row = document.createElement('div');
      row.className = 'rp-row' + (listening === id ? ' listening' : '');
      const label = document.createElement('span');
      label.textContent = action.label;
      const keys = document.createElement('span');
      keys.className = 'keys';
      keys.textContent = map[id].map(k => k === ' ' ? 'Space' : k).join(', ') || 'none';
      const btn = document.createElement('button');
      btn.type = 'button';
      btn.dataset.act = id;
      btn.textContent = listening === id ? 'Press remote…' : 'Assign';
      row.append(label, keys, btn);
      return row;
    }));
  }

  list.addEventListener('click', e => {
    const b = e.target.closest('button');
    if (!b) return;
    listening = listening === b.dataset.act ? null : b.dataset.act;
    b.blur();
    renderList();
  });
  $('rpClose').onclick = () => { panel.hidden = true; listening = null; };
  $('rpReset').onclick = e => {
    for (const id in DEFAULTS) map[id] = [...DEFAULTS[id]];
    onSave(map);
    listening = null;
    e.target.blur();
    renderList();
  };

  document.addEventListener('keydown', e => {
    const id = idOf(e);
    if (!panel.hidden) {
      $('lastKey').textContent = nameOf(e);
      if (listening) {
        e.preventDefault();
        for (const k in map) map[k] = map[k].filter(x => x !== id);   // one button, one job
        map[listening] = [id, ...map[listening]];
        listening = null;
        onSave(map);
        renderList();
      }
      return;
    }
    if (!canRun()) return;
    if (/^(INPUT|SELECT|TEXTAREA)$/.test(e.target.tagName) && id !== ' ' && id !== 'Enter') return;
    for (const k in map) {
      if (map[k].includes(id)) {
        e.preventDefault();
        if (!e.repeat || k === 'faster' || k === 'slower') actions[k].run();
        return;
      }
    }
  }, true);

  // Media-mode remotes: route play/pause/next/previous through the browser's media controls
  if ('mediaSession' in navigator) {
    try {
      const guard = fn => () => { if (canRun()) fn(); };
      navigator.mediaSession.setActionHandler('play', guard(() => actions.toggle.run(true)));
      navigator.mediaSession.setActionHandler('pause', guard(() => actions.toggle.run(false)));
      navigator.mediaSession.setActionHandler('nexttrack', guard(actions.forward.run));
      navigator.mediaSession.setActionHandler('previoustrack', guard(actions.back.run));
    } catch {}
  }

  return {
    open() {
      $('lastKey').textContent = 'none yet';
      panel.hidden = false;
      renderList();
    },
    isOpen: () => !panel.hidden,
  };
}
