// Google Doc text (markdown export or pasted plain text) -> script blocks.
// Pure: text in, blocks out. No DOM, so it runs under `node --test` too.
//
// Block shapes:
//   { type: 'seg',   text }                              segment header (from a heading)
//   { type: 'cue',   text }                              visual cue (from a [bracketed] paragraph)
//   { type: 'break' }                                    section break (from ---)
//   { type: 'line',  speaker, tag, cont, runs }          spoken line; speaker is null for narrator,
//                                                        cont means "same speaker, don't repeat the name",
//                                                        runs is [{ t, b, i }] (text, bold, italic)

// Google's markdown export backslash-escapes punctuation (\. \- \[ ...). Escaped characters are
// parked in the private-use range so they can't be mistaken for markup, then restored at the end.
const PUA = 0xe000;
const protect = s => s.replace(/\\([!-\/:-@\[-`{-~])/g, (_, c) => String.fromCharCode(PUA + c.charCodeAt(0)));
const restore = s => s.replace(/[-]/g, c => String.fromCharCode(c.charCodeAt(0) - PUA));

// *italic*, **bold**, ***both***, and the underscore forms (only at word edges, so snake_case survives).
const EMPHASIS = /(\*{1,3})(?=\S)(.*?[^\s*])\1(?!\*)|(^|\W)(_{1,3})(?=\S)(.*?[^\s_])\4(?!\w)/;

function toRuns(s, b = false, i = false, out = []) {
  const push = t => {
    if (!t) return;
    const prev = out[out.length - 1];
    if (prev && prev.b === b && prev.i === i) prev.t += restore(t);
    else out.push({ t: restore(t), b, i });
  };
  while (s) {
    const m = EMPHASIS.exec(s);
    if (!m) { push(s); break; }
    push(s.slice(0, m.index) + (m[3] ?? ''));
    const mark = (m[1] ?? m[4]).length;
    toRuns(m[2] ?? m[5], b || mark >= 2, i || mark !== 2, out);
    s = s.slice(m.index + m[0].length);
  }
  return out;
}

const plainOf = runs => runs.map(r => r.t).join('');

function dropChars(runs, n) {
  const out = [];
  for (const r of runs) {
    if (n >= r.t.length) { n -= r.t.length; continue; }
    out.push({ ...r, t: r.t.slice(n) });
    n = 0;
  }
  if (out.length) out[0].t = out[0].t.trimStart();
  return out.filter(r => r.t);
}

// NAME: or NAME (V.O.): at the start of a paragraph. All caps, 1 to 20 characters.
const SPEAKER = /^([A-Z][A-Z0-9 .'’&-]{0,19}?)\s*(?:\(([^)]{1,24})\))?\s*:\s*/;

export function parse(text) {
  const blocks = [];
  const speakers = [];
  let current = null;   // speaker that unlabeled paragraphs continue
  let tag = null;
  let fresh = false;    // previous block was a line by `current`

  for (const rawLine of String(text ?? '').replace(/\r\n?/g, '\n').split('\n')) {
    let p = rawLine.replace(/[​﻿]/g, '').replace(/ /g, ' ').trim().replace(/\\$/, '').trim();
    if (!p) continue;
    if (/^\[[^\]]+\]:\s*\S/.test(p)) continue;                         // link/image definitions (can be huge base64)

    const heading = /^#{1,6}\s+(.+?)\s*#*$/.exec(p);
    if (heading) {
      const title = plainOf(toRuns(protect(heading[1]))).trim();
      if (title) blocks.push({ type: 'seg', text: title });
      current = null; tag = null; fresh = false;
      continue;
    }
    if (/^([-*_])(?:\s*\1){2,}$/.test(p)) {
      blocks.push({ type: 'break' });
      fresh = false;
      continue;
    }

    p = protect(p)
      .replace(/!\[[^\]]*\](?:\([^)]*\)|\[[^\]]*\])/g, '')             // images
      .replace(/\[([^\]]+)\]\([^)]*\)/g, '$1')                         // links -> their text
      .replace(/^(?:>\s*)+/, '')                                       // blockquote
      .replace(/^(?:[-+*]|\d+[.)])\s+/, '')                            // list marker
      .trim();
    if (!p) continue;

    let runs = toRuns(p);
    const plain = plainOf(runs).trim();
    if (!plain) continue;

    if (/^\[[\s\S]*\]$/.test(plain)) {
      const cue = plain.slice(1, -1).trim();
      if (cue) blocks.push({ type: 'cue', text: cue });
      fresh = false;
      continue;
    }

    const m = SPEAKER.exec(plainOf(runs));
    if (m) {
      current = m[1].trim();
      tag = m[2]?.trim() || null;
      fresh = false;
      if (!speakers.includes(current)) speakers.push(current);
      runs = dropChars(runs, m[0].length);
      if (!runs.length) continue;                                      // name on its own line; text follows
    }

    blocks.push({ type: 'line', speaker: current, tag: current ? tag : null, cont: fresh && current !== null, runs });
    fresh = true;
  }
  return { blocks, speakers };
}

// A title for pasted text: the first heading, else the first few words.
export function guessTitle(text) {
  const { blocks } = parse(text);
  const seg = blocks.find(b => b.type === 'seg');
  if (seg) return seg.text;
  const first = blocks.find(b => b.type === 'line');
  const words = first ? plainOf(first.runs) : '';
  return words.length > 40 ? words.slice(0, 40).trimEnd() + '…' : words || 'Untitled script';
}
