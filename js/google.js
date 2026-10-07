// Google Drive: sign-in (Google Identity Services), the Picker, and Docs export.
// Mode A: sign in + pick a doc (drive.file scope, only the docs the user picks).
// Mode B: a link-shared doc fetched with the API key, no sign-in.

import { CONFIG } from './config.js';

const SCOPE = 'https://www.googleapis.com/auth/drive.file';
const DOC = 'application/vnd.google-apps.document';
const API = 'https://www.googleapis.com/drive/v3/files/';

export const configured = () => !!(CONFIG.clientId && CONFIG.apiKey && CONFIG.appId);
export const linkConfigured = () => !!CONFIG.apiKey;
export const signedIn = () => !!token && Date.now() < tokenExp;

let token = null;
let tokenExp = 0;
let tokenClient = null;
let pending = null;
let gis = null;
let picker = null;

function loadScript(src) {
  return new Promise((resolve, reject) => {
    const s = document.createElement('script');
    s.src = src;
    s.async = true;
    s.onload = resolve;
    s.onerror = () => { s.remove(); reject(new Error('Can’t reach Google. Check the connection.')); };
    document.head.append(s);
  });
}

function loadGis() {
  gis ??= loadScript('https://accounts.google.com/gsi/client').then(() => {
    tokenClient = window.google.accounts.oauth2.initTokenClient({
      client_id: CONFIG.clientId,
      scope: SCOPE,
      callback: r => pending?.(r),
      error_callback: e => pending?.({ error: e?.type || 'unknown' }),
    });
  }).catch(e => { gis = null; throw e; });
  return gis;
}

function loadPicker() {
  picker ??= loadScript('https://apis.google.com/js/api.js')
    .then(() => new Promise(resolve => window.gapi.load('picker', resolve)))
    .catch(e => { picker = null; throw e; });
  return picker;
}

// Load Google's scripts ahead of the first tap. Safari only opens the sign-in popup
// if it follows the tap closely, so the scripts need to be in place already.
export function preload() {
  if (!configured() || !navigator.onLine) return;
  loadGis().catch(() => {});
  loadPicker().catch(() => {});
}

async function getToken() {
  if (signedIn()) return token;
  await loadGis();
  const r = await new Promise(resolve => {
    pending = resolve;
    tokenClient.requestAccessToken({ prompt: '' });
  });
  pending = null;
  if (r.error || !r.access_token) {
    if (r.error === 'popup_closed' || r.error === 'access_denied') throw new Error('Google sign-in was cancelled.');
    if (r.error === 'popup_failed_to_open') {
      throw new Error('The Google sign-in window was blocked. Try again, or use Paste link / Paste text instead.');
    }
    throw new Error('Google sign-in failed. Try again, or use Paste link / Paste text instead.');
  }
  token = r.access_token;
  tokenExp = Date.now() + (Number(r.expires_in) - 60) * 1000;
  return token;
}

export function signOut() {
  if (token) window.google?.accounts.oauth2.revoke(token, () => {});
  token = null;
  tokenExp = 0;
}

async function api(path, { auth, asText } = {}) {
  const url = new URL(API + path);
  const headers = {};
  if (auth) headers.Authorization = 'Bearer ' + await getToken();
  else url.searchParams.set('key', CONFIG.apiKey);

  let res;
  try {
    res = await fetch(url, { headers });
  } catch {
    throw new Error('Can’t reach Google. Check the connection.');
  }
  if (res.status === 401 && auth) {
    token = null;
    throw new Error('Google sign-in expired. Tap again to sign back in.');
  }
  if (!res.ok) {
    if (!auth && (res.status === 403 || res.status === 404)) {
      throw new Error('Can’t open that doc. In Google Docs, set Share to “Anyone with the link can view.”');
    }
    if (res.status === 404) throw new Error('That doc is gone, or this app no longer has access to it. Add it again.');
    throw new Error(`Google Drive returned an error (${res.status}).`);
  }
  return asText ? res.text() : res.json();
}

// Opens the Picker. Resolves { id, name }, or null if the user cancels.
export async function pick() {
  const accessToken = await getToken();
  await loadPicker();
  const { picker: gp } = window.google;
  return new Promise(resolve => {
    new gp.PickerBuilder()
      .addView(new gp.DocsView(gp.ViewId.DOCUMENTS).setMode(gp.DocsViewMode.LIST))
      .setOAuthToken(accessToken)
      .setDeveloperKey(CONFIG.apiKey)
      .setAppId(CONFIG.appId)
      .setCallback(data => {
        if (data.action === gp.Action.PICKED) resolve({ id: data.docs[0].id, name: data.docs[0].name });
        else if (data.action === gp.Action.CANCEL) resolve(null);
      })
      .build()
      .setVisible(true);
  });
}

// Resolves { name, modifiedTime, text } for a doc. auth=true uses the signed-in user, false the API key.
export async function fetchDoc(fileId, { auth }) {
  const id = encodeURIComponent(fileId);
  const meta = await api(`${id}?fields=name,modifiedTime,mimeType&supportsAllDrives=true`, { auth });
  let text;
  if (meta.mimeType === DOC) {
    text = await api(`${id}/export?mimeType=text/markdown`, { auth, asText: true });
  } else if (/^text\//.test(meta.mimeType)) {
    text = await api(`${id}?alt=media&supportsAllDrives=true`, { auth, asText: true });
  } else {
    throw new Error('That file isn’t a Google Doc. Pick a Google Doc or a plain text file.');
  }
  return { name: meta.name, modifiedTime: meta.modifiedTime, text };
}

// The doc's current modifiedTime, or null when it can't be checked without a sign-in prompt.
export async function modifiedTime(script) {
  const auth = script.source === 'drive';
  if (auth ? !signedIn() : !linkConfigured()) return null;
  const meta = await api(`${encodeURIComponent(script.fileId)}?fields=modifiedTime&supportsAllDrives=true`, { auth });
  return meta.modifiedTime;
}

// Pulls the file ID out of a Google Docs/Drive link (or accepts a bare ID).
export function fileIdFromLink(link) {
  const s = String(link).trim();
  const m = /\/d\/([\w-]{20,})/.exec(s) || /[?&]id=([\w-]{20,})/.exec(s) || /^([\w-]{20,})$/.exec(s);
  return m ? m[1] : null;
}
