import assert from 'node:assert/strict';
import test from 'node:test';
import { HookConfigError, mergeHook, removeHook, sectionPath } from '../src/apply/hook-merger.js';

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

test('removeHook: kayıtlı komutu taşıyan girdiyi siler, diğerlerine dokunmaz', () => {
  const base = mergeHook('{}', path, spec).text;
  const two = mergeHook(base, path, { ...spec, matcher: 'Edit' }).text;

  const removed = removeHook(two, path, spec);
  assert.equal(removed.changed, true);
  const parsed = JSON.parse(removed.text) as { hooks: { PreToolUse: Array<{ matcher: string }> } };
  assert.deepEqual(
    parsed.hooks.PreToolUse.map((entry) => entry.matcher),
    ['Edit'],
  );

  assert.equal(removeHook(removed.text, path, { ...spec, command: 'baska-komut' }).changed, false);
  assert.equal(removeHook(removed.text, path, { ...spec, matcher: 'Edit' }).changed, true, 'Edit hâlâ silinebilir olmalı');
});
