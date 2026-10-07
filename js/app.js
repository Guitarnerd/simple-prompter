// Boot, routing between the Library, Prompter, Settings and Intro views, and the add/refresh flows.

import * as store from './store.js';
import { parse, guessTitle } from './parser.js';
import * as prompter from './prompter.js';
import { createRemote } from './remote.js';
import * as drive from './google.js';
import { SAMPLE_TITLE, SAMPLE_TEXT } from './sample.js';

const VERSION = '1.0.0';
const $ = id => document.getElementById(id);
const h = (tag, props, ...kids) => {
  const el = Object.assign(document.createElement(tag), props);
  el.append(...kids.filter(k => k != null));
  return el;
};

const DEFAULTS = {
  speed: 45,
  size: matchMedia('(max-width:600px)').matches ? 36 : 56,
  guide: 36,
  mirrorH: false,
  mirrorV: false,
  cues: true,
  highlight: '',
  colors: {},          // per-speaker overrides, remembered by name across scripts
};

const PALETTE = ['#ffd25a', '#7fd4ff', '#8ee6a0', '#ff9ecf', '#ffab6b', '#c3a6ff', '#6fe0d2', '#ff8a80'];
const FIXED = { TED: PALETTE[0], PETER: PALETTE[1] };
const SOURCES = { sample: 'Built-in sample', paste: 'Pasted text', link: 'Shared link', drive: 'Google Drive' };

let settings = { ...DEFAULTS };
let scripts = [];
let current = null;           // script on the prompter
let remote = null;
let installEvent = null;
const updates = new Set();    // ids of scripts that changed in Drive since their last refresh

const isIOS = /iPad|iPhone|iPod/.test(navigator.userAgent) || (navigator.platform === 'MacIntel' && navigator.maxTouchPoints > 1);
const isInstalled = () => matchMedia('(display-mode: standalone), (display-mode: fullscreen)').matches || navigator.standalone === true;

// ---- Small helpers ----
let toastTimer = 0;
function toast(message) {
  const t = $('toast');
  t.textContent = message;
  t.hidden = false;
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => { t.hidden = true; }, 6000);
}

// Runs an add/refresh flow, showing any failure as a toast.
async function attempt(fn) {
  try {
    return await fn();
  } catch (e) {
    console.error(e);
    toast(e.message || 'Something went wrong.');
  }
}

let saveTimer = 0;
function saveSettings() {
  clearTimeout(saveTimer);
  saveTimer = setTimeout(() => store.set('settings', settings), 300);
}
// Don't lose a change made just before the app is closed or switched away from.
addEventListener('pagehide', () => store.set('settings', settings));

const when = ts => new Date(ts).toLocaleString([], { dateStyle: 'medium', timeStyle: 'short' });

// Colors in order of first appearance. TED and PETER keep yellow and blue; overrides win.
function colorsFor(speakers) {
  const free = PALETTE.filter(c => !speakers.some(n => FIXED[n] === c));
  const map = {};
  let n = 0;
  for (const name of speakers) map[name] = settings.colors[name] || FIXED[name] || free[n++ % free.length];
  return map;
}

// ---- Scripts ----
async function saveScript(script) {
  const i = scripts.findIndex(s => s.id === script.id);
  if (i < 0) scripts.push(script); else scripts[i] = script;
  await store.putScript(script);
  return script;
}

function newScript(fields) {
  return { id: crypto.randomUUID?.() ?? 'local-' + Date.now(), addedAt: Date.now(), refreshedAt: Date.now(), anchor: null, ...fields };
}

// Adds a Google doc, or updates it in place if it's already in the library.
async function saveDoc(source, fileId, doc) {
  const id = 'g-' + fileId;
  const existing = scripts.find(s => s.id === id);
  updates.delete(id);
  return saveScript({
    ...(existing ?? newScript({ id })),
    source, fileId,
    title: doc.name,
    raw: doc.text,
    modifiedTime: doc.modifiedTime,
    refreshedAt: Date.now(),
  });
}

async function refreshScript(script) {
  if (!navigator.onLine) throw new Error('You’re offline. The saved copy still works.');
  const doc = await drive.fetchDoc(script.fileId, { auth: script.source === 'drive' });
  await saveDoc(script.source, script.fileId, doc);
  toast(`“${doc.name}” is up to date.`);
}

async function checkUpdates() {
  if (!navigator.onLine) return;
  await Promise.all(scripts.filter(s => s.fileId).map(async s => {
    try {
      const m = await drive.modifiedTime(s);
      if (!m) return;
      if (m !== s.modifiedTime) updates.add(s.id); else updates.delete(s.id);
    } catch {}
  }));
  if (!$('library').hidden) renderLibrary();
  syncRefreshButton();
}

// ---- Library ----
function renderLibrary() {
  $('scripts').replaceChildren(...scripts.map(s => {
    const meta = `${SOURCES[s.source]} · ${s.source === 'sample' ? 'always available' : 'refreshed ' + when(s.refreshedAt)}`;
    const open = h('button', { type: 'button', className: 'open', onclick: () => { location.hash = '#/play/' + encodeURIComponent(s.id); } },
      s.title,
      updates.has(s.id) ? h('span', { className: 'badge', textContent: 'Updated in Drive' }) : null,
      h('span', { className: 'meta', textContent: meta }));
    const tools = h('div', { className: 'tools' },
      s.fileId ? h('button', { type: 'button', className: 'quiet', textContent: 'Refresh', onclick: () => attempt(async () => { await refreshScript(s); renderLibrary(); }) }) : null,
      h('button', { type: 'button', className: 'quiet', textContent: 'View raw text', onclick: () => showRaw(s) }),
      h('button', { type: 'button', className: 'quiet danger', textContent: 'Remove', onclick: () => removeScript(s) }));
    return h('li', { className: 'script' }, open, tools);
  }));
  $('empty').hidden = scripts.length > 0;

  const note = $('googleNote');
  note.hidden = drive.configured();
  note.textContent = drive.linkConfigured()
    ? 'Google sign-in isn’t set up yet, so Add from Google Drive is off. Paste link and Paste text work.'
    : 'Google isn’t connected yet, so only Paste text works. See “Google setup” in the README.';
}

async function removeScript(script) {
  if (!confirm(`Remove “${script.title}” from this device? ${script.fileId ? 'The Google Doc isn’t touched.' : ''}`)) return;
  scripts = scripts.filter(s => s.id !== script.id);
  updates.delete(script.id);
  await store.deleteScript(script.id);
  renderLibrary();
}

function showRaw(script) {
  $('rawTitle').textContent = script.title;
  $('rawBody').textContent = script.raw;
  $('dlgRaw').showModal();
}

function wireLibrary() {
  $('openSettings').onclick = () => { location.hash = '#/settings'; };

  $('addDrive').onclick = () => attempt(async () => {
    if (!drive.configured()) return toast('Google sign-in isn’t set up yet. See “Google setup” in the README.');
    if (!navigator.onLine) return toast('You’re offline. Connect to add a script from Drive.');
    const picked = await drive.pick();
    if (!picked) return;
    const doc = await drive.fetchDoc(picked.id, { auth: true });
    await saveDoc('drive', picked.id, doc);
    renderLibrary();
  });

  $('addLink').onclick = () => {
    if (!drive.linkConfigured()) return toast('Paste link needs the Google API key. See “Google setup” in the README.');
    $('linkUrl').value = '';
    $('dlgLink').showModal();
  };
  $('dlgLink').addEventListener('submit', e => attempt(async () => {
    if (e.submitter?.value !== 'ok') return;
    const fileId = drive.fileIdFromLink($('linkUrl').value);
    if (!fileId) return toast('That doesn’t look like a Google Docs link.');
    const doc = await drive.fetchDoc(fileId, { auth: false });
    await saveDoc('link', fileId, doc);
    renderLibrary();
  }));

  $('addText').onclick = () => {
    $('textTitle').value = '';
    $('textBody').value = '';
    $('dlgText').showModal();
  };
  $('dlgText').addEventListener('submit', e => attempt(async () => {
    if (e.submitter?.value !== 'ok') return;
    const raw = $('textBody').value;
    if (!raw.trim()) return toast('Nothing was pasted.');
    await saveScript(newScript({ source: 'paste', title: $('textTitle').value.trim() || guessTitle(raw), raw }));
    renderLibrary();
  }));
}

// ---- Prompter ----
function openPrompter(script) {
  current = script;
  const parsed = parse(script.raw);
  prompter.show();
  prompter.load(parsed, colorsFor(parsed.speakers), script.anchor);
  document.title = script.title;
  syncRefreshButton();
}

function syncRefreshButton() {
  const btn = $('refresh');
  btn.hidden = !current?.fileId;
  const changed = !!current && updates.has(current.id);
  btn.classList.toggle('update', changed);
  btn.textContent = changed ? 'Updated in Drive, tap to refresh' : 'Refresh';
}

function wirePrompter(savedMap) {
  prompter.init(settings, {
    onChange: saveSettings,
    onPosition: anchor => {
      if (!current) return;
      current.anchor = anchor;
      store.putScript(current);
    },
  });
  $('back').onclick = () => { location.hash = '#/'; };
  $('refresh').onclick = () => attempt(async () => {
    const script = current;
    await refreshScript(script);
    if (current?.id === script.id) openPrompter(scripts.find(s => s.id === script.id));
  });
  remote = createRemote({
    actions: prompter.actions,
    canRun: () => prompter.isOpen() && !document.querySelector('dialog[open]'),
    saved: savedMap,
    onSave: map => store.set('remoteMap', map),
  });
}

// ---- Settings ----
function allSpeakers() {
  const names = [];
  for (const s of scripts) for (const n of parse(s.raw).speakers) if (!names.includes(n)) names.push(n);
  for (const n of Object.keys(settings.colors)) if (!names.includes(n)) names.push(n);
  return names;
}

function renderSettings() {
  for (const [id, key] of [['setSpeed', 'speed'], ['setSize', 'size'], ['setGuide', 'guide']]) {
    $(id).value = settings[key];
    $(id + 'Out').textContent = settings[key] + (key === 'guide' ? '%' : '');
  }
  $('setMirrorH').checked = settings.mirrorH;
  $('setMirrorV').checked = settings.mirrorV;

  const names = allSpeakers();
  const colors = colorsFor(names);
  $('noSpeakers').hidden = names.length > 0;
  $('colorList').replaceChildren(...names.map(name => {
    const input = h('input', { type: 'color', value: colors[name], ariaLabel: `Color for ${name}` });
    input.oninput = () => { settings.colors[name] = input.value; saveSettings(); };
    const reset = h('button', { type: 'button', className: 'quiet', textContent: 'Reset', hidden: !settings.colors[name] });
    input.onchange = () => { reset.hidden = false; };
    reset.onclick = () => { delete settings.colors[name]; saveSettings(); renderSettings(); };
    const row = h('div', { className: 'color-row' }, h('span', { className: 'name', textContent: name }), reset, input);
    row.style.color = colors[name];
    return row;
  }));

  $('googleStatus').textContent = !drive.configured()
    ? 'Google sign-in isn’t set up yet. See “Google setup” in the README.'
    : drive.signedIn()
      ? 'Signed in. The app can only see the docs you picked.'
      : 'Not signed in. You’ll be asked the next time you add or refresh a Drive script.';
  $('signOut').hidden = !drive.signedIn();

  $('wakeStatus').textContent = prompter.wakeLockSupported
    ? 'Screen stays awake while a script is open.'
    : 'This device can’t keep the screen awake from a web app. Set Auto-Lock to Never while recording' + (isIOS ? ' (Settings → Display & Brightness → Auto-Lock).' : '.');
  navigator.storage?.persisted?.().then(ok => {
    $('storageStatus').textContent = ok
      ? 'Saved scripts are protected from automatic cleanup.'
      : 'This device may clear saved scripts if the app goes unused for a few weeks. They can always be added again.';
  });
  $('version').textContent = `Simple Prompter ${VERSION}`;
}

function wireSettings() {
  $('closeSettings').onclick = () => { location.hash = '#/'; };
  for (const [id, key] of [['setSpeed', 'speed'], ['setSize', 'size'], ['setGuide', 'guide']]) {
    $(id).oninput = () => {
      settings[key] = +$(id).value;
      $(id + 'Out').textContent = settings[key] + (key === 'guide' ? '%' : '');
      prompter.apply();
      saveSettings();
    };
  }
  for (const [id, key] of [['setMirrorH', 'mirrorH'], ['setMirrorV', 'mirrorV']]) {
    $(id).onchange = () => { settings[key] = $(id).checked; prompter.apply(); saveSettings(); };
  }
  $('openRemote').onclick = () => remote.open();
  $('signOut').onclick = () => { drive.signOut(); renderSettings(); };
  $('openIntro').onclick = () => { location.hash = '#/intro'; };
}

// ---- Intro / install ----
function renderIntro() {
  const installed = isInstalled();
  $('installed').hidden = !installed;
  $('installPrompt').hidden = installed || !installEvent;
  $('installIOS').hidden = installed || !isIOS;
  $('installOther').hidden = installed || isIOS || !!installEvent;
}

function wireIntro() {
  addEventListener('beforeinstallprompt', e => {
    e.preventDefault();
    installEvent = e;
    renderIntro();
  });
  addEventListener('appinstalled', () => { installEvent = null; renderIntro(); });
  $('installBtn').onclick = async () => {
    await installEvent?.prompt();
    installEvent = null;
    renderIntro();
  };
  $('introDone').onclick = () => {
    store.set('seenIntro', true);
    location.hash = '#/';
  };
}

// ---- Routing ----
function route() {
  const [name, arg] = location.hash.replace(/^#\/?/, '').split('/');
  const script = name === 'play' ? scripts.find(s => s.id === decodeURIComponent(arg ?? '')) : null;
  if (name === 'play' && !script) return location.replace('#/');

  const page = script ? null : ['settings', 'intro'].includes(name) ? name : 'library';
  for (const id of ['library', 'settings', 'intro']) $(id).hidden = id !== page;

  if (script) return openPrompter(script);
  prompter.hide();
  current = null;
  document.title = 'Simple Prompter';
  if (page === 'library') { renderLibrary(); checkUpdates(); }
  if (page === 'settings') renderSettings();
  if (page === 'intro') renderIntro();
}

// The fonts load before the service worker takes control on a first visit, so they'd miss the
// offline cache. Once it's in control, ask for them again so they pass through it.
async function cacheFonts() {
  await navigator.serviceWorker.ready;
  await document.fonts.ready;
  if (!navigator.serviceWorker.controller) await new Promise(r => navigator.serviceWorker.addEventListener('controllerchange', r, { once: true }));
  for (const entry of performance.getEntriesByType('resource')) {
    if (/^https:\/\/fonts\.(googleapis|gstatic)\.com\//.test(entry.name)) fetch(entry.name).catch(() => {});
  }
}

async function boot() {
  const [savedSettings, savedMap, seeded, seenIntro] = await Promise.all(
    ['settings', 'remoteMap', 'seeded', 'seenIntro'].map(store.get));
  Object.assign(settings, savedSettings);
  scripts = await store.allScripts();
  if (!seeded) {
    await saveScript(newScript({ id: 'sample', source: 'sample', title: SAMPLE_TITLE, raw: SAMPLE_TEXT }));
    await store.set('seeded', true);
  }

  wireLibrary();
  wirePrompter(savedMap);
  wireSettings();
  wireIntro();

  addEventListener('hashchange', route);
  addEventListener('online', checkUpdates);
  if (!seenIntro && !location.hash) location.replace('#/intro');
  route();

  drive.preload();
  navigator.storage?.persist?.();
  // On localhost the service worker is opt-in (?sw) so edits show up on reload.
  if ('serviceWorker' in navigator && (!/^(localhost|127\.0\.0\.1)$/.test(location.hostname) || location.search.includes('sw'))) {
    navigator.serviceWorker.register('sw.js').catch(console.error);
    cacheFonts();
  }
}

boot();
