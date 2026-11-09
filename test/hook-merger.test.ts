import assert from 'node:assert/strict';
import test from 'node:test';
import { HookConfigError, mergeHook, sectionPath } from '../src/apply/hook-merger.js';

const spec = { event: 'PreToolUse', matcher: 'Bash', command: 'echo hi' };
const path = ['hooks', 'PreToolUse'];

test('sectionPath {event} yerine geçer', () => {
  assert.deepEqual(sectionPath('hooks.{event}', 'PreToolUse'), ['hooks', 'PreToolUse']);
});

test('boş dosyada ilk hook oluşturulur', () => {
  const { changed, text } = mergeHook('', path, spec);
  assert.equal(changed, true);
  const parsed = JSON.parse(text) as { hooks: { PreToolUse: Array<{ matcher: string }> } };
  assert.equal(parsed.hooks.PreToolUse[0]?.matcher, 'Bash');
});

test('yorumlar ve diğer ayarlar korunur', () => {
  const input = `{
  // benim ayarım
  "model": "opus",
  "hooks": {},
}
`;
  const { changed, text } = mergeHook(input, path, spec);
  assert.equal(changed, true);
  assert.match(text, /\/\/ benim ayarım/);
  assert.match(text, /"model": "opus"/);
  assert.match(text, /"PreToolUse"/);
});

test('aynı hook ikinci kez eklenmez', () => {
  const first = mergeHook('{}', path, spec);
  const second = mergeHook(first.text, path, spec);
  assert.equal(second.changed, false);
  assert.equal(second.text, first.text);
});

test('farklı matcher ayrı giriş olur', () => {
  const first = mergeHook('{}', path, spec);
  const second = mergeHook(first.text, path, { ...spec, matcher: 'Edit' });
  assert.equal(second.changed, true);
  const parsed = JSON.parse(second.text) as { hooks: { PreToolUse: unknown[] } };
  assert.equal(parsed.hooks.PreToolUse.length, 2);
});

test('bozuk JSONC yazmaya kalkışmaz', () => {
  assert.throws(() => mergeHook('{ nope', path, spec), HookConfigError);
});
