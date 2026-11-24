'use strict';

/** Logical square stage size matching src/shared/config.ts */
const STAGE_SIZE = 360;

/** Hit box inside the 360x360 logical canvas */
const HIT_BOX = { x0: 88, y0: 56, x1: 272, y1: 334 };

/** 60ms cursor polling loop interval (ms) */
const POINTER_POLL_MS = 60;

/** Hold non-ignoring state for 400ms after leaving body to prevent edge jitter */
const OFF_BODY_RELEASE_MS = 400;

/**
 * Compute screen-space hit rect for the catgirl body inside a padded transparent window.
 */
function spriteHitRect(bounds, margins) {
  const ml = Number.isFinite(margins?.l) ? margins.l : Math.round(bounds.width * 0.25);
  const mt = Number.isFinite(margins?.t) ? margins.t : Math.round(bounds.height * 0.25);
  const mr = Number.isFinite(margins?.r) ? margins.r : ml;
  const stageSize = Math.max(0, bounds.width - ml - mr);
  return {
    left: bounds.x + ml + (HIT_BOX.x0 / STAGE_SIZE) * stageSize,
    top: bounds.y + mt + (HIT_BOX.y0 / STAGE_SIZE) * stageSize,
    right: bounds.x + ml + (HIT_BOX.x1 / STAGE_SIZE) * stageSize,
    bottom: bounds.y + mt + (HIT_BOX.y1 / STAGE_SIZE) * stageSize,
  };
}

/**
 * Classify cursor relative to window: 'outside' | 'body' | 'margin'
 */
function pointerZone(bounds, point, margins) {
  const inWindow =
    point.x >= bounds.x &&
    point.x < bounds.x + bounds.width &&
    point.y >= bounds.y &&
    point.y < bounds.y + bounds.height;
  if (!inWindow) return 'outside';
  const r = spriteHitRect(bounds, margins);
  const inBody = point.x >= r.left && point.x <= r.right && point.y >= r.top && point.y <= r.bottom;
  return inBody ? 'body' : 'margin';
}

/**
 * Decide whether the window should ignore mouse events (`setIgnoreMouseEvents(next, { forward: true })`).
 * - While `input.dragging` is true: ALWAYS return `false` (hard lock so fast mouse moves don't break drag).
 * - While `busy` (menu open): keep `false` when cursor is inside any reported control rect or body.
 * - Otherwise keep `false` on body, `true` outside, and hold in margin for `OFF_BODY_RELEASE_MS` (400ms).
 */
function decideWindowIgnore(bounds, point, ignoring, busy, offBodyMs = 0, input = null, margins = null) {
  if (input && input.dragging) {
    return false;
  }
  if (busy) {
    const rects = Array.isArray(input?.rects) ? input.rects : [];
    if (rects.length === 0) return false;
    const inControl = rects.some(
      (r) =>
        point.x >= bounds.x + r.x &&
        point.x < bounds.x + r.x + r.width &&
        point.y >= bounds.y + r.y &&
        point.y < bounds.y + r.y + r.height,
    );
    if (inControl) return false;
    return pointerZone(bounds, point, margins) !== 'body';
  }
  const zone = pointerZone(bounds, point, margins);
  if (zone === 'outside') return true;
  if (zone === 'body') return false;
  if (offBodyMs >= OFF_BODY_RELEASE_MS) return true;
  return ignoring;
}

function leavesBody(prevZone, zone) {
  return prevZone === 'body' && zone !== 'body';
}

module.exports = {
  STAGE_SIZE,
  HIT_BOX,
  POINTER_POLL_MS,
  OFF_BODY_RELEASE_MS,
  spriteHitRect,
  pointerZone,
  decideWindowIgnore,
  leavesBody,
};
