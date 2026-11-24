import test from 'node:test';
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

const require = createRequire(import.meta.url);
const ROOT = resolve(import.meta.dirname, '..');

// Load CommonJS desktop helper pure logic modules
const pointerTarget = require(resolve(ROOT, 'runtime', 'electron-helper', 'pointer-target.js'));
const hostLiveness = require(resolve(ROOT, 'runtime', 'electron-helper', 'host-liveness.js'));

// Load built browser shared-core bundle inside a minimal global sandbox for pure logic verification
function loadSharedCore() {
  const code = readFileSync(resolve(ROOT, 'dist', 'desktop', 'shared-core.js'), 'utf8');
  const fn = new Function('window', `${code}\nreturn GeminiPetCore;`);
  return fn({});
}

test('State machine: rollKind respects weights and fixedEnabled zeroing', () => {
  const Core = loadSharedCore();
  const w = { idle: 15, turn: 8, move: 10 };
  assert.equal(Core.rollKind(0.05, w, false), 'idle');
  assert.equal(Core.rollKind(0.18, w, false), 'turn');
  assert.equal(Core.rollKind(0.28, w, false), 'move');
  assert.equal(Core.rollKind(0.5, w, false), 'action');

  // When fixed=true, turn & move collapse into action
  assert.equal(Core.rollKind(0.14, w, true), 'idle');
  assert.equal(Core.rollKind(0.18, w, true), 'action');
  assert.equal(Core.rollKind(0.28, w, true), 'action');
});

test('State machine: 3-phase sleep transitions and interruption handling', () => {
  const Core = loadSharedCore();
  const t = 10_000;
  const sm = new Core.PetStateMachine({ weights: Core.DEFAULT_WEIGHTS, nowMs: t, rng: () => 0.5 });

  // Enter sleep -> start
  sm.setSleeping(true, t);
  assert.equal(sm.getSleepPhase(), 'start');
  assert.equal(sm.getAnimation(), 'sleep_start');

  // Interrupt during sleep_start -> cancels cleanly WITHOUT playing sleep_end
  sm.setSleeping(false, t + 500);
  assert.equal(sm.getSleepPhase(), null);
  assert.equal(sm.getAnimation(), 'idle');

  // Re-enter sleep and advance past sleep_start duration (1800ms) -> sleep_loop
  sm.setSleeping(true, t + 1000);
  sm.tick(t + 3000);
  assert.equal(sm.getSleepPhase(), 'loop');
  assert.equal(sm.getAnimation(), 'sleep_loop');

  // Wake from sleep_loop -> plays sleep_end -> finishes back to non-sleep
  sm.setSleeping(false, t + 4000);
  assert.equal(sm.getSleepPhase(), 'end');
  assert.equal(sm.getAnimation(), 'sleep_end');

  sm.tick(t + 6000);
  assert.equal(sm.getSleepPhase(), null);
  assert.notEqual(sm.getAnimation(), 'sleep_end');
});

test('State machine: work status priority order waiting > error > working > thinking > result > success', () => {
  const Core = loadSharedCore();
  const now = 50_000;
  const active = [
    { state: 'success', task: 'done', source: 's1', updatedAt: now, expiresAt: now + 5000 },
    { state: 'thinking', task: 'think', source: 's2', updatedAt: now, expiresAt: now + 5000 },
    { state: 'working', task: 'run', source: 's3', updatedAt: now, expiresAt: now + 5000 },
  ];
  assert.equal(Core.resolveHighestWorkStatus(active, now).state, 'working');

  active.push({ state: 'error', task: 'err', source: 's4', updatedAt: now, expiresAt: now + 5000 });
  assert.equal(Core.resolveHighestWorkStatus(active, now).state, 'error');

  active.push({ state: 'waiting', task: 'confirm', source: 's5', updatedAt: now, expiresAt: now + 5000 });
  assert.equal(Core.resolveHighestWorkStatus(active, now).state, 'waiting');

  // Expired waiting falls back to error
  assert.equal(
    Core.resolveHighestWorkStatus(
      active.map((a) => (a.state === 'waiting' ? { ...a, expiresAt: now - 1 } : a)),
      now,
    ).state,
    'error',
  );
});

test('State machine: bubble debounce prevents rapid duplicate spam', () => {
  const Core = loadSharedCore();
  const emitted = [];
  const sm = new Core.PetStateMachine({
    weights: Core.DEFAULT_WEIGHTS,
    nowMs: 1000,
    callbacks: { onBubble: (b) => emitted.push(b) },
  });
  assert.equal(sm.emitBubble('喵呜', 'click', 1000), true);
  assert.equal(sm.emitBubble('喵呜', 'click', 1500), false); // within CLICK_BUBBLE_COOLDOWN_MS
  assert.equal(sm.emitBubble('新台词', 'click', 3200), true);
  assert.equal(emitted.length, 2);
});

test('Physics: release velocity deadzone, stale rejection, bounce & multi-pet collision', () => {
  const Core = loadSharedCore();
  const stale = Core.estimateReleaseVelocity(
    [
      { x: 0, y: 0, t: 100 },
      { x: 200, y: 0, t: 150 },
    ],
    400,
    1,
  );
  assert.equal(stale.thrown, false);

  const fast = Core.estimateReleaseVelocity(
    [
      { x: 0, y: 0, t: 100 },
      { x: 400, y: -120, t: 140 },
    ],
    150,
    1,
  );
  assert.equal(fast.thrown, true);
  assert.ok(Math.hypot(fast.vx, fast.vy) <= Core.MAX_THROW_SPEED + 1);

  const body = { x: 990, y: 200, vx: 800, vy: 0, size: 200, flying: true };
  const bounds = { x: 0, y: 0, width: 1000, height: 800 };
  const res = Core.stepFlight(body, bounds, Core.DEFAULT_PHYSICS, 0.03, [], 'main');
  assert.equal(res.hitWall, true);
  assert.ok(body.vx < 0);
  assert.ok(body.x <= 800);

  const b1 = { x: 200, y: 200, vx: 500, vy: 0, size: 200, flying: true };
  const peer = { id: 'pet-2', x: 280, y: 200, vx: 0, vy: 0, size: 200 };
  const colRes = Core.stepFlight(b1, bounds, Core.DEFAULT_PHYSICS, 0.016, [peer], 'main');
  assert.equal(colRes.collidedPeerId, 'pet-2');
  assert.ok(b1.vx < 500);
});

test('Pointer target: HIT_BOX, 400ms margin hysteresis, and drag hard-lock', () => {
  const bounds = { x: 100, y: 100, width: 480, height: 480 };
  const margins = { l: 120, r: 120, t: 180, b: 60 }; // stageSize = 240

  const centerPt = { x: 100 + 120 + 120, y: 100 + 180 + 120 };
  assert.equal(pointerTarget.pointerZone(bounds, centerPt, margins), 'body');
  assert.equal(pointerTarget.decideWindowIgnore(bounds, centerPt, true, false, 0, null, margins), false);

  const marginPt = { x: 110, y: 110 };
  assert.equal(pointerTarget.pointerZone(bounds, marginPt, margins), 'margin');
  assert.equal(pointerTarget.decideWindowIgnore(bounds, marginPt, false, false, 240, null, margins), false);
  assert.equal(pointerTarget.decideWindowIgnore(bounds, marginPt, false, false, 400, null, margins), true);

  const outPt = { x: 5, y: 5 };
  assert.equal(
    pointerTarget.decideWindowIgnore(bounds, outPt, true, true, 9999, { dragging: true, rects: [] }, margins),
    false,
  );
  assert.equal(pointerTarget.decideWindowIgnore(bounds, outPt, false, false, 0, null, margins), true);
});

test('Host liveness: PID parsing, ESRCH detection, and EPIPE broken pipe detection', () => {
  assert.equal(hostLiveness.parseHostPid('12345'), 12345);
  assert.equal(hostLiveness.parseHostPid('invalid'), 0);
  assert.equal(hostLiveness.hostIsGone(123, () => {}), false);
  assert.equal(
    hostLiveness.hostIsGone(123, () => {
      const e = new Error('gone');
      e.code = 'ESRCH';
      throw e;
    }),
    true,
  );
  assert.equal(hostLiveness.isBrokenPipeError({ code: 'EPIPE' }), true);
  assert.equal(hostLiveness.isBrokenPipeError({ code: 'ERR_STREAM_DESTROYED' }), true);
  assert.equal(hostLiveness.isBrokenPipeError({ code: 'EINVAL' }), false);
});

test('Transcript parser: infers thinking, working, waiting, success, error states', () => {
  const Core = loadSharedCore();
  assert.equal(
    Core.parseTranscriptTailLines(JSON.stringify({ type: 'USER_INPUT', content: '帮我写个测试' })).state,
    'thinking',
  );
  assert.equal(
    Core.parseTranscriptTailLines(
      JSON.stringify({ type: 'PLANNER_RESPONSE', status: 'RUNNING', tool_calls: [{ name: 'run_command' }] }),
    ).state,
    'working',
  );
  assert.equal(
    Core.parseTranscriptTailLines(
      JSON.stringify({ type: 'PLANNER_RESPONSE', status: 'DONE', tool_calls: [{ name: 'ask_question' }] }),
    ).state,
    'waiting',
  );
  assert.equal(
    Core.parseTranscriptTailLines(JSON.stringify({ type: 'PLANNER_RESPONSE', status: 'DONE', tool_calls: [] })).state,
    'success',
  );
  assert.equal(
    Core.parseTranscriptTailLines(JSON.stringify({ type: 'PLANNER_RESPONSE', status: 'ERROR' })).state,
    'error',
  );
});

test('Pose & secondary spring: 70ms/130ms lag, 160px proximity, startle, and 3-click combo', () => {
  const Core = loadSharedCore();
  const sp = Core.createSecondarySpring();
  assert.ok(sp.nextEarTwitchAt >= 4.0 && sp.nextEarTwitchAt <= 6.2);

  // Step 50ms under horizontal impulse -> head 70ms filter leads 130ms tail/hair filter
  Core.updateSecondarySpring(sp, 0.04, 1200, 0, 1.0);
  assert.ok(Math.abs(sp.vel70X) > Math.abs(sp.vel130X));

  // Proximity within 160px boosts pupilGlow & ear bias; fast swipe triggers startle hop
  const noStartle = Core.updateCursorProximity(sp, 80, -0.8, 300, 0.04);
  assert.equal(noStartle, false);
  assert.ok(sp.pupilGlow > 0.1);
  assert.ok(sp.earBiasL > 0);

  const startled = Core.updateCursorProximity(sp, 60, 0.6, 2200, 0.04);
  assert.equal(startled, true);
  assert.ok(sp.startleVel > 0);

  // 3-click combo triggers click_shy -> transitions into click_tsundere
  const sm = new Core.PetStateMachine({ weights: Core.DEFAULT_WEIGHTS, nowMs: 10_000, rng: () => 0.2 });
  sm.onClick(10_100);
  sm.onClick(10_400);
  sm.onClick(10_700);
  assert.equal(sm.getAnimation(), 'click_shy');
  sm.tick(10_700 + Core.ANIMATION_CATALOG.click_shy.durationMs + 50);
  assert.equal(sm.getAnimation(), 'click_tsundere');

  // Verify all 27 catalog animations evaluate cleanly without NaN
  const allIds = Object.keys(Core.ANIMATION_CATALOG);
  assert.equal(allIds.length, 27);
  for (const id of allIds) {
    const pose = Core.evaluateCatgirlPose(id, 0.4, 2.0, sp, 'left');
    assert.ok(Number.isFinite(pose.bodyY) && Number.isFinite(pose.headTilt) && Number.isFinite(pose.tailWag), id);
  }
});

test('Pose manifest: 17 pure-transparent poses, free mirroring, calm idle & 27-state coverage', () => {
  const Core = loadSharedCore();
  assert.equal(Core.createDefaultConfig().avatarStyle, 'chibi');
  assert.equal(Core.AVATAR_STYLE_LABELS.chibi, 'Q版萌系全动作（默认）');
  assert.equal(Core.AVATAR_STYLE_LABELS.illust, '精致立绘全动作');
  assert.equal(Core.AVATAR_STYLE_LABELS.mixed, '双画风混搭');

  // Verify 15 chibi + 2 pure-transparent illust = 17 poses, all noMirror=false & normalized visualScale
  assert.equal(Core.POSE_MANIFEST_ENTRIES.length, 17);
  assert.equal(Core.POSE_MANIFEST_ENTRIES.filter((p) => p.style === 'chibi').length, 15);
  assert.equal(Core.POSE_MANIFEST_ENTRIES.filter((p) => p.style === 'illust').length, 2);
  for (const entry of Core.POSE_MANIFEST_ENTRIES) {
    assert.equal(entry.noMirror, false, `Expected noMirror=false for ${entry.id}`);
    assert.ok(entry.visualScale >= 0.85 && entry.visualScale <= 1.15, `visualScale out of range for ${entry.id}`);
  }

  // Calm idle rhythm (>= 8s) and calm-only chibi idle pose pool
  assert.ok(Core.ANIMATION_CATALOG.idle.durationMs >= 8000);
  const chibiIdleIds = new Set(Core.getPosePoolForState('chibi', 'idle').map((p) => p.id));
  assert.equal(chibiIdleIds.has('chibi_14_coffee'), true);
  assert.equal(chibiIdleIds.has('chibi_04_tired'), false);
  assert.equal(chibiIdleIds.has('chibi_06_pout'), false);
  assert.equal(chibiIdleIds.has('chibi_02_shock'), false);

  // Precise emotion mapping
  assert.ok(Core.getPosePoolForState('chibi', 'peek').every((p) => p.id === 'chibi_07_melon'));
  assert.ok(Core.getPosePoolForState('chibi', 'click_tsundere').every((p) => p.id === 'chibi_06_pout'));
  assert.ok(Core.getPosePoolForState('chibi', 'sleep_loop').every((p) => p.id === 'chibi_15_sleep'));

  const styles = ['chibi', 'illust', 'mixed'];
  const allIds = Object.keys(Core.ANIMATION_CATALOG);
  for (const style of styles) {
    for (const id of allIds) {
      const pool = Core.getPosePoolForState(style, id);
      assert.ok(pool.length >= 1, `Expected pose pool for ${style}:${id}`);
      if (style !== 'mixed') {
        assert.ok(pool.every((p) => p.style === style), `Style mismatch in ${style}:${id}`);
      }
    }
  }

  // Startup idle defaults to coffee chibi / full illust
  assert.equal(Core.pickPoseForState('chibi', 'idle', 0).id, 'chibi_14_coffee');
  assert.equal(Core.pickPoseForState('illust', 'idle', 0).id, 'illust_01_full');

  // Multi-pose rotation advances cleanly without immediate repeat
  const first = Core.pickPoseForState('chibi', 'idle', 0);
  const second = Core.pickPoseForState('chibi', 'idle', 1, first.id);
  assert.notEqual(first.id, second.id);

  // Mixed style interleaves chibi and illust
  const mixedIdle = Core.getPosePoolForState('mixed', 'idle');
  assert.ok(mixedIdle.some((p) => p.style === 'chibi'));
  assert.ok(mixedIdle.some((p) => p.style === 'illust'));
});

test('State machine: 5s manual lock wakes sleep, blocks tick interruption, and unlocks cleanly', () => {
  const Core = loadSharedCore();
  const t = 20_000;
  const sm = new Core.PetStateMachine({ weights: Core.DEFAULT_WEIGHTS, nowMs: t, rng: () => 0.4 });

  // Enter sleep_loop first
  sm.setSleeping(true, t);
  sm.tick(t + 2000);
  assert.equal(sm.getSleepPhase(), 'loop');

  // Without force, manual action is gently refused while sleeping
  assert.equal(sm.triggerAction('eat_fish', t + 2200, undefined, false, 5000), false);
  assert.equal(sm.getSleepPhase(), 'loop');

  // With force: true and lockMs: 5000, wakes from sleep and locks for 5 seconds
  const triggeredAt = t + 2500;
  assert.equal(sm.triggerAction('eat_fish', triggeredAt, undefined, true, 5000), true);
  assert.equal(sm.getSleepPhase(), null);
  assert.equal(sm.getAnimation(), 'eat_fish');
  assert.equal(sm.isManualLocked(triggeredAt), true);
  assert.equal(sm.getManualLockRemainingMs(triggeredAt + 2500), 2500);

  // Even past eat_fish durationMs (4200ms), 5s lock keeps action active
  sm.tick(triggeredAt + 4500);
  assert.equal(sm.isManualLocked(triggeredAt + 4500), true);
  assert.equal(sm.getAnimation(), 'eat_fish');

  // Work status applied during manual lock does not hijack the locked action immediately
  sm.applyWorkStatus(
    { state: 'thinking', task: 'test', source: 'unit', updatedAt: triggeredAt + 4600, expiresAt: triggeredAt + 12_000, seq: 1 },
    triggeredAt + 4600,
  );
  assert.equal(sm.getAnimation(), 'eat_fish');

  // Once 5000ms elapses, tick unlocks and advances out of eat_fish
  sm.tick(triggeredAt + 5100);
  assert.equal(sm.isManualLocked(triggeredAt + 5100), false);
  assert.notEqual(sm.getAnimation(), 'eat_fish');
});

test('Renderer & DOM: eat_fish/eat_cookie snack particles and cat-ear sticker bubble markup', () => {
  const Core = loadSharedCore();
  const makeMockCtx = () => {
    const counts = { ellipse: 0, lineTo: 0, quadraticCurveTo: 0, arc: 0, fill: 0, stroke: 0 };
    const grad = { addColorStop() {} };
    return {
      counts,
      ctx: {
        imageSmoothingEnabled: true,
        imageSmoothingQuality: 'high',
        globalAlpha: 1,
        fillStyle: '',
        strokeStyle: '',
        lineWidth: 1,
        lineCap: 'butt',
        lineJoin: 'miter',
        font: '',
        textAlign: 'left',
        textBaseline: 'alphabetic',
        filter: 'none',
        save() {},
        restore() {},
        clearRect() {},
        translate() {},
        rotate() {},
        scale() {},
        beginPath() {},
        closePath() {},
        moveTo() {},
        lineTo() {
          counts.lineTo += 1;
        },
        quadraticCurveTo() {
          counts.quadraticCurveTo += 1;
        },
        arc() {
          counts.arc += 1;
        },
        ellipse() {
          counts.ellipse += 1;
        },
        roundRect() {},
        setLineDash() {},
        fill() {
          counts.fill += 1;
        },
        stroke() {
          counts.stroke += 1;
        },
        fillText() {},
        strokeText() {},
        drawImage() {},
        createLinearGradient() {
          return grad;
        },
        createRadialGradient() {
          return grad;
        },
      },
    };
  };

  const sp = Core.createSecondarySpring();
  const fishMock = makeMockCtx();
  const fishPose = Core.evaluateCatgirlPose('eat_fish', 0.4, 1.2, sp, 'left');
  Core.renderCatgirlFrame(fishMock.ctx, 360, 360, {
    pose: fishPose,
    spring: sp,
    facing: 'left',
    globalSec: 1.2,
    anim: 'eat_fish',
  });
  assert.ok(fishMock.counts.ellipse >= 5, `expected >=5 falling fish ellipses, got ${fishMock.counts.ellipse}`);
  assert.ok(fishMock.counts.lineTo >= 10, `expected fish tail fins, got ${fishMock.counts.lineTo}`);
  assert.ok(fishMock.counts.quadraticCurveTo >= 20, 'expected stars + micro-sparkles');

  const cookieMock = makeMockCtx();
  const cookiePose = Core.evaluateCatgirlPose('eat_cookie', 0.4, 1.2, sp, 'left');
  Core.renderCatgirlFrame(cookieMock.ctx, 360, 360, {
    pose: cookiePose,
    spring: sp,
    facing: 'left',
    globalSec: 1.2,
    anim: 'eat_cookie',
  });
  assert.ok(cookieMock.counts.quadraticCurveTo >= 40, `expected >=5 falling star cookies, got ${cookieMock.counts.quadraticCurveTo}`);

  const indexHtml = readFileSync(resolve(ROOT, 'runtime', 'electron-helper', 'index.html'), 'utf8');
  const viewProviderTs = readFileSync(resolve(ROOT, 'src', 'extension', 'petViewProvider.ts'), 'utf8');
  for (const [name, src] of [
    ['index.html', indexHtml],
    ['petViewProvider.ts', viewProviderTs],
  ]) {
    assert.ok(src.includes('#FFF9FE') && src.includes('#F3E7FF'), `${name}: missing pastel gradient`);
    assert.ok(src.includes('#B983FF'), `${name}: missing lavender border`);
    assert.ok(src.includes('#4A256E'), `${name}: missing berry purple text color`);
    assert.ok(src.includes('YouYuan') && src.includes('STCaiyun'), `${name}: missing cute font stack`);
    assert.ok(src.includes('bubble-ear-l') && src.includes('bubble-ear-r'), `${name}: missing cat ear SVGs`);
    assert.ok(src.includes('bubble-star-l') && src.includes('bubble-star-r'), `${name}: missing star SVGs`);
    assert.ok(src.includes('class="bubble-text"'), `${name}: missing .bubble-text wrapper`);
  }
});
