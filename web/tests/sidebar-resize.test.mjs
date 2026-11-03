import assert from 'node:assert/strict'
import test from 'node:test'
import {
  SIDEBAR_DEFAULT_WIDTH,
  sidebarMaxWidth,
  clampSidebarWidth,
  sidebarWidthForKey,
} from '../src/components/Sidebar/sidebarResize.ts'

test('width is limited and leaves space on small screens', () => {
  assert.equal(sidebarMaxWidth(1200), 480)
  assert.equal(sidebarMaxWidth(320), 264)
  assert.equal(clampSidebarWidth(100, 480), 192)
  assert.equal(clampSidebarWidth(900, 480), 480)
  assert.equal(clampSidebarWidth(SIDEBAR_DEFAULT_WIDTH, 144), 144)
})

test('keyboard resizing moves in steps and respects both bounds', () => {
  assert.equal(sidebarWidthForKey('ArrowLeft', 280, 480), 264)
  assert.equal(sidebarWidthForKey('ArrowRight', 280, 480), 296)
  assert.equal(sidebarWidthForKey('Home', 280, 480), 192)
  assert.equal(sidebarWidthForKey('End', 280, 480), 480)
  assert.equal(sidebarWidthForKey('ArrowRight', 480, 480), 480)
  assert.equal(sidebarWidthForKey('ArrowLeft', 192, 480), 192)
  assert.equal(sidebarWidthForKey('Enter', 280, 480), null)
})
