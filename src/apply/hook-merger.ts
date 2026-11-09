import fs from 'node:fs';
import { applyEdits, modify, parse as parseJsonc, type ParseError } from 'jsonc-parser';

export interface HookSpec {
  event: string;
  matcher: string;
  command: string;
}

/** Typed failure so the UI layer can render the message in the user's language. */
export class HookConfigError extends Error {
  readonly reason: 'unreadable' = 'unreadable';
  constructor() {
    super('hook target is not readable JSONC');
    this.name = 'HookConfigError';
  }
}

/** `hooks.{event}` → `['hooks', 'PreToolUse']`. */
export function sectionPath(section: string, event: string): string[] {
  return section
    .replace('{event}', event)
    .split('.')
    .filter(Boolean);
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
 * Adds one hook entry to a JSONC document, preserving comments and trailing commas.
 * Throws HookConfigError on an unparsable document so nothing is ever silently rewritten.
 */
export interface HookEntry {
  matcher: string;
  hooks: Array<{ type: string; command: string }>;
}

export function mergeHook(
  text: string,
  section: string,
  spec: HookSpec,
): { changed: boolean; text: string; entry: HookEntry } {
  const segments = sectionPath(section, spec.event);
  const source = text.trim().length > 0 ? text : '{}';

  const errors: ParseError[] = [];
  const root = parseJsonc(source, errors, { allowTrailingComma: true, disallowComments: false });
  if (errors.length > 0) throw new HookConfigError();

  const existing = getAt(root, segments);
  const list = Array.isArray(existing) ? (existing as Array<Record<string, unknown>>) : [];
  const existingEntry = list.find(
    (entry) =>
      entry?.matcher === spec.matcher &&
      Array.isArray(entry?.hooks) &&
      (entry.hooks as Array<Record<string, unknown>>).some((hook) => hook?.command === spec.command),
  ) as HookEntry | undefined;
  if (existingEntry) return { changed: false, text, entry: existingEntry };

  const added: HookEntry = { matcher: spec.matcher, hooks: [{ type: 'command', command: spec.command }] };
  const next = [...list, added];
  const edits = modify(source, segments, next, { formattingOptions: { insertSpaces: true, tabSize: 2 } });
  return { changed: true, text: applyEdits(source, edits), entry: added };
}

export function readText(file: string): string {
  return fs.existsSync(file) ? fs.readFileSync(file, 'utf8') : '';
}
