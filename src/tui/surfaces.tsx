import React from 'react';
import { Text } from 'ink';
import type { Plan } from '../core/plan.js';
import type { SkillInventoryReport } from '../core/list.js';
import type { StaleReport } from '../core/stale.js';
import type { StatusReport } from '../core/status.js';
import type { Data } from '../types.js';
import { t } from '../i18n.js';
import { ApplyBody } from './apply-body.js';
import type { WriteState } from './apply.js';
import { InstallSurface } from './install-surface.js';
import type { InstallForm } from './install.js';
import type { SurfaceId } from './keys.js';
import { ListSurface } from './list-surface.js';
import type { ListBody, ListFilter } from './list.js';
import { PlanSurface } from './plan-body.js';
import type { ReadState } from './read.js';
import { StaleSurface } from './stale-surface.js';
import type { StaleBody, StaleFilter } from './stale.js';
import { StatusSurface } from './status-surface.js';
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
  /** The report `status` read, and the window its rows are shown through. */
  status: ReadState<StatusReport>;
  statusWindow: RowWindow;
  /** The inventory `list` read, the body its filter built, and the window those rows move through. */
  list: ReadState<SkillInventoryReport>;
  listBody: ListBody;
  listFilter: ListFilter;
  listWindow: RowWindow;
  /** The freshness check `stale` read, the body its filters built, and the window those rows move through. */
  stale: ReadState<StaleReport>;
  staleBody: StaleBody;
  staleFilter: StaleFilter;
  staleWindow: RowWindow;
  /** The requirement ids the user marked: the plan body prints them and the confirm hands them on. */
  marked: readonly string[];
  /** The requirement row the focus is on, when it is below the last entry. */
  requirementFocus: number | undefined;
  /** What the apply has done so far: nothing, in flight, or the result the core reported. */
  write: WriteState;
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
  plan: ({ plan, width, height, planWindow, marked, requirementFocus }) => (
    <PlanSurface read={plan} width={width} height={height} window={planWindow} marked={marked} requirementFocus={requirementFocus} />
  ),
  apply: ({ plan, width, height, planWindow, marked, requirementFocus, write }) =>
    write.status === 'idle' ? (
      <PlanSurface read={plan} width={width} height={height} window={planWindow} marked={marked} requirementFocus={requirementFocus} />
    ) : (
      <ApplyBody write={write} width={width} height={height} />
    ),
  status: ({ status, width, height, statusWindow }) => (
    <StatusSurface read={status} width={width} height={height} window={statusWindow} />
  ),
  list: ({ list, listBody, listFilter, listWindow, width, height }) => (
    <ListSurface read={list} body={listBody} filter={listFilter} width={width} height={height} window={listWindow} />
  ),
  stale: ({ stale, staleBody: body, staleFilter, staleWindow, width, height }) => (
    <StaleSurface read={stale} body={body} filter={staleFilter} width={width} height={height} window={staleWindow} />
  ),
  update: Pending,
  remove: Pending,
};

/** The body of the current surface: the table decides, and the shell only names the surface. */
export function SurfaceBody(props: SurfaceBodyProps): React.ReactElement | null {
  const Body = BODIES[props.surface];
  return <Body {...props} />;
}
