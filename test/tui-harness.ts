import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { PassThrough, Writable } from 'node:stream';
import { fileURLToPath } from 'node:url';
import React from 'react';
import { render } from 'ink';
import { createContext, RecordingRunner, type Ctx } from '../src/context.js';
import { loadData } from '../src/data.js';
import { t } from '../src/i18n.js';
import { App } from '../src/tui/App.js';
import type { Data } from '../src/types.js';

const here = path.dirname(fileURLToPath(import.meta.url));

/** The offline data root the e2e scripts use: one fake harness, two packages, no network. */
export const OFFLINE_ROOT = path.join(here, 'fixtures', 'offline');

/** Escape sequences Ink emits for colour, bold and dim; the frame is asserted as plain text. */
const ANSI = /\u001B\[[0-9;?]*[ -/]*[@-~]/g;

export function stripAnsi(text: string): string {
  return text.replace(ANSI, '');
}

/** The window a frame was laid out for: exactly `rows` lines, no line wider than `width`, header first. */
export interface FrameExpectation {
  width: number;
  rows: number;
}

/**
 * What every frame owes a terminal: no line may leave it, the header must not scroll away, and the
 * body must not grow past the window its keybar is pinned to.
 */
export function expectFrame(lines: string[], expected: FrameExpectation): void {
  assert.equal(lines.length, expected.rows, `the frame has ${lines.length} lines, not ${expected.rows}`);
  for (const line of lines) assert.ok(line.length <= expected.width, `${line.length} > ${expected.width}: ${line}`);
  assert.ok((lines[0] ?? '').startsWith(t.title), `the first line is not the header: ${lines[0]}`);
}

/** Captures one chunk per rendered frame; `columns` and `rows` are the window the frame is laid out for. */
export class CapturingStdout extends Writable {
  readonly chunks: string[] = [];
  readonly columns: number;
  readonly rows: number;
  isTTY = false;

  constructor(columns: number, rows = 30) {
    super();
    this.columns = columns;
    this.rows = rows;
  }

  override _write(chunk: unknown, _encoding: BufferEncoding, done: (error?: Error | null) => void): void {
    this.chunks.push(String(chunk));
    done();
  }
}

/** A keyboard with the TTY bits stubbed: Ink reads it, so a test writes keys instead of a user. */
class FakeStdin extends PassThrough {
  isTTY = true;
  setRawMode(): void {}
}

/** A lone Escape is not a keypress Ink dispatches at once: its parser buffers one for its own 20 ms. */
const LONE_ESCAPE = '\u001B';
/** Upper bound for that buffered key to arrive; the wait ends the moment its frame does. */
const ESCAPE_FLUSH_TIMEOUT_MS = 250;

export interface TuiOptions {
  data: Data;
  ctx: Ctx;
  width: number;
  rows?: number;
}

export interface TuiHarness {
  /** The last rendered frame, ANSI stripped. */
  frame(): string;
  /** The last frame as lines with trailing blanks trimmed. */
  lines(): string[];
  press(...keys: string[]): Promise<void>;
  /** Settles when the app leaves, which never happens on its own. */
  waitUntilExit(): Promise<void>;
  stop(): Promise<void>;
}

export async function startTui(options: TuiOptions): Promise<TuiHarness> {
  const stdout = new CapturingStdout(options.width, options.rows ?? 30);
  const stdin = new FakeStdin();
  const instance = render(React.createElement(App, { data: options.data, ctx: options.ctx }), {
    stdin,
    stdout,
    stderr: new CapturingStdout(options.width),
    debug: true,
    patchConsole: false,
    exitOnCtrlC: false,
  });
  await instance.waitUntilRenderFlush();

  /**
   * Every frame Ink flushed, in order, ANSI stripped. `waitUntilRenderFlush()` brackets each frame with
   * an empty chunk of its own, and that barrier is the only chunk dropped here: a frame that renders
   * nothing but blank lines is a frame, so it must not read as the one before it.
   */
  const frames = (): string[] => stdout.chunks.filter((chunk) => chunk !== '').map(stripAnsi);
  const frame = (): string => frames()[frames().length - 1] ?? '';

  /** Waits for what a timer or a render will make true; the deadline bounds a key that does nothing. */
  const until = async (done: () => boolean): Promise<void> => {
    const deadline = Date.now() + ESCAPE_FLUSH_TIMEOUT_MS;
    while (!done() && Date.now() < deadline) await new Promise((resolve) => setTimeout(resolve, 5));
  };

  return {
    frame,
    lines: () => frame().split('\n').map((line) => line.replace(/\s+$/, '')),
    async press(...keys) {
      for (const key of keys) {
        const before = frames().length;
        stdin.write(key);
        await instance.waitUntilRenderFlush();
        if (key === LONE_ESCAPE) {
          // Ink emits it when its own timer fires, so wait for that frame rather than guess a delay.
          await until(() => frames().length > before);
          await instance.waitUntilRenderFlush();
        }
      }
    },
    async waitUntilExit() {
      await instance.waitUntilExit();
    },
    async stop() {
      instance.unmount();
      await instance.waitUntilExit();
    },
  };
}

/** A disposable home; `detected: true` plants the fixture harness's detect path in it. */
export function fixtureHome(detected = false): string {
  const home = fs.mkdtempSync(path.join(os.tmpdir(), 'agentenv-tui-'));
  if (detected) fs.mkdirSync(path.join(home, '.fake'), { recursive: true });
  return home;
}

/** The real app's data and context, pointed at the offline fixtures and a fake home. */
export function fixture(detected = false, root = OFFLINE_ROOT): { data: Data; ctx: Ctx } {
  const home = fixtureHome(detected);
  return {
    data: loadData(root),
    ctx: createContext({ home, root, runner: new RecordingRunner() }),
  };
}
