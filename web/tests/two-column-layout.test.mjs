import assert from 'node:assert/strict'
import test from 'node:test'
import {
  clampColumnWidth,
  columnBounds,
  columnWidthForKey,
  positiveWidth,
} from '../src/components/TwoColumnLayout/columnResize.ts'

test('layout stacks until both minimum widths and divider fit', () => {
  assert.equal(columnBounds(495, 240, 240), null)
  assert.deepEqual(columnBounds(496, 240, 240), { min: 240, max: 240 })
  assert.deepEqual(columnBounds(900, 240, 240), { min: 240, max: 644 })
})

test('width is clamped to protect both columns', () => {
  assert.equal(clampColumnWidth(10, 240, 644), 240)
  assert.equal(clampColumnWidth(1000, 240, 644), 644)
  assert.equal(clampColumnWidth(321.6, 240, 644), 322)
  assert.equal(positiveWidth(Number.NaN, 240), 240)
  assert.equal(positiveWidth(-10, 240), 240)
})

test('keyboard controls adjust width and respect both limits', () => {
  assert.equal(columnWidthForKey('ArrowLeft', 400, 240, 644), 384)
  assert.equal(columnWidthForKey('ArrowRight', 400, 240, 644), 416)
  assert.equal(columnWidthForKey('Home', 400, 240, 644), 240)
  assert.equal(columnWidthForKey('End', 400, 240, 644), 644)
  assert.equal(columnWidthForKey('ArrowLeft', 240, 240, 644), 240)
  assert.equal(columnWidthForKey('ArrowRight', 644, 240, 644), 644)
  assert.equal(columnWidthForKey('Enter', 400, 240, 644), null)
})
