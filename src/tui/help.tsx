import React from 'react';
import { Box, Text } from 'ink';
import { truncate } from './format.js';
import { entryText, type KeyBinding } from './keys.js';

/** Every key of the surface it was opened on, in the keybar's own words, cut to the frame it sits in. */
export function HelpOverlay({ title, keys, width }: { title: string; keys: KeyBinding[]; width: number }): React.ReactElement {
  return (
    <Box flexDirection="column" marginTop={1}>
      <Text bold>{truncate(title, width)}</Text>
      {keys.map((binding) => (
        <Text key={binding.keys.join('+')}>{truncate(entryText(binding), width)}</Text>
      ))}
    </Box>
  );
}
