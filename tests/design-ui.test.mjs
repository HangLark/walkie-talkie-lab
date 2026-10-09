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
  assert.match(html, /<details class="advanced-controls"><summary/);
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

// These are source-layout contracts, not browser geometry assertions.
function declarations(selector) {
  const escaped = selector.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  return [...css.matchAll(new RegExp(`${escaped}\\{([^}]*)\\}`, 'g'))].map(match => match[1]);
}

test('monitor and output share an independent sidebar rather than source-sized grid rows', () => {
  const sidebar = html.slice(html.indexOf('<section class="center-column">'), html.indexOf('<section class="panel controls-panel">'));
  assert.match(sidebar, /class="receiver panel"/);
  assert.match(sidebar, /class="panel output-panel"/);
  assert.doesNotMatch(sidebar, /class="panel presets-panel"/);
  assert.match(declarations('.center-column')[0], /display:grid;grid-column:2;grid-row:1\/span 3;gap:inherit;min-width:0;align-self:start/);
  assert.ok(declarations('.center-column').includes('grid-row:1/span 2'), 'tablet sidebar stays above full-width advanced controls');
  for (const selector of ['.receiver', '.output-panel']) {
    for (const rule of declarations(selector)) assert.doesNotMatch(rule, /grid-(?:row|column):/, `${selector} must flow inside the sidebar`);
  }
});

test('monitor uses natural content height without stretch, clipping, or screen flex growth', () => {
  assert.ok(declarations('.receiver').some(rule => /align-self:start/.test(rule)));
  for (const selector of ['.receiver', '.screen']) {
    for (const rule of declarations(selector)) {
      assert.doesNotMatch(rule, /(?:^|;)(?:(?:min-|max-)?height|overflow(?:-y)?):/, `${selector} must remain content-sized at every breakpoint`);
      assert.doesNotMatch(rule, /align-self:stretch|flex:(?:1|auto)(?:;|$)/);
    }
  }
  assert.ok(declarations('.screen').some(rule => /flex:0 0 auto/.test(rule)));
});

test('mobile unwraps the sidebar and retains source, monitor, presets, output, advanced order', () => {
  assert.ok(declarations('.center-column').includes('display:contents'));
  assert.ok(declarations('.workbench').some(rule => /display:flex;flex-direction:column/.test(rule)));
  ['.source-panel', '.receiver', '.presets-panel', '.output-panel', '.controls-panel'].forEach((selector, index) => {
    assert.ok(declarations(selector).some(rule => new RegExp(`(?:^|;)order:${index + 1}(?:;|$)`).test(rule)), selector);
  });
});

 test('audition tools remain contextual, sticky and render volume is distinct',()=>{
  assert.match(css,/\.audition-bar\{position:sticky;top:0;z-index:20/);
  for(const id of ['current-source','file-transport','seek','listen-volume','file-audition','common-controls','export-source'])assert.ok(html.includes(`id="${id}"`),id);
  assert.ok(html.indexOf('id="play"')<html.indexOf('class="workbench"'));
  assert.match(html,/试听音量不影响导出/);
  assert.match(html,/调整后自动更新，保留试听位置/);
  assert.ok(html.indexOf('id="common-controls"')<html.indexOf('class="advanced-controls"'));
 });

 test('microphone safety controls stay in the sticky audition bar and focus clears it',()=>{
  const bar=html.slice(html.indexOf('class="audition-bar"'),html.indexOf('class="workbench"'));
  for(const id of ['ptt','monitor','vox','mic-quick-stop'])assert.ok(bar.includes(`id="${id}"`),id);
  assert.match(css,/scroll-padding-top:calc\(var\(--audition-height\) \+ 16px\)/);
  assert.match(html,/id="vox-threshold-control"[^>]*hidden/);
 });
