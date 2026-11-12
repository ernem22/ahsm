import assert from 'node:assert/strict';
import test from 'node:test';
import { expandArgs, RecordingRunner } from '../src/context.js';

test('boşluk içeren değer tek argüman olarak korunur', () => {
  assert.deepEqual(expandArgs(['--skill {skill}'], { skill: 'web design' }), ['--skill', 'web design']);
});

test('değer boşsa şablon elemanı tamamen düşer', () => {
  assert.deepEqual(expandArgs(['npx', 'skills', 'add', '{source}', '--skill {skill}'], { source: 'a/b' }), [
    'npx',
    'skills',
    'add',
    'a/b',
  ]);
});

test('değer doluysa eleman yerine konur', () => {
  assert.deepEqual(expandArgs(['--skill {skill}'], { skill: 'x' }), ['--skill', 'x']);
});

test('kayıtçı sonuçları kopyalar: paylaşılan bir fikstür dizisi testler arasında tükenmez', async () => {
  const results = [{ code: 0, stdout: 'first', stderr: '' }];
  const runner = new RecordingRunner(results);

  assert.equal((await runner.run(['a'])).stdout, 'first');
  assert.equal((await runner.run(['b'])).stdout, '');
  assert.deepEqual(results, [{ code: 0, stdout: 'first', stderr: '' }], 'the caller’s array was consumed');
  assert.deepEqual(runner.calls, [['a'], ['b']]);
});
