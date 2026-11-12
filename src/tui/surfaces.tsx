import React from 'react';
import { Text } from 'ink';
import type { Plan } from '../core/plan.js';
import type { Data } from '../types.js';
import { t } from '../i18n.js';
import { InstallSurface } from './install-surface.js';
import type { InstallForm } from './install.js';
import type { SurfaceId } from './keys.js';
import { PlanSurface } from './plan-body.js';
import type { ReadState } from './read.js';
import type { RowWindow } from './window.js';

export interface SurfaceBodyProps {
  surface: SurfaceId;
  data: Data;
  install: InstallForm;
  width: number;
  /** The lines the body may use, so a body can pin its last line above the keybar. */
  height: number;
  plan: ReadState<Plan>;
  planWindow: RowWindow;
}

/** A surface whose body is not built yet prints its own name; it is an entry like any other. */
function Pending({ surface }: SurfaceBodyProps): React.ReactElement {
  return <Text>{t.tui.surfaces[surface]}</Text>;
}

/** One entry per surface: the next surface is a row here, never another branch. */
const BODIES: Record<SurfaceId, React.ComponentType<SurfaceBodyProps>> = {
  install: ({ data, install, width, height }) => (
    <InstallSurface data={data} form={install} width={width} height={height} />
  ),
  plan: ({ plan, width, height, planWindow }) => (
    <PlanSurface read={plan} width={width} height={height} window={planWindow} />
  ),
  status: Pending,
  list: Pending,
  stale: Pending,
  update: Pending,
  remove: Pending,
};

/** The body of the current surface: the table decides, and the shell only names the surface. */
export function SurfaceBody(props: SurfaceBodyProps): React.ReactElement | null {
  const Body = BODIES[props.surface];
  return <Body {...props} />;
}
