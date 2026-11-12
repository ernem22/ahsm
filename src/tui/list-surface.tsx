import React from 'react';
import { Box, Text } from 'ink';
import { t } from '../i18n.js';
import { listFrame, LIST_HEADING } from './list.js';
import { ReadBody, Reading } from './read-body.js';
import type { ListState } from './use-list.js';

export interface ListSurfaceProps {
  state: ListState;
  width: number;
  height: number;
}

/**
 * `list`, read-only: one formatter row per skill, windowed, with the window and the filter on the
 * heading line. The inventory read is the slow one, so it is named, timed and stoppable; `r` reads it
 * again, and no key here writes, so a visit never changes what it lists.
 */
export function ListSurface({ state, width, height }: ListSurfaceProps): React.ReactElement {
  const room = Math.max(1, height - LIST_HEADING);
  return (
    <Box flexDirection="column">
      <Text dimColor>{t.tui.surfaces.list}</Text>
      <ReadBody
        read={state.read}
        width={width}
        height={room}
        busy={<Reading what={t.tui.inventory} startedAt={state.read.startedAt} count={state.read.value?.rows.length} />}
        frame={() => listFrame(state.body, state.filter, width, room, state.window)}
      />
    </Box>
  );
}
