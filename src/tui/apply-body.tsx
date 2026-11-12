import React, { useEffect, useState } from 'react';
import { Box, Text } from 'ink';
import type { ApplyOutcome } from '../core/apply.js';
import { t } from '../i18n.js';
import { outcomeLines, toneColor, type Line } from '../render.js';
import type { ApplyShape, WriteState } from './apply.js';
import { wrap } from './format.js';

const SECOND_MS = 1000;

/** Real seconds since the write started: one interval, no animation, nothing invented between ticks. */
function useElapsed(startedAt: number | undefined): number {
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    if (startedAt === undefined) return undefined;
    const timer = setInterval(() => setNow(Date.now()), SECOND_MS);
    return () => clearInterval(timer);
  }, [startedAt]);
  return startedAt === undefined ? 0 : Math.max(0, Math.floor((now - startedAt) / SECOND_MS));
}

function LineText({ line }: { line: Line }): React.ReactElement {
  return (
    <Text color={toneColor(line.tone)} dimColor={line.tone === 'dim'}>
      {line.text}
    </Text>
  );
}

/** The rows that fit the window; the ones that do not are counted, never silently dropped. */
function fit(rows: Line[], height: number): Line[] {
  if (rows.length <= height) return rows;
  const kept = rows.slice(0, Math.max(0, height - 1));
  return [...kept, { text: t.tui.moreRows(rows.length - kept.length), tone: 'dim' }];
}

function wrapped(lines: Line[], width: number): Line[] {
  return lines.flatMap((line) => wrap(line.text, width).map((text) => ({ text, tone: line.tone })));
}

/** In flight: the work named, the shape counted from the plan, and the one thing that is true beside it. */
function Busy({ startedAt, shape }: { startedAt: number; shape: ApplyShape }): React.ReactElement {
  const seconds = useElapsed(startedAt);
  return (
    <Box flexDirection="column">
      <Text dimColor>{t.tui.applying(seconds)}</Text>
      <Text dimColor>{t.tui.applyShape(shape.installs, shape.hooks, shape.blocked)}</Text>
      <Text> </Text>
      <Text dimColor>{t.tui.applyNothingElse}</Text>
    </Box>
  );
}

/** The result: the formatter's own rows, in its own order, with no verdict of ours on top of them. */
function Result({
  outcome,
  width,
  height,
}: {
  outcome: ApplyOutcome;
  width: number;
  height: number;
}): React.ReactElement {
  const rows = fit(wrapped(outcomeLines(outcome), width), Math.max(0, height - 1));
  return (
    <Box flexDirection="column">
      <Text bold>{t.tui.resultTitle}</Text>
      {rows.map((line, at) => (
        <LineText key={at} line={line} />
      ))}
    </Box>
  );
}

/** A write that rejected instead of reporting: the same exit screen, with the message the core threw. */
function Failed({ message, width }: { message: string; width: number }): React.ReactElement {
  return (
    <Box flexDirection="column">
      <Text bold>{t.tui.resultTitle}</Text>
      {wrapped([{ text: message, tone: 'error' }], width).map((line, at) => (
        <LineText key={at} line={line} />
      ))}
    </Box>
  );
}

export interface ApplyBodyProps {
  write: WriteState;
  width: number;
  height: number;
}

/** The two halves before and after the write; the confirm half stays the plan body. */
export function ApplyBody({ write, width, height }: ApplyBodyProps): React.ReactElement | null {
  if (write.status === 'applying') return <Busy startedAt={write.startedAt} shape={write.shape} />;
  if (write.status === 'done') return <Result outcome={write.outcome} width={width} height={height} />;
  if (write.status === 'error') return <Failed message={write.message} width={width} />;
  return null;
}
