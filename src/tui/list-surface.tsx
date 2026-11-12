import React from 'react';
import { Box, Text } from 'ink';
import type { SkillInventoryReport } from '../core/list.js';
import { t } from '../i18n.js';
import { toneColor } from '../render.js';
import { useElapsed } from './elapsed.js';
import { wrap } from './format.js';
import { listFrame, LIST_HEADING, type ListBody, type ListFilter } from './list.js';
import type { ReadState } from './read.js';
import { Line } from './rows-frame.js';
import type { RowWindow } from './window.js';

export interface ListSurfaceProps {
  read: ReadState<SkillInventoryReport>;
  /** The filtered inventory: what the rows and the counts are made of. */
  body: ListBody;
  filter: ListFilter;
  width: number;
  height: number;
  /** The row window: `Up`/`Down`, the page keys and `g`/`G` move it. */
  window: RowWindow;
}

/** The slow read named and timed; the count joins it once a previous read knew it. */
function Reading({ startedAt, count }: { startedAt: number | undefined; count: number | undefined }): React.ReactElement {
  const seconds = useElapsed(startedAt);
  return <Text dimColor>{t.tui.listReading(seconds, count)}</Text>;
}

/**
 * `list`, read-only: one formatter row per skill, windowed, with the window and the filter on the
 * heading line. The inventory read is the slow one, so it is named, timed and stoppable; `r` reads it
 * again, and no key here writes, so a visit never changes what it lists.
 */
export function ListSurface({ read, body, filter, width, height, window }: ListSurfaceProps): React.ReactElement {
  return (
    <Box flexDirection="column">
      <Text dimColor>{t.tui.surfaces.list}</Text>
      {read.status === 'error' ? (
        wrap(read.message ?? '', width).map((line, at) => (
          <Text key={at} color={toneColor('error')}>
            {line}
          </Text>
        ))
      ) : read.status === 'stopped' ? (
        <Text color={toneColor('warning')}>{t.tui.listStopped}</Text>
      ) : read.status === 'done' ? (
        listFrame(body, filter, width, Math.max(1, height - LIST_HEADING), window).map((cells, at) => (
          <Line key={at} cells={cells} />
        ))
      ) : (
        <Reading startedAt={read.startedAt} count={read.value?.rows.length} />
      )}
    </Box>
  );
}
