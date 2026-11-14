import React from 'react';
import { Box, Text } from 'ink';
import { t } from '../i18n.js';
import { removeOutcomeLines } from '../render.js';
import { Busy, Failed, Result } from './apply-body.js';
import { ReadBody, Reading } from './read-body.js';
import { REMOVE_HEADING, removeFrame } from './remove.js';
import type { RemoveState } from './use-remove.js';

export interface RemoveSurfaceProps {
  state: RemoveState;
  width: number;
  height: number;
}

/**
 * `x`, the one destructive surface: the plan as `removePlanLines` writes it — every entry with the
 * harnesses it affects, the paths it touches and the command it runs — printed before `y` means
 * anything, with the record consequence stated on its own line. `a` opens the skill-name mode, `n` and
 * `Esc` decline, and `y` hands the plan to the core exactly as `ahsm remove --yes` does. The
 * in-flight and result halves are the apply surface's own components, so a failure is a row and the
 * remaining entries still run.
 */
export function RemoveSurface({ state, width, height }: RemoveSurfaceProps): React.ReactElement {
  const room = Math.max(1, height - REMOVE_HEADING);
  const plan = state.plan;
  return (
    <Box flexDirection="column">
      <Text dimColor>{t.tui.surfaces.remove}</Text>
      {state.write.status === 'applying' ? (
        <Busy startedAt={state.write.startedAt} shape={state.write.shape} width={width} />
      ) : state.write.status === 'done' ? (
        <Result rows={removeOutcomeLines(state.write.outcome)} width={width} height={room} />
      ) : state.write.status === 'error' ? (
        <Failed message={state.write.message} width={width} />
      ) : (
        <ReadBody
          read={state.read}
          width={width}
          height={room}
          busy={<Reading what={t.tui.removeReading} startedAt={state.read.startedAt} width={width} />}
          frame={() => (plan ? removeFrame(plan, state.name, width, room, state.window) : [])}
        />
      )}
    </Box>
  );
}
