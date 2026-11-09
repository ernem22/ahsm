import assert from 'node:assert/strict';
import test from 'node:test';
import { HookConfigError, mergeHook, sectionPath } from '../src/apply/hook-merger.js';

const spec = { event: 'PreToolUse', matcher: 'Bash', command: 'echo hi' };

test('sectionPath {event} yerine geçer', () => {
  assert.deepEqual(sectionPath('hooks.{event}', 'PreToolUse'), ['hooks', 'PreToolUse']);
});

test('boş dosyada ilk hook oluşturulur', () => {
  const { changed, text } = mergeHook('', 'hooks.{event}', spec);
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
  const { changed, text } = mergeHook(input, 'hooks.{event}', spec);
  assert.equal(changed, true);
  assert.match(text, /\/\/ benim ayarım/);
  assert.match(text, /"model": "opus"/);
  assert.match(text, /"PreToolUse"/);
});

test('aynı hook ikinci kez eklenmez', () => {
  const first = mergeHook('{}', 'hooks.{event}', spec);
  const second = mergeHook(first.text, 'hooks.{event}', spec);
  assert.equal(second.changed, false);
  assert.equal(second.text, first.text);
});

test('farklı matcher ayrı giriş olur', () => {
  const first = mergeHook('{}', 'hooks.{event}', spec);
  const second = mergeHook(first.text, 'hooks.{event}', { ...spec, matcher: 'Edit' });
  assert.equal(second.changed, true);
  const parsed = JSON.parse(second.text) as { hooks: { PreToolUse: unknown[] } };
  assert.equal(parsed.hooks.PreToolUse.length, 2);
});

test('bozuk JSONC yazmaya kalkışmaz ve sebebi tiplidir', () => {
  try {
    mergeHook('{ nope', 'hooks.{event}', spec);
    assert.fail('expected HookConfigError');
  } catch (error) {
    assert.ok(error instanceof HookConfigError);
    assert.equal(error.reason, 'unreadable');
  }
});
