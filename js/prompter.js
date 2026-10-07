// The prompter view: rendering script blocks, the scroll engine, guide line, mirror and wake lock.

const $ = id => document.getElementById(id);
const root = $('prompter'), view = $('view'), stage = $('stage'), scriptEl = $('script'), guide = $('guide');
const play = $('play'), speed = $('speed'), size = $('size'), cues = $('cues'), mirror = $('mirror'), hl = $('hl');

export const LIMITS = { speed: [5, 200], size: [28, 120], guide: [15, 60] };
const clamp = (key, v) => Math.min(LIMITS[key][1], Math.max(LIMITS[key][0], v));

let S;                       // shared settings object, owned by app.js
let onChange = () => {};     // settings changed here
let onPosition = () => {};   // scroll position changed (debounced)
let playing = false, last = 0, acc = 0, lock = null, open = false, posTimer = 0;

export const isOpen = () => open;
export const wakeLockSupported = 'wakeLock' in navigator;

function el(tag, className, text) {
  const e = document.createElement(tag);
  if (className) e.className = className;
  if (text != null) e.textContent = text;
  return e;
}

function blockEl(block, colors) {
  if (block.type === 'seg') return el('div', 'seg', block.text);
  if (block.type === 'cue') return el('div', 'cue', `[${block.text}]`);
  if (block.type === 'break') return el('div', 'brk');

  const line = el('div', 'line' + (block.speaker ? '' : ' narr') + (block.cont ? ' cont' : ''));
  line.dataset.speaker = block.speaker ?? '';
  if (block.speaker) {
    line.style.setProperty('--c', colors[block.speaker]);
    const who = el('span', 'who', block.speaker);
    if (block.tag) who.append(el('span', 'tag', block.tag));
    line.append(who);
  }
  const txt = el('span', 'txt');
  for (const r of block.runs) {
    const node = r.b ? el('strong', '', r.t) : document.createTextNode(r.t);
    if (r.i) { const em = el('em'); em.append(node); txt.append(em); } else txt.append(node);
  }
  line.append(txt);
  return line;
}

// ---- Position: which block sits on the guide line, and how far through it ----
const guideY = () => stage.clientHeight * S.guide / 100;

export function getAnchor() {
  if (stage.scrollTop < 4) return null;
  const y = stage.scrollTop + guideY();
  const kids = scriptEl.children;
  for (let i = 0; i < kids.length; i++) {
    const k = kids[i];
    if (k.offsetHeight && k.offsetTop + k.offsetHeight > y) {
      return { i, f: Math.max(0, (y - k.offsetTop) / k.offsetHeight) };
    }
  }
  return { i: kids.length - 1, f: 1 };
}

function setAnchor(a) {
  const k = a && scriptEl.children[a.i];
  stage.scrollTop = k ? Math.max(0, k.offsetTop + a.f * k.offsetHeight - guideY()) : 0;
}

function layout() {
  const h = stage.clientHeight;
  scriptEl.style.paddingTop = Math.round(h * (S.guide + 2) / 100) + 'px';
  scriptEl.style.paddingBottom = Math.round(h * 0.8) + 'px';
}

// Re-flow without losing the reader's place (text size, guide position, cues, rotation).
function reflow(change) {
  const a = open ? getAnchor() : null;
  change?.();
  if (!open) return;
  layout();
  setAnchor(a);
}

// ---- Settings -> screen ----
let flowKey = '';

export function apply() {
  const key = `${S.size}|${S.guide}|${S.cues}`;
  if (key !== flowKey) {
    flowKey = key;
    reflow(() => {
      guide.style.top = S.guide + '%';
      scriptEl.style.setProperty('--size', S.size + 'px');
      root.classList.toggle('nocues', !S.cues);
    });
  }
  view.classList.toggle('mh', S.mirrorH);
  view.classList.toggle('mv', S.mirrorV);
  speed.value = S.speed; $('speedOut').textContent = S.speed;
  size.value = S.size; $('sizeOut').textContent = S.size;
  cues.setAttribute('aria-pressed', S.cues);
  cues.textContent = S.cues ? 'Cues on' : 'Cues off';
  mirror.setAttribute('aria-pressed', S.mirrorH);
  const only = hl.value;
  for (const line of scriptEl.querySelectorAll('.line')) {
    line.classList.toggle('dim', !!only && line.dataset.speaker !== only);
  }
}

function change(patch) {
  Object.assign(S, patch);
  apply();
  onChange();
}

// ---- Scroll engine ----
function tick(t) {
  if (!playing) return;
  const dt = last ? (t - last) / 1000 : 0;
  last = t;
  acc += S.speed * dt;
  const px = Math.floor(acc);
  if (px) { stage.scrollTop += px; acc -= px; }
  if (stage.scrollTop + stage.clientHeight >= stage.scrollHeight - 2) toggle(false);
  requestAnimationFrame(tick);
}

export function toggle(on = !playing) {
  on = !!on && open;
  if (on === playing) return;
  playing = on;
  play.textContent = on ? 'Pause' : 'Play';
  root.classList.toggle('playing', on);
  if (on) { last = 0; acc = 0; requestAnimationFrame(tick); }
}

const restart = () => { toggle(false); stage.scrollTop = 0; };
const jump = d => stage.scrollBy({ top: d * stage.clientHeight * 0.35, behavior: 'smooth' });

export const actions = {
  toggle: { label: 'Play / pause', run: on => toggle(typeof on === 'boolean' ? on : undefined) },
  faster: { label: 'Scroll faster', run: () => change({ speed: clamp('speed', S.speed + 5) }) },
  slower: { label: 'Scroll slower', run: () => change({ speed: clamp('speed', S.speed - 5) }) },
  forward: { label: 'Jump ahead', run: () => jump(1) },
  back: { label: 'Jump back', run: () => jump(-1) },
  bigger: { label: 'Bigger text', run: () => change({ size: clamp('size', S.size + 4) }) },
  smaller: { label: 'Smaller text', run: () => change({ size: clamp('size', S.size - 4) }) },
  restart: { label: 'Restart', run: restart },
};

// ---- Wake lock: held while the prompter is on screen. The browser drops it whenever
// the app is hidden, so it is requested again each time the app comes back. ----
async function acquireLock() {
  if (!open || lock || document.visibilityState !== 'visible' || !wakeLockSupported) return;
  try {
    lock = await navigator.wakeLock.request('screen');
    lock.addEventListener('release', () => { lock = null; });
    if (!open) releaseLock();
  } catch {}
}

function releaseLock() {
  lock?.release().catch(() => {});
  lock = null;
}

// ---- View lifecycle ----
export function show() {
  open = true;
  root.hidden = false;
  acquireLock();
}

export function hide() {
  if (!open) return;
  toggle(false);
  clearTimeout(posTimer);
  onPosition(getAnchor());
  open = false;
  root.hidden = true;
  releaseLock();
}

// Call after show(). parsed is parser output, colors maps speaker name -> color.
export function load(parsed, colors, anchor) {
  toggle(false);
  scriptEl.replaceChildren(...parsed.blocks.map(b => blockEl(b, colors)), el('div', 'end', 'END OF SCRIPT'));
  hl.replaceChildren(new Option('Everyone', ''), ...parsed.speakers.map(n => new Option(n, n)));
  hl.value = parsed.speakers.includes(S.highlight) ? S.highlight : '';
  apply();
  layout();
  setAnchor(anchor);
}

export function init(settings, hooks) {
  S = settings;
  onChange = hooks.onChange;
  onPosition = hooks.onPosition;

  play.onclick = () => toggle();
  $('top').onclick = restart;
  speed.oninput = () => change({ speed: +speed.value });
  size.oninput = () => change({ size: +size.value });
  cues.onclick = () => change({ cues: !S.cues });
  mirror.onclick = () => change({ mirrorH: !S.mirrorH });
  hl.onchange = () => { change({ highlight: hl.value }); hl.blur(); };
  stage.addEventListener('click', () => toggle());
  stage.addEventListener('scroll', () => {
    clearTimeout(posTimer);
    posTimer = setTimeout(() => { if (open) onPosition(getAnchor()); }, 400);
  }, { passive: true });
  // Buttons drop focus after a click so a remote's Enter/Space never "re-clicks" them
  document.querySelectorAll('#bar button').forEach(b => b.addEventListener('click', () => b.blur()));

  addEventListener('resize', () => reflow());
  document.addEventListener('visibilitychange', () => {
    if (document.visibilityState === 'visible') acquireLock();
    else if (open) onPosition(getAnchor());
  });
}
