import React from 'react';
import { Text } from 'ink';
import { t } from '../i18n.js';
import { toneColor, toneDim } from '../render.js';
import { useElapsed } from './elapsed.js';
import { wrap } from './format.js';
import type { ReadState } from './read.js';
import { Line, type BodyLine } from './rows-frame.js';

/** A slow read named and timed; the count joins it once a previous read knew it. */
export function Reading({
  what,
  startedAt,
  count,
  width,
}: {
  what: string;
  startedAt: number | undefined;
  count?: number;
  width: number;
}): React.ReactElement {
  const seconds = useElapsed(startedAt);
  return (
    <>
      {wrap(t.tui.reading(what, seconds, count), width).map((line, at) => (
        <Text key={at} dimColor>
          {line}
        </Text>
      ))}
    </>
  );
}

export interface ReadBodyProps {
  read: ReadState<unknown>;
  width: number;
  /** The lines the answer may use: a surface's frame is exactly this tall. */
  height: number;
  /** What the surface says while it waits; only the surface knows what its read is called. */
  busy: React.ReactElement;
  /** The body once the read answered. */
  frame(): BodyLine[];
}

/**
 * The four states every read has, stated once: a failure prints its own message, a stopped wait says the
 * provider may still be working, an answer becomes the surface's body, and anything else is the surface's
 * own line for the work it is waiting on. No surface re-derives this ladder.
 */
export function ReadBody({ read, width, height, busy, frame }: ReadBodyProps): React.ReactElement {
  if (read.status === 'error') {
    return (
      <>
        {wrap(read.message ?? '', width).map((line, at) => (
          <Text key={at} color={toneColor('error')} dimColor={toneDim('error')}>
            {line}
          </Text>
        ))}
      </>
    );
  }
  if (read.status === 'stopped') {
    return (
      <>
        {wrap(t.tui.stoppedWaiting, width).map((line, at) => (
          <Text key={at} color={toneColor('warning')} dimColor={toneDim('warning')}>
            {line}
          </Text>
        ))}
      </>
    );
  }
  if (read.status === 'done' && read.value !== undefined) {
    return (
      <>
        {frame()
          .slice(0, height)
          .map((cells, at) => (
            <Line key={at} cells={cells} />
          ))}
      </>
    );
  }
  return busy;
}
