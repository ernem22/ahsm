import React from 'react';
import { Box, Text } from 'ink';
import type { StatusReport } from '../core/status.js';
import { t } from '../i18n.js';
import { toneColor } from '../render.js';
import { wrap } from './format.js';
import type { ReadState } from './read.js';
import { Line } from './rows-frame.js';
import { STATUS_HEADING, statusBody, statusFrame } from './status.js';
import type { RowWindow } from './window.js';

export interface StatusSurfaceProps {
  read: ReadState<StatusReport>;
  width: number;
  height: number;
  /** The row window: `Up`/`Down`, the page keys and `g`/`G` move it. */
  window: RowWindow;
}

/**
 * `status`, read-only: the harness section and the item section in the words `statusLines` gives them,
 * one row per line, the focused row whole in the detail column. `r` reads the report again; no key here
 * writes, so a visit can never change what it reports.
 */
export function StatusSurface({ read, width, height, window }: StatusSurfaceProps): React.ReactElement {
  return (
    <Box flexDirection="column">
      <Text dimColor>{t.tui.surfaces.status}</Text>
      {read.status === 'error' ? (
        wrap(read.message ?? '', width).map((line, at) => (
          <Text key={at} color={toneColor('error')}>
            {line}
          </Text>
        ))
      ) : read.status === 'done' && read.value ? (
        statusFrame(statusBody(read.value), width, Math.max(1, height - STATUS_HEADING), window.index).map((cells, at) => (
          <Line key={at} cells={cells} />
        ))
      ) : (
        <Text dimColor>{t.tui.statusReading}</Text>
      )}
    </Box>
  );
}
