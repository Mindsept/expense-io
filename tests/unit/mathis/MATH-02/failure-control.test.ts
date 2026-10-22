import { expect, test } from 'vitest'

// Temporary negative control: remove after GitHub proves this assertion blocks CI.
test('MATH-02 negative control deliberately makes the pipeline fail', () => {
  expect('deliberate red control').toBe('passing pipeline')
})
