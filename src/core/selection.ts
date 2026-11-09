import type { Ctx } from '../context.js';
import { detectHarnesses } from './detect.js';
import { t } from '../i18n.js';
import type { Data, Selection } from '../types.js';

export interface SelectionRequest {
  packageId?: string;
  harnessIds?: string[];
}

/** A package marked `default: true` wins; otherwise the first id in data order. Never a code literal. */
export function defaultPackageId(data: Data): string | undefined {
  const marked = [...data.packages.values()]
    .filter((pkg) => pkg.default)
    .map((pkg) => pkg.id)
    .sort();
  return marked[0] ?? [...data.packages.keys()].sort()[0];
}

export function resolveSelection(data: Data, ctx: Ctx, request: SelectionRequest = {}): Selection {
  const packageId = request.packageId ?? defaultPackageId(data);
  if (!packageId) throw new Error(t.noPackages);
  const pkg = data.packages.get(packageId);
  if (!pkg) throw new Error(t.packageNotFound(packageId));

  const harnessIds =
    request.harnessIds && request.harnessIds.length > 0
      ? request.harnessIds
      : detectHarnesses(data, ctx)
          .filter((harness) => harness.present)
          .map((harness) => harness.def.id);

  return { harnessIds, itemIds: pkg.items };
}
