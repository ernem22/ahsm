import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';
import { createContext } from '../src/context.js';
import { resolveSelection } from '../src/core/selection.js';
import type { Data } from '../src/types.js';

function data(packages: Array<{ id: string; items: string[]; default?: boolean }>): Data {
  return {
    items: new Map(),
    packages: new Map(packages.map((pkg) => [pkg.id, pkg])),
    harnesses: [
      {
        id: 'claude-code',
        detect: ['~/.claude'],
        agentId: 'claude-code',
        config: { path: '~/.claude/settings.json', format: 'jsonc' },
      },
      { id: 'codex', detect: ['~/.codex'], agentId: 'codex', config: { path: '~/.codex/config.toml', format: 'jsonc' } },
    ],
    providers: [],
    requires: [],
  };
}

function ctx(home: string) {
  return createContext({ root: process.cwd(), home, platform: 'linux' });
}

function homeWithClaude(): string {
  const home = fs.mkdtempSync(path.join(os.tmpdir(), 'agentenv-sel-'));
  fs.mkdirSync(path.join(home, '.claude'), { recursive: true });
  return home;
}

test('paket verilmezse default işaretli paket seçilir', () => {
  const selection = resolveSelection(data([{ id: 'alpha', items: ['a'] }, { id: 'zulu', items: ['z'], default: true }]), ctx(homeWithClaude()));
  assert.deepEqual(selection.itemIds, ['z']);
});

test('default işareti yoksa id sırasına göre ilk paket seçilir', () => {
  const selection = resolveSelection(data([{ id: 'zulu', items: ['z'] }, { id: 'alpha', items: ['a'] }]), ctx(homeWithClaude()));
  assert.deepEqual(selection.itemIds, ['a']);
});

test('açık paket kimliği varsayılanı ezer', () => {
  const selection = resolveSelection(
    data([{ id: 'alpha', items: ['a'] }, { id: 'zulu', items: ['z'], default: true }]),
    ctx(homeWithClaude()),
    { packageId: 'alpha' },
  );
  assert.deepEqual(selection.itemIds, ['a']);
});

test('bilinmeyen paket kimliği hata verir ve kimliği söyler', () => {
  assert.throws(() => resolveSelection(data([{ id: 'alpha', items: ['a'] }]), ctx(homeWithClaude()), { packageId: 'yok' }), /yok/);
});

test('harness verilmezse yalnız algılananlar seçilir', () => {
  const selection = resolveSelection(data([{ id: 'alpha', items: ['a'] }]), ctx(homeWithClaude()));
  assert.deepEqual(selection.harnessIds, ['claude-code']);
});

test('açık harness listesi algılamayı ezer', () => {
  const selection = resolveSelection(data([{ id: 'alpha', items: ['a'] }]), ctx(homeWithClaude()), {
    harnessIds: ['codex'],
  });
  assert.deepEqual(selection.harnessIds, ['codex']);
});
