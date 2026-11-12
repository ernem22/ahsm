import React from 'react';
import { Box, Text } from 'ink';
import { t } from '../i18n.js';
import { ReadBody, Reading } from './read-body.js';
import { STALE_HEADING, staleFrame } from './stale.js';
import type { StaleState } from './use-stale.js';

export interface StaleSurfaceProps {
  state: StaleState;
  width: number;
  height: number;
}

/**
 * `stale`, read-only: the provider's own update check as `staleLines` writes it, one row per recorded
 * skill, each led by its state word and carrying the provider's reason. `unknown` is its own row, never
 * folded into `up-to-date`; when no provider offers the check the surface says so instead of listing.
 * The read is the slow one, so it is named, timed and stoppable; `r` runs it again and no key writes.
 */
export function StaleSurface({ state, width, height }: StaleSurfaceProps): React.ReactElement {
  const room = Math.max(1, height - STALE_HEADING);
  return (
    <Box flexDirection="column">
      <Text dimColor>{t.tui.surfaces.stale}</Text>
      <ReadBody
        read={state.read}
        width={width}
        height={room}
        busy={<Reading what={t.tui.updateCheck} startedAt={state.read.startedAt} count={state.read.value?.rows.length} width={width} />}
        frame={() => staleFrame(state.body, state.filter, width, room, state.window)}
      />
    </Box>
  );
}
