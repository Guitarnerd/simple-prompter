import test from 'node:test';
import assert from 'node:assert/strict';
import { parse, guessTitle } from '../js/parser.js';
import { SAMPLE_TEXT } from '../js/sample.js';

const text = b => b.runs.map(r => r.t).join('');

test('sample script: structure', () => {
  const { blocks, speakers } = parse(SAMPLE_TEXT);
  const lines = SAMPLE_TEXT.split('\n');
  const count = re => lines.filter(l => re.test(l)).length;

  assert.deepEqual(speakers, ['HOST', 'GUEST']);
  assert.equal(blocks.filter(b => b.type === 'seg').length, 3);
  assert.equal(blocks.filter(b => b.type === 'cue').length, count(/^\[/));
  assert.equal(blocks.filter(b => b.type === 'break').length, 1);
  assert.equal(blocks.filter(b => b.type === 'line' && b.speaker === 'HOST').length, count(/^HOST/) + 1);   // + the unlabeled paragraph
  assert.equal(blocks.filter(b => b.type === 'line' && b.speaker === 'GUEST').length, count(/^GUEST/));
  assert.equal(blocks.filter(b => b.type === 'line' && !b.speaker).length, 0);
  assert.equal(blocks.length, lines.filter(l => l.trim()).length);
});

test('sample script: content', () => {
  const { blocks } = parse(SAMPLE_TEXT);
  assert.deepEqual(blocks[0], { type: 'seg', text: 'Welcome to Simple Prompter' });
  assert.deepEqual(blocks[1], { type: 'cue', text: 'This gray text is a visual cue. The Cues button hides cues.' });
  assert.equal(blocks[2].speaker, 'HOST');
  assert.equal(blocks[2].tag, null);
  assert.ok(text(blocks[2]).startsWith('This is a sample script.'));
  const vo = blocks.find(b => b.tag);
  assert.equal(vo.speaker, 'GUEST');
  assert.equal(vo.tag, 'V.O.');
  const marked = blocks.find(b => b.type === 'line' && text(b).startsWith('Use bold or italic'));
  assert.deepEqual(marked.runs.filter(r => r.b || r.i), [{ t: 'bold', b: true, i: false }, { t: 'italic', b: false, i: true }]);
  const carried = blocks.find(b => b.type === 'line' && text(b).startsWith('A paragraph with no name'));
  assert.equal(carried.speaker, 'HOST');
  assert.equal(carried.cont, true);
  assert.equal(blocks.at(-1).type, 'cue');
});

test('Google markdown export quirks', () => {
  const { blocks, speakers } = parse([
    '## **Segment 1\\: Intro**',
    '',
    '\\[Studio set\\. Ted on the couch\\.\\]',
    '',
    '**TED:** Welcome back\\. This is *really* big\\!',
    '',
    '**PETER (V.O.):** So\\. **Big** news — “quoted”\\.',
    '',
    '![][image1]',
    '',
    '[image1]: <data:image/png;base64,AAAA>',
  ].join('\r\n'));

  assert.deepEqual(speakers, ['TED', 'PETER']);
  assert.deepEqual(blocks[0], { type: 'seg', text: 'Segment 1: Intro' });
  assert.deepEqual(blocks[1], { type: 'cue', text: 'Studio set. Ted on the couch.' });
  assert.deepEqual(blocks[2].runs, [
    { t: 'Welcome back. This is ', b: false, i: false },
    { t: 'really', b: false, i: true },
    { t: ' big!', b: false, i: false },
  ]);
  assert.equal(blocks[3].speaker, 'PETER');
  assert.equal(blocks[3].tag, 'V.O.');
  assert.deepEqual(blocks[3].runs[1], { t: 'Big', b: true, i: false });
  assert.equal(text(blocks[3]), 'So. Big news — “quoted”.');
  assert.equal(blocks.length, 4);
});

test('continuations, narrator, breaks', () => {
  const { blocks } = parse([
    'Just a narrator line.',
    'TED: First.',
    'Still Ted.',
    '[cue]',
    'Ted again after a cue.',
    '---',
    'PETER:',
    'Name on its own line.',
    '# New segment',
    'Narrator again.',
  ].join('\n'));

  const [narr, ted, cont, cue, after, brk, peter, seg, narr2] = blocks;
  assert.equal(narr.speaker, null);
  assert.equal(ted.cont, false);
  assert.equal(cont.speaker, 'TED');
  assert.equal(cont.cont, true);
  assert.equal(cue.type, 'cue');
  assert.equal(after.speaker, 'TED');
  assert.equal(after.cont, false);
  assert.equal(brk.type, 'break');
  assert.equal(peter.speaker, 'PETER');
  assert.equal(text(peter), 'Name on its own line.');
  assert.equal(seg.type, 'seg');
  assert.equal(narr2.speaker, null);
  assert.equal(blocks.length, 9);
});

test('things that are not speakers or emphasis', () => {
  const { blocks, speakers } = parse([
    'Ted: mixed case is not a speaker.',
    'Meet at 10:30 tonight.',
    'THIS NAME IS FAR TOO LONG TO BE A SPEAKER: really.',
    'A lone * asterisk and snake_case_words stay put.',
    'See [the doc](https://example.com) for more.',
  ].join('\n'));
  assert.deepEqual(speakers, []);
  assert.equal(text(blocks[3]), 'A lone * asterisk and snake_case_words stay put.');
  assert.equal(text(blocks[4]), 'See the doc for more.');
  assert.equal(blocks.length, 5);
});

test('guessTitle', () => {
  assert.equal(guessTitle(SAMPLE_TEXT), 'Welcome to Simple Prompter');
  assert.equal(guessTitle('TED: Hi there.'), 'Hi there.');
  assert.equal(guessTitle(''), 'Untitled script');
});
