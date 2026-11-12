import React from 'react';
import { Box, Text } from 'ink';
import type { StaleReport } from '../core/stale.js';
import { t } from '../i18n.js';
import { toneColor } from '../render.js';
import { useElapsed } from './elapsed.js';
import { wrap } from './format.js';
import type { ReadState } from './read.js';
import { Line } from './rows-frame.js';
import { STALE_HEADING, staleFrame, type StaleBody, type StaleFilter } from './stale.js';
import type { RowWindow } from './window.js';

export interface StaleSurfaceProps {
  read: ReadState<StaleReport>;
  /** The filtered report: what the rows and their counts are made of. */
  body: StaleBody;
  filter: StaleFilter;
  width: number;
  height: number;
  /** The row window: `Up`/`Down`, the page keys and `g`/`G` move it. */
  window: RowWindow;
}

/** The slow read named and timed; the count joins it once a previous read knew it. */
function Checking({ startedAt, count }: { startedAt: number | undefined; count: number | undefined }): React.ReactElement {
  const seconds = useElapsed(startedAt);
  return <Text dimColor>{t.tui.reading(t.tui.updateCheck, seconds, count)}</Text>;
}

/**
 * `stale`, read-only: the provider's own update check as `staleLines` writes it, one row per recorded
 * skill, each led by its state word and carrying the provider's reason. `unknown` is its own row, never
 * folded into `up-to-date`; when no provider offers the check the surface says so instead of listing.
 * The read is the slow one, so it is named, timed and stoppable; `r` runs it again and no key writes.
 */
export function StaleSurface({ read, body, filter, width, height, window }: StaleSurfaceProps): React.ReactElement {
  return (
    <Box flexDirection="column">
      <Text dimColor>{t.tui.surfaces.stale}</Text>
      {read.status === 'error' ? (
        wrap(read.message ?? '', width).map((line, at) => (
          <Text key={at} color={toneColor('error')}>
            {line}
          </Text>
        ))
      ) : read.status === 'stopped' ? (
        <Text color={toneColor('warning')}>{t.tui.stoppedWaiting}</Text>
      ) : read.status === 'done' ? (
        staleFrame(body, filter, width, Math.max(1, height - STALE_HEADING), window).map((cells, at) => (
          <Line key={at} cells={cells} />
        ))
      ) : (
        <Checking startedAt={read.startedAt} count={read.value?.rows.length} />
      )}
    </Box>
  );
}
