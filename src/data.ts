import fs from 'node:fs';
import path from 'node:path';
import { parse } from 'yaml';
import type { Data, HarnessDef, ItemDef, PackageDef, ProviderDef, RequirementDef } from './types.js';

function readDir<T>(root: string, dir: string): T[] {
  const full = path.join(root, dir);
  if (!fs.existsSync(full)) return [];
  return fs
    .readdirSync(full)
    .filter((file) => file.endsWith('.yaml') || file.endsWith('.yml'))
    .map((file) => parse(fs.readFileSync(path.join(full, file), 'utf8')) as T);
}

function index<T extends { id: string }>(rows: T[], label: string): Map<string, T> {
  const map = new Map<string, T>();
  for (const row of rows) {
    if (!row?.id) throw new Error(`${label}: definition has no id`);
    if (map.has(row.id)) throw new Error(`${label}: duplicate id "${row.id}"`);
    map.set(row.id, row);
  }
  return map;
}

/** Loads every data directory under the package root. No harness or item name is known to code. */
export function loadData(root: string): Data {
  return {
    items: index(readDir<ItemDef>(root, 'catalog'), 'catalog'),
    packages: index(readDir<PackageDef>(root, 'packages'), 'packages'),
    harnesses: readDir<HarnessDef>(root, 'harnesses'),
    providers: readDir<ProviderDef>(root, 'providers'),
    requires: readDir<RequirementDef>(root, 'requires'),
  };
}
