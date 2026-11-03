import assert from 'node:assert/strict'
import test from 'node:test'
import { shouldFocusNextRow } from '../src/components/EditableTable/tableLogic.ts'

test('Enter advances to the next ID only outside IME composition', () => {
  assert.equal(shouldFocusNextRow('Enter', false, 13), true)
  assert.equal(shouldFocusNextRow('Enter', true, 13), false)
  assert.equal(shouldFocusNextRow('Enter', false, 229), false)
  assert.equal(shouldFocusNextRow('Tab', false, 9), false)
})
