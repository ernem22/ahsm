import assert from 'node:assert/strict';
import test from 'node:test';
import { expandArgs } from '../src/context.js';

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
