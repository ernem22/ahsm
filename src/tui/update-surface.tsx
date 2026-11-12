import React from 'react';
import { Box, Text } from 'ink';
import { t } from '../i18n.js';
import { updateLines, updateOutcomeLines, type Line } from '../render.js';
import { Busy, Failed, LineText, Result, wrapped } from './apply-body.js';
import { ReadBody, Reading } from './read-body.js';
import { UPDATE_HEADING, updateFrame } from './update.js';
import type { UpdateState } from './use-update.js';

/** The formatter's warnings, which `updateOutcomeLines` does not repeat: the result keeps them first. */
function warningLines(update: NonNullable<UpdateState['value']>): Line[] {
  return updateLines(update).slice(0, update.warnings.length);
}

/** The warnings and the skips: what the update cannot act on, printed before the plan and the installs. */
function noteLines(update: NonNullable<UpdateState['value']>): Line[] {
  return updateLines(update).slice(0, update.warnings.length + update.skips.length);
}

export interface UpdateSurfaceProps {
  state: UpdateState;
  width: number;
  height: number;
}

/**
 * `u`: the plan that reinstalls exactly the skills the provider marked stale, then the shared busy and
 * result halves once `y` runs it. The skips and warnings stay printed above both — a stale skill the
 * update cannot act on is never dropped — and no row or message is worded here: `updateLines` and
 * `updateOutcomeLines` own every sentence.
 */
export function UpdateSurface({ state, width, height }: UpdateSurfaceProps): React.ReactElement {
  const room = Math.max(1, height - UPDATE_HEADING);
  const update = state.value;
  return (
    <Box flexDirection="column">
      <Text dimColor>{t.tui.surfaces.update}</Text>
      {state.write.status === 'applying' ? (
        <Box flexDirection="column">
          {update ? wrapped(noteLines(update), width).map((line, at) => <LineText key={at} line={line} />) : null}
          <Busy startedAt={state.write.startedAt} shape={state.write.shape} />
        </Box>
      ) : state.write.status === 'done' ? (
        <Result
          rows={update ? [...warningLines(update), ...updateOutcomeLines(update, state.write.outcome)] : []}
          width={width}
          height={room}
        />
      ) : state.write.status === 'error' ? (
        <Failed message={state.write.message} width={width} />
      ) : (
        <ReadBody
          read={state.read}
          width={width}
          height={room}
          busy={<Reading what={t.tui.updateCheck} startedAt={state.read.startedAt} count={state.value?.stale.length} />}
          frame={() => (update ? updateFrame(update, width, room, state.window) : [])}
        />
      )}
    </Box>
  );
}
