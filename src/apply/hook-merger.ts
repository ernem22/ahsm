import fs from 'node:fs';
import { applyEdits, modify, parse as parseJsonc, type ParseError } from 'jsonc-parser';

export interface HookSpec {
  event: string;
  matcher: string;
  command: string;
}

export interface HookEntry {
  matcher: string;
  hooks: Array<{ type: string; command: string }>;
}

/** Typed failure so the UI layer owns the message. */
export class HookConfigError extends Error {
  constructor() {
    super('hook target is not readable JSONC');
    this.name = 'HookConfigError';
  }
}

/** Turns `hooks.{event}` into the edit path `['hooks', 'PreToolUse']`. */
export function sectionPath(template: string, event: string): string[] {
  return template.replace('{event}', event).split('.').filter(Boolean);
}

function getAt(root: unknown, segments: string[]): unknown {
  let cursor: unknown = root;
  for (const segment of segments) {
    if (cursor === null || typeof cursor !== 'object') return undefined;
    cursor = (cursor as Record<string, unknown>)[segment];
  }
  return cursor;
}

/**
 * Adds one hook entry at `path` in a JSONC document, preserving comments and trailing commas.
 * Throws HookConfigError on an unparsable document so nothing is ever silently rewritten.
 */
export function mergeHook(
  text: string,
  path: string[],
  spec: HookSpec,
  previousCommand?: string,
): { changed: boolean; text: string; entry: HookEntry } {
  const source = text.trim().length > 0 ? text : '{}';

  const errors: ParseError[] = [];
  const root = parseJsonc(source, errors, { allowTrailingComma: true, disallowComments: false });
  if (errors.length > 0) throw new HookConfigError();

  const existing = getAt(root, path);
  const list = Array.isArray(existing) ? (existing as Array<Record<string, unknown>>) : [];
  const existingEntry = list.find(
    (entry) =>
      entry?.matcher === spec.matcher &&
      Array.isArray(entry?.hooks) &&
      (entry.hooks as Array<Record<string, unknown>>).some((hook) => hook?.command === spec.command),
  ) as HookEntry | undefined;
  if (existingEntry) return { changed: false, text, entry: existingEntry };

  // The entry we wrote before, now with a different command: replace it instead of leaving a twin.
  if (previousCommand && previousCommand !== spec.command) {
    const stale = list.find(
      (entry) =>
        entry?.matcher === spec.matcher &&
        Array.isArray(entry?.hooks) &&
        (entry.hooks as Array<Record<string, unknown>>).some((hook) => hook?.command === previousCommand),
    ) as HookEntry | undefined;
    if (stale) {
      const replaced: HookEntry = {
        matcher: spec.matcher,
        hooks: stale.hooks.map((hook) => (hook.command === previousCommand ? { ...hook, command: spec.command } : hook)),
      };
      const replacedIndex = list.indexOf(stale as unknown as Record<string, unknown>);
      const next = list.map((entry, index) => (index === replacedIndex ? replaced : entry));
      const replacementEdits = modify(source, path, next, {
        formattingOptions: { insertSpaces: true, tabSize: 2 },
      });
      return { changed: true, text: applyEdits(source, replacementEdits), entry: replaced };
    }
  }

  const added: HookEntry = { matcher: spec.matcher, hooks: [{ type: 'command', command: spec.command }] };
  const edits = modify(source, path, [...list, added], { formattingOptions: { insertSpaces: true, tabSize: 2 } });
  return { changed: true, text: applyEdits(source, edits), entry: added };
}

/** Removes our entry for this matcher+command; a document without it is returned untouched. */
export function removeHook(
  text: string,
  path: string[],
  spec: { matcher: string; command: string },
): { changed: boolean; text: string } {
  const source = text.trim().length > 0 ? text : '{}';
  const errors: ParseError[] = [];
  const root = parseJsonc(source, errors, { allowTrailingComma: true, disallowComments: false });
  if (errors.length > 0) throw new HookConfigError();

  const existing = getAt(root, path);
  const list = Array.isArray(existing) ? (existing as Array<Record<string, unknown>>) : [];
  const kept = list.filter(
    (entry) =>
      !(
        entry?.matcher === spec.matcher &&
        Array.isArray(entry?.hooks) &&
        (entry.hooks as Array<Record<string, unknown>>).some((hook) => hook?.command === spec.command)
      ),
  );
  if (kept.length === list.length) return { changed: false, text };

  // Removing the last entry should also remove the empty event array, not leave `"PreToolUse": []`.
  const value = kept.length === 0 ? undefined : kept;
  const edits = modify(source, path, value, { formattingOptions: { insertSpaces: true, tabSize: 2 } });
  return { changed: true, text: applyEdits(source, edits) };
}

export function readText(file: string): string {
  return fs.existsSync(file) ? fs.readFileSync(file, 'utf8') : '';
}
