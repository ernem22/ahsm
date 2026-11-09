import React, { useEffect, useMemo, useState } from 'react';
import { Box, Text, render, useApp, useInput } from 'ink';
import type { Ctx } from '../context.js';
import { detectHarnesses } from '../core/detect.js';
import { buildPlan, type Plan } from '../core/plan.js';
import { applyPlan, type ApplyOutcome } from '../core/apply.js';
import { t } from '../i18n.js';
import { outcomeLines, planLines, toneColor } from '../render.js';
import type { Data } from '../types.js';

type Step = 'harness' | 'packages' | 'items' | 'planning' | 'plan' | 'applying' | 'done';

interface Props {
  data: Data;
  ctx: Ctx;
}

export function App({ data, ctx }: Props): React.ReactElement {
  const { exit } = useApp();
  const harnesses = useMemo(() => detectHarnesses(data, ctx), [data, ctx]);
  const detected = harnesses.filter((harness) => harness.present);
  const packages = useMemo(() => [...data.packages.values()], [data]);

  const [step, setStep] = useState<Step>('harness');
  const [harnessIndex, setHarnessIndex] = useState(0);
  const [selectedHarnesses, setSelectedHarnesses] = useState<Set<string>>(
    () => new Set(detected.map((harness) => harness.def.id)),
  );
  const [packageIndex, setPackageIndex] = useState(0);
  const [itemIndex, setItemIndex] = useState(0);
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [plan, setPlan] = useState<Plan | undefined>();
  const [outcome, setOutcome] = useState<ApplyOutcome | undefined>();
  const [error, setError] = useState<string | undefined>();

  const pkg = packages[packageIndex];
  const items = pkg ? pkg.items : [];
  const currentItem = items[itemIndex];

  useEffect(() => {
    if (step !== 'planning' || !pkg) return;
    let cancelled = false;
    buildPlan(data, ctx, { harnessIds: [...selectedHarnesses], itemIds: [...selected] })
      .then((result) => {
        if (!cancelled) {
          setPlan(result);
          setStep('plan');
        }
      })
      .catch((cause: unknown) => {
        if (!cancelled) {
          setError(cause instanceof Error ? cause.message : String(cause));
          setStep('items');
        }
      });
    return () => {
      cancelled = true;
    };
  }, [step]);

  useEffect(() => {
    if (step !== 'applying' || !plan) return;
    let cancelled = false;
    applyPlan(data, ctx, plan)
      .then((result) => {
        if (!cancelled) {
          setOutcome(result);
          setStep('done');
        }
      })
      .catch((cause: unknown) => {
        if (!cancelled) {
          setError(cause instanceof Error ? cause.message : String(cause));
          setStep('done');
        }
      });
    return () => {
      cancelled = true;
    };
  }, [step]);

  useInput((input, key) => {
    if (input === 'q') {
      exit();
      return;
    }
    if (step === 'harness') {
      if (key.upArrow) setHarnessIndex((index) => Math.max(0, index - 1));
      if (key.downArrow) setHarnessIndex((index) => Math.min(harnesses.length - 1, index + 1));
      if (input === ' ') {
        const target = harnesses[harnessIndex]?.def.id;
        if (target) {
          setSelectedHarnesses((previous) => {
            const next = new Set(previous);
            if (next.has(target)) next.delete(target);
            else next.add(target);
            return next;
          });
        }
      }
      if (input === 'a') {
        setSelectedHarnesses((previous) =>
          previous.size === harnesses.length ? new Set() : new Set(harnesses.map((harness) => harness.def.id)),
        );
      }
      if (key.return && selectedHarnesses.size > 0) setStep('packages');
      return;
    }
    if (step === 'packages') {
      if (key.upArrow) setPackageIndex((index) => Math.max(0, index - 1));
      if (key.downArrow) setPackageIndex((index) => Math.min(packages.length - 1, index + 1));
      if (key.return && pkg) {
        setSelected(new Set(pkg.items));
        setItemIndex(0);
        setStep('items');
      }
      return;
    }
    if (step === 'items') {
      if (key.upArrow) setItemIndex((index) => Math.max(0, index - 1));
      if (key.downArrow) setItemIndex((index) => Math.min(items.length - 1, index + 1));
      if (input === ' ' && currentItem) {
        setSelected((previous) => {
          const next = new Set(previous);
          if (next.has(currentItem)) next.delete(currentItem);
          else next.add(currentItem);
          return next;
        });
      }
      if (key.escape || key.leftArrow) setStep('packages');
      if (key.return && selected.size > 0) setStep('planning');
      return;
    }
    if (step === 'plan') {
      if (input === 'y') setStep('applying');
      if (input === 'n' || key.escape || key.leftArrow) setStep('items');
      return;
    }
    if (step === 'done' && (key.return || key.escape)) exit();
  });

  const targetLine =
    selectedHarnesses.size > 0
      ? harnesses
          .filter((harness) => selectedHarnesses.has(harness.def.id))
          .map((harness) => harness.def.label ?? harness.def.id)
          .join(', ')
      : t.noHarness;

  return (
    <Box flexDirection="column" paddingX={1}>
      <Text bold>{t.title}</Text>
      <Text dimColor>{`${t.target}: ${targetLine}`}</Text>

      {step === 'harness' && (
        <Box flexDirection="column" marginTop={1}>
          <Text bold>{t.harnesses}</Text>
          {harnesses.map((harness, index) => (
            <Text key={harness.def.id} color={index === harnessIndex ? 'cyan' : undefined}>
              {`${selectedHarnesses.has(harness.def.id) ? '[x]' : '[ ]'} ${harness.def.label ?? harness.def.id}${
                harness.present ? '' : ` (${t.notDetected})`
              }`}
            </Text>
          ))}
          <Text dimColor>{t.keysHarness.join(' · ')}</Text>
        </Box>
      )}

      {step === 'packages' && (
        <Box flexDirection="column" marginTop={1}>
          <Text bold>{t.packages}</Text>
          {packages.map((entry, index) => (
            <Box key={entry.id} flexDirection="column">
              <Text color={index === packageIndex ? 'cyan' : undefined}>
                {`${index === packageIndex ? '❯ ' : '  '}${entry.id}`}
              </Text>
              {entry.note ? <Text dimColor>{`    ${entry.note}`}</Text> : null}
              {entry.link ? <Text dimColor>{`    ${entry.link}`}</Text> : null}
            </Box>
          ))}
          <Text dimColor>{t.keysPackages.join(' · ')}</Text>
        </Box>
      )}

      {step === 'items' && pkg && (
        <Box flexDirection="column" marginTop={1}>
          <Text bold>{`${t.selectionLabel}: ${pkg.id}`}</Text>
          {items.map((itemId, index) => {
            const item = data.items.get(itemId);
            return (
              <Box key={itemId} flexDirection="column">
                <Text color={index === itemIndex ? 'cyan' : undefined}>
                  {`${selected.has(itemId) ? '[x]' : '[ ]'} ${itemId}  (${item?.kind ?? '?'})`}
                </Text>
                {item?.note && index === itemIndex ? <Text dimColor>{`      ${item.note}`}</Text> : null}
              </Box>
            );
          })}
          {error ? <Text color="red">{error}</Text> : null}
          <Text dimColor>{t.keysItems.join(' · ')}</Text>
        </Box>
      )}

      {step === 'planning' && <Text dimColor>{t.planBuilding}</Text>}

      {step === 'plan' && plan && (
        <Box flexDirection="column" marginTop={1}>
          <Text bold>{t.planTitle}</Text>
          {planLines(plan).map((line, index) => (
            <Text key={index} color={toneColor(line.tone)} dimColor={line.tone === 'dim'}>
              {line.text}
            </Text>
          ))}
          <Text dimColor>{t.keysPlan.join(' · ')}</Text>
        </Box>
      )}

      {step === 'applying' && <Text dimColor>{t.applying}</Text>}

      {step === 'done' && (
        <Box flexDirection="column" marginTop={1}>
          <Text bold>{t.resultTitle}</Text>
          {(outcome ? outcomeLines(outcome) : []).map((line, index) => (
            <Text key={index} color={toneColor(line.tone)}>
              {line.text}
            </Text>
          ))}
          {error ? <Text color="red">{error}</Text> : null}
          <Text dimColor>{t.keysDone.join(' · ')}</Text>
        </Box>
      )}
    </Box>
  );
}

export async function renderApp(data: Data, ctx: Ctx): Promise<void> {
  const instance = render(<App data={data} ctx={ctx} />);
  await instance.waitUntilExit();
}
