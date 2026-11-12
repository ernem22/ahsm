import React from 'react';
import type { Data } from '../types.js';
import { ApplyBody } from './apply-body.js';
import { InstallSurface } from './install-surface.js';
import type { SurfaceId } from './keys.js';
import { ListSurface } from './list-surface.js';
import { PlanSurface } from './plan-body.js';
import { RemoveSurface } from './remove-surface.js';
import { StaleSurface } from './stale-surface.js';
import { StatusSurface } from './status-surface.js';
import type { ApplyState } from './use-apply.js';
import type { InstallState } from './use-install.js';
import type { ListState } from './use-list.js';
import type { PlanState } from './use-plan.js';
import type { RemoveState } from './use-remove.js';
import type { StaleState } from './use-stale.js';
import type { StatusState } from './use-status.js';
import type { UpdateState } from './use-update.js';
import { UpdateSurface } from './update-surface.js';

/** What each surface's own hook returned: the shell hands a surface nothing of another surface's state. */
export interface SurfaceStates {
  install: InstallState;
  plan: PlanState;
  apply: ApplyState;
  status: StatusState;
  list: ListState;
  stale: StaleState;
  update: UpdateState;
  remove: RemoveState;
}

export interface SurfaceBodyProps {
  surface: SurfaceId;
  data: Data;
  states: SurfaceStates;
  width: number;
  /** The lines the body may use, so a body can pin its last line above the keybar. */
  height: number;
}

/** One entry per surface: the next surface is a row here, never another branch. */
const BODIES: Record<SurfaceId, (props: SurfaceBodyProps) => React.ReactElement> = {
  install: ({ data, states, width, height }) => <InstallSurface data={data} form={states.install.form} width={width} height={height} />,
  plan: ({ states, width, height }) => <PlanSurface state={states.plan} width={width} height={height} />,
  // The confirm is the plan body until the write resolves; then it is the result the core reported.
  apply: ({ states, width, height }) =>
    states.apply.state.status === 'idle' ? (
      <PlanSurface state={states.plan} width={width} height={height} />
    ) : (
      <ApplyBody write={states.apply.state} width={width} height={height} />
    ),
  status: ({ states, width, height }) => <StatusSurface state={states.status} width={width} height={height} />,
  list: ({ states, width, height }) => <ListSurface state={states.list} width={width} height={height} />,
  stale: ({ states, width, height }) => <StaleSurface state={states.stale} width={width} height={height} />,
  update: ({ states, width, height }) => <UpdateSurface state={states.update} width={width} height={height} />,
  remove: ({ states, width, height }) => <RemoveSurface state={states.remove} width={width} height={height} />,
};

/** The body of the current surface: the table decides, and the shell only names the surface. */
export function SurfaceBody(props: SurfaceBodyProps): React.ReactElement {
  return BODIES[props.surface](props);
}
