import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
const html = await readFile(new URL('../index.html', import.meta.url), 'utf8');
const css = await readFile(new URL('../src/style.css', import.meta.url), 'utf8');

test('workspace retains accessible input, status, and safe microphone defaults', () => {
  const ids = [...html.matchAll(/\bid="([^"]+)"/g)].map(match => match[1]);
  assert.equal(new Set(ids).size, ids.length, 'IDs must be unique');
  for (const id of ['file-input','drop-zone','waveform','play','stop','demo','file-tab','mic-tab','monitor','ptt','start-mic','stop-mic','vox','presets','parameter-controls','export','cancel-export','match-prepare','match-off','match-status','status-text']) assert.ok(ids.includes(id), id);
  assert.match(html, /id="monitor"[^>]*type="checkbox"/);
  assert.doesNotMatch(html.match(/<input id="monitor"[^>]*>/)[0], /checked/);
  assert.match(html, /id="ptt"[^>]*disabled/);
  assert.match(html, /role="status" aria-live="polite"/);
  assert.match(html, /请先戴好耳机/);
});

test('advanced controls and approximate comparison remain discoverable native disclosures', () => {
  assert.match(html, /<details class="panel controls-panel"><summary/);
  assert.match(html, /<details class="comparison-tools"><summary/);
  assert.doesNotMatch(html, /<details[^>]+\bopen\b/);
  assert.ok(html.indexOf('id="output-heading"') < html.indexOf('id="tune-heading"'));
  assert.match(html, /非感知响度认证，不改变麦克风与导出/);
});

test('redesign preserves hidden states, focus indicators, reduced motion, and mobile range targets', () => {
  assert.match(css, /\[hidden\]\{display:none!important\}/);
  for (const selector of ['.drop-zone:focus-visible','summary:focus-visible','select:focus-visible','input:focus-visible+.switch']) assert.ok(css.includes(selector), selector);
  assert.match(css, /input\[type=range\]\{height:44px\}/);
  assert.match(css, /prefers-reduced-motion:reduce/);
  assert.doesNotMatch(html, /(?:src|href)="https?:\/\//);
});
