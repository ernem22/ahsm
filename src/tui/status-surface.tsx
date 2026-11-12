import React from 'react';
import { Box, Text } from 'ink';
import { t } from '../i18n.js';
import { ReadBody, Reading } from './read-body.js';
import { STATUS_HEADING, statusFrame } from './status.js';
import type { StatusState } from './use-status.js';

export interface StatusSurfaceProps {
  state: StatusState;
  width: number;
  height: number;
}

/**
 * `status`, read-only: the harness section and the item section in the words `statusLines` gives them,
 * one row per line, the focused row whole in the detail column. The read spawns a version check per
 * harness, so it is named, timed and stoppable like the other slow reads; `r` reads it again and no key
 * here writes.
 */
export function StatusSurface({ state, width, height }: StatusSurfaceProps): React.ReactElement {
  const room = Math.max(1, height - STATUS_HEADING);
  return (
    <Box flexDirection="column">
      <Text dimColor>{t.tui.surfaces.status}</Text>
      <ReadBody
        read={state.read}
        width={width}
        height={room}
        busy={<Reading what={t.tui.surfaces.status} startedAt={state.read.startedAt} width={width} />}
        frame={() => statusFrame(state.body, width, room, state.window.index)}
      />
    </Box>
  );
}
