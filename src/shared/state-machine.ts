import {
  ACTION_CATEGORIES,
  ANIMATION_CATALOG,
  BUBBLE_DEBOUNCE_MS,
  BUBBLE_DURATION_MS,
  CLICK_ANIMS,
  CLICK_BUBBLE_COOLDOWN_MS,
  IDLE_WHISPER_TEXTS,
  SLEEP_END_TEXTS,
  SLEEP_REFUSE_TEXTS,
  SLEEP_START_TEXTS,
  WORK_STATUS_ANIM,
  WORK_STATUS_TEXTS,
} from './config';
import {
  WORK_STATUS_PRIORITY,
  type ActionCategory,
  type AnimationId,
  type AnimationWeights,
  type BubbleMessage,
  type Facing,
  type SleepPhase,
  type WorkStatusSnapshot,
  type WorkStatusState,
} from './types';

export type RollKind = 'idle' | 'turn' | 'move' | 'action';

export function pickRandom<T>(pool: readonly T[], exclude?: T, rng = Math.random): T {
  const candidates = exclude !== undefined ? pool.filter((item) => item !== exclude) : pool;
  const src = candidates.length > 0 ? candidates : pool;
  return src[Math.floor(rng() * src.length)];
}

/**
 * Weighted dice roll mirroring dsh-pet's rollKind().
 * When fixed=true, turn & move weights become 0 so their share flows into leisure actions.
 */
export function rollKind(roll: number, weights: AnimationWeights, fixed = false): RollKind {
  const turn = fixed ? 0 : weights.turn;
  const move = fixed ? 0 : weights.move;
  const idleEnd = weights.idle / 100;
  const turnEnd = (weights.idle + turn) / 100;
  const moveEnd = (weights.idle + turn + move) / 100;
  if (roll < idleEnd) return 'idle';
  if (roll < turnEnd) return 'turn';
  if (roll < moveEnd) return 'move';
  return 'action';
}

export function pickCategoryAction(
  categories: readonly ActionCategory[],
  facing: Facing,
  current: AnimationId,
  cooldowns: ReadonlyMap<AnimationId, number>,
  nowMs: number,
  rng = Math.random,
): { categoryId: string; anim: AnimationId } {
  const nonEmpty = categories.filter((c) => c.actions.length > 0);
  const mirrorFiltered = nonEmpty.filter((c) => !(c.noMirror && facing === 'right'));
  const eligibleCats = mirrorFiltered.length > 0 ? mirrorFiltered : nonEmpty;

  if (eligibleCats.length === 0) {
    return { categoryId: 'idle', anim: 'idle' };
  }

  const totalW = eligibleCats.reduce((acc, c) => acc + c.weight, 0) || 1;
  let ticket = rng() * totalW;
  let chosen = eligibleCats[eligibleCats.length - 1];
  for (const cat of eligibleCats) {
    ticket -= cat.weight;
    if (ticket <= 0) {
      chosen = cat;
      break;
    }
  }

  // Prefer actions that are neither currently playing nor on cooldown
  const ready = chosen.actions.filter((id) => id !== current && (cooldowns.get(id) ?? 0) <= nowMs);
  if (ready.length > 0) {
    return { categoryId: chosen.id, anim: pickRandom(ready, current, rng) };
  }

  // Fallback across all eligible categories for any non-cooldown action
  const allReady = eligibleCats
    .flatMap((c) => c.actions)
    .filter((id) => id !== current && (cooldowns.get(id) ?? 0) <= nowMs);
  if (allReady.length > 0) {
    return { categoryId: chosen.id, anim: pickRandom(allReady, current, rng) };
  }

  // Final fallback: avoid repeating current if possible
  return { categoryId: chosen.id, anim: pickRandom(chosen.actions, current, rng) };
}

/**
 * Resolve highest-priority active work status among multiple signal sources.
 * Priority: waiting > error > working > thinking > result > success
 */
export function resolveHighestWorkStatus(
  sources: Iterable<{ state: WorkStatusState | null; task: string | null; source: string; updatedAt: number; expiresAt?: number }>,
  nowMs: number,
): { state: WorkStatusState | null; task: string | null; source: string; updatedAt: number } {
  let best: { state: WorkStatusState; task: string | null; source: string; updatedAt: number; prio: number } | null = null;
  for (const entry of sources) {
    if (!entry.state) continue;
    if (entry.expiresAt !== undefined && entry.expiresAt <= nowMs) continue;
    const prio = WORK_STATUS_PRIORITY[entry.state];
    if (!best || prio > best.prio || (prio === best.prio && entry.updatedAt > best.updatedAt)) {
      best = {
        state: entry.state,
        task: entry.task,
        source: entry.source,
        updatedAt: entry.updatedAt,
        prio,
      };
    }
  }
  if (!best) {
    return { state: null, task: null, source: 'idle', updatedAt: nowMs };
  }
  return { state: best.state, task: best.task, source: best.source, updatedAt: best.updatedAt };
}

export interface StateMachineCallbacks {
  onAnimationChange?: (anim: AnimationId, seq: number, once: boolean) => void;
  onFacingChange?: (facing: Facing) => void;
  onBubble?: (bubble: BubbleMessage) => void;
  onRequestWalk?: () => boolean;
}

export class PetStateMachine {
  private anim: AnimationId = 'idle';
  private animStartedAt = 0;
  private animOnce = false;
  private animSeq = 1;
  private facing: Facing = 'left';
  private sleepPhase: SleepPhase = null;
  private dragging = false;
  private fixedEnabled = false;
  private workStatusEnabled = true;
  private weights: AnimationWeights;
  private workStatus: WorkStatusSnapshot | null = null;
  private lastWorkSeq = 0;
  private cooldowns = new Map<AnimationId, number>();
  private lastBubbleAt = -Infinity;
  private lastBubbleKey = '';
  private lastClickBubbleAt = -Infinity;
  private clickStreak = 0;
  private lastClickAt = -Infinity;
  private pendingComboFollowup = false;
  private manualLockUntil = 0;
  private nextWhisperAt = 0;
  private callbacks: StateMachineCallbacks;
  private rng: () => number;

  constructor(
    opts: {
      weights: AnimationWeights;
      fixedEnabled?: boolean;
      workStatusEnabled?: boolean;
      nowMs?: number;
      rng?: () => number;
      callbacks?: StateMachineCallbacks;
    },
  ) {
    const now = opts.nowMs ?? Date.now();
    this.weights = { ...opts.weights };
    this.fixedEnabled = Boolean(opts.fixedEnabled);
    this.workStatusEnabled = opts.workStatusEnabled ?? true;
    this.animStartedAt = now;
    this.nextWhisperAt = now + 26_000 + Math.floor((opts.rng ?? Math.random)() * 18_000);
    this.callbacks = opts.callbacks ?? {};
    this.rng = opts.rng ?? Math.random;
  }

  getAnimation(): AnimationId {
    return this.anim;
  }

  getAnimationElapsedMs(nowMs: number): number {
    return Math.max(0, nowMs - this.animStartedAt);
  }

  getFacing(): Facing {
    return this.facing;
  }

  setFacing(facing: Facing): void {
    if (this.facing === facing) return;
    this.facing = facing;
    this.callbacks.onFacingChange?.(facing);
  }

  getSleepPhase(): SleepPhase {
    return this.sleepPhase;
  }

  isSleeping(): boolean {
    return this.sleepPhase !== null;
  }

  isDragging(): boolean {
    return this.dragging;
  }

  isManualLocked(nowMs = Date.now()): boolean {
    return nowMs < this.manualLockUntil;
  }

  getManualLockRemainingMs(nowMs = Date.now()): number {
    return Math.max(0, this.manualLockUntil - nowMs);
  }

  updateOptions(opts: { weights?: AnimationWeights; fixedEnabled?: boolean; workStatusEnabled?: boolean }): void {
    if (opts.weights) this.weights = { ...opts.weights };
    if (opts.fixedEnabled !== undefined) this.fixedEnabled = opts.fixedEnabled;
    if (opts.workStatusEnabled !== undefined) this.workStatusEnabled = opts.workStatusEnabled;
  }

  private setAnim(anim: AnimationId, once: boolean, nowMs: number): void {
    this.anim = anim;
    this.animOnce = once;
    this.animStartedAt = nowMs;
    this.animSeq += 1;
    const meta = ANIMATION_CATALOG[anim];
    if (meta && meta.cooldownMs > 0) {
      this.cooldowns.set(anim, nowMs + meta.cooldownMs);
    }
    this.callbacks.onAnimationChange?.(anim, this.animSeq, once);
  }

  /** Debounced bubble emission to prevent rapid spam */
  emitBubble(
    text: string,
    kind: BubbleMessage['kind'],
    nowMs: number,
    opts?: { durationMs?: number; key?: string; force?: boolean },
  ): boolean {
    if (!text) return false;
    const key = opts?.key ?? `${kind}:${text}`;
    if (!opts?.force) {
      if (kind === 'click' && nowMs - this.lastClickBubbleAt < CLICK_BUBBLE_COOLDOWN_MS) {
        return false;
      }
      if (key === this.lastBubbleKey && nowMs - this.lastBubbleAt < BUBBLE_DEBOUNCE_MS * 2) {
        return false;
      }
      if (kind !== 'work' && kind !== 'sleep' && nowMs - this.lastBubbleAt < BUBBLE_DEBOUNCE_MS) {
        return false;
      }
    }
    this.lastBubbleAt = nowMs;
    this.lastBubbleKey = key;
    if (kind === 'click') this.lastClickBubbleAt = nowMs;
    this.callbacks.onBubble?.({
      text,
      kind,
      durationMs: opts?.durationMs ?? BUBBLE_DURATION_MS,
      createdAt: nowMs,
      key,
    });
    return true;
  }

  /**
   * 3-phase sleep state machine (exact dsh-pet semantics):
   * - Enter sleep -> sleep_start (once) -> sleep_loop (loop)
   * - Wake during sleep_start -> cancel immediately, do NOT play sleep_end
   * - Wake during sleep_loop -> play sleep_end (once) -> return to random chain
   */
  setSleeping(sleeping: boolean, nowMs: number, silent = false): void {
    this.manualLockUntil = 0;
    if (sleeping) {
      if (this.sleepPhase !== null) return;
      this.sleepPhase = 'start';
      this.setAnim('sleep_start', true, nowMs);
      if (!silent) {
        this.emitBubble(pickRandom(SLEEP_START_TEXTS, undefined, this.rng), 'sleep', nowMs, {
          durationMs: 6500,
          force: true,
        });
      }
      return;
    }

    if (this.sleepPhase === null || this.sleepPhase === 'end') return;
    if (this.sleepPhase === 'start') {
      // Interrupted before actually falling asleep: cancel without wake-up stretch
      this.sleepPhase = null;
      this.setAnim('idle', true, nowMs);
      return;
    }
    this.sleepPhase = 'end';
    this.setAnim('sleep_end', true, nowMs);
    if (!silent) {
      this.emitBubble(pickRandom(SLEEP_END_TEXTS, undefined, this.rng), 'sleep', nowMs, {
        durationMs: 6500,
        force: true,
      });
    }
  }

  /** Trigger a specific action (menu click / command / shortcut) with manual lock protection */
  triggerAction(anim: AnimationId, nowMs: number, customBubble?: string, force = false, lockMs = 5000): boolean {
    if (this.sleepPhase !== null && !force) {
      this.emitBubble(pickRandom(SLEEP_REFUSE_TEXTS, undefined, this.rng), 'sleep', nowMs, {
        durationMs: 6000,
        key: 'sleep-refuse',
      });
      return false;
    }
    if (anim === 'sleep_start' || anim === 'sleep_loop') {
      this.setSleeping(true, nowMs);
      if (lockMs > 0) this.manualLockUntil = nowMs + lockMs;
      return true;
    }
    if (anim === 'sleep_end') {
      this.setSleeping(false, nowMs);
      return true;
    }
    const meta = ANIMATION_CATALOG[anim];
    if (!meta) return false;
    if (this.sleepPhase !== null && force) {
      this.sleepPhase = null;
    }
    this.pendingComboFollowup = false;
    this.manualLockUntil = lockMs > 0 ? nowMs + lockMs : 0;
    if (meta.noMirror && this.facing === 'right') {
      this.setFacing('left');
    }
    this.setAnim(anim, !meta.loop || anim !== 'idle', nowMs);
    const line = customBubble ?? (meta.bubbles?.length ? pickRandom(meta.bubbles, undefined, this.rng) : undefined);
    if (line) {
      this.emitBubble(line, 'whisper', nowMs, {
        durationMs: Math.max(BUBBLE_DURATION_MS, lockMs > 0 ? lockMs + 1000 : BUBBLE_DURATION_MS),
        force: true,
      });
    }
    return true;
  }

  /** Click / pat interaction on the catgirl body (with 3-tap shy -> tsundere combo easter egg) */
  onClick(nowMs: number): void {
    if (this.dragging) return;
    if (this.sleepPhase === 'loop') {
      // Gently complain while sleeping; double-tap or menu wakes her
      this.emitBubble(pickRandom(SLEEP_REFUSE_TEXTS, undefined, this.rng), 'sleep', nowMs, {
        durationMs: 6000,
        key: 'sleep-click-refuse',
      });
      return;
    }
    if (this.sleepPhase === 'start') {
      this.sleepPhase = null;
    }
    this.manualLockUntil = 0;

    this.clickStreak = nowMs - this.lastClickAt <= 1450 ? this.clickStreak + 1 : 1;
    this.lastClickAt = nowMs;

    if (this.clickStreak >= 3) {
      this.clickStreak = 0;
      this.pendingComboFollowup = true;
      this.setAnim('click_shy', true, nowMs);
      this.emitBubble('呀！连戳三下会害羞脸红的啦 >///<', 'click', nowMs, {
        durationMs: 3600,
        force: true,
      });
      return;
    }

    this.pendingComboFollowup = false;
    const anim = pickRandom(CLICK_ANIMS, this.anim, this.rng);
    this.setAnim(anim, true, nowMs);
    const meta = ANIMATION_CATALOG[anim];
    if (meta?.bubbles?.length) {
      this.emitBubble(pickRandom(meta.bubbles, undefined, this.rng), 'click', nowMs);
    }
  }

  onDragStart(nowMs: number): void {
    this.dragging = true;
    this.manualLockUntil = 0;
    if (this.sleepPhase !== null) return; // keep sleep pose when gently moved
    this.setAnim('drag', false, nowMs);
    const dragBubbles = ANIMATION_CATALOG.drag.bubbles;
    if (dragBubbles?.length) {
      this.emitBubble(pickRandom(dragBubbles, undefined, this.rng), 'click', nowMs, { durationMs: 3200 });
    }
  }

  onDragEnd(nowMs: number): void {
    this.dragging = false;
    if (this.sleepPhase !== null) return;
    if (this.resumeWorkStatus(nowMs)) return;
    this.setAnim('idle', true, nowMs);
  }

  /** Apply an Antigravity Agent work status snapshot */
  applyWorkStatus(snapshot: WorkStatusSnapshot | null, nowMs: number): void {
    this.workStatus = snapshot;
    if (nowMs < this.manualLockUntil) return;
    if (!this.workStatusEnabled || !snapshot || !snapshot.state) {
      if (this.isWorkAnim(this.anim) && !this.dragging && this.sleepPhase === null) {
        this.setAnim('idle', true, nowMs);
      }
      return;
    }
    if (snapshot.seq === this.lastWorkSeq && this.anim === WORK_STATUS_ANIM[snapshot.state]) {
      return;
    }
    this.lastWorkSeq = snapshot.seq;
    if (this.dragging || this.sleepPhase !== null) return;

    const targetAnim = WORK_STATUS_ANIM[snapshot.state];
    const isTerminal = snapshot.state === 'success' || snapshot.state === 'error';
    this.setAnim(targetAnim, isTerminal, nowMs);

    const baseLine = pickRandom(WORK_STATUS_TEXTS[snapshot.state], undefined, this.rng);
    const text = snapshot.task ? `${baseLine}\n📌 ${snapshot.task}` : baseLine;
    this.emitBubble(text, 'work', nowMs, {
      durationMs: isTerminal ? 9000 : BUBBLE_DURATION_MS,
      key: `work:${snapshot.state}:${snapshot.task ?? ''}`,
      force: true,
    });
  }

  private isWorkAnim(anim: AnimationId): boolean {
    return anim.startsWith('work_');
  }

  /** Restore active non-terminal work status after a temporary click/drag/play ends */
  resumeWorkStatus(nowMs: number): boolean {
    if (nowMs < this.manualLockUntil) return false;
    if (!this.workStatusEnabled || this.sleepPhase !== null || this.dragging) return false;
    const st = this.workStatus?.state;
    if (!st || st === 'success' || st === 'error') return false;
    if (this.workStatus?.expiresAt && this.workStatus.expiresAt <= nowMs) return false;
    this.setAnim(WORK_STATUS_ANIM[st], false, nowMs);
    return true;
  }

  /** Pick the next autonomous animation using weighted dice + cooldowns */
  pickNext(nowMs: number): void {
    if (this.dragging || this.sleepPhase !== null || nowMs < this.manualLockUntil) return;
    if (this.resumeWorkStatus(nowMs)) return;

    const kind = rollKind(this.rng(), this.weights, this.fixedEnabled);
    if (kind === 'idle') {
      this.setAnim('idle', true, nowMs);
      return;
    }
    if (kind === 'turn') {
      this.setAnim('turn', true, nowMs);
      return;
    }
    if (kind === 'move') {
      const started = this.callbacks.onRequestWalk?.() ?? false;
      if (started) {
        this.setAnim('walk', true, nowMs);
        return;
      }
      // Fall through to category action if walk cannot start (e.g., IDE sidebar fixed stage)
    }

    const picked = pickCategoryAction(ACTION_CATEGORIES, this.facing, this.anim, this.cooldowns, nowMs, this.rng);
    this.setAnim(picked.anim, true, nowMs);
    const meta = ANIMATION_CATALOG[picked.anim];
    if (meta?.bubbles?.length && this.rng() < 0.65) {
      this.emitBubble(pickRandom(meta.bubbles, undefined, this.rng), 'whisper', nowMs, { durationMs: 6500 });
    }
  }

  /** Advance timers once per frame */
  tick(nowMs: number): void {
    if (this.dragging) return;
    const locked = nowMs < this.manualLockUntil;

    // Periodic ambient whisper during idle/calm states
    if (
      !locked &&
      nowMs >= this.nextWhisperAt &&
      this.sleepPhase === null &&
      !this.isWorkAnim(this.anim) &&
      (this.anim === 'idle' || this.anim === 'hum')
    ) {
      this.nextWhisperAt = nowMs + 42_000 + Math.floor(this.rng() * 35_000);
      this.emitBubble(pickRandom(IDLE_WHISPER_TEXTS, undefined, this.rng), 'whisper', nowMs, {
        durationMs: 7000,
      });
    }

    // Check if work status TTL expired
    if (
      this.workStatus?.state &&
      this.workStatus.expiresAt !== undefined &&
      this.workStatus.expiresAt <= nowMs
    ) {
      this.workStatus = { ...this.workStatus, state: null, task: null };
      if (!locked && this.isWorkAnim(this.anim)) {
        this.setAnim('idle', true, nowMs);
      }
    }

    const meta = ANIMATION_CATALOG[this.anim];
    if (!meta) return;
    const elapsed = nowMs - this.animStartedAt;

    // Sleep phase progression
    if (this.sleepPhase === 'start' && elapsed >= meta.durationMs) {
      this.sleepPhase = 'loop';
      this.setAnim('sleep_loop', false, nowMs);
      return;
    }
    if (this.sleepPhase === 'end' && elapsed >= meta.durationMs) {
      this.sleepPhase = null;
      this.manualLockUntil = 0;
      this.pickNext(nowMs);
      return;
    }
    if (this.sleepPhase === 'loop') {
      return;
    }

    // Keep manually locked action active until lock window expires
    if (locked) {
      return;
    }

    // One-shot animation completion
    if (this.animOnce && elapsed >= meta.durationMs) {
      if (this.anim === 'turn') {
        this.setFacing(this.facing === 'left' ? 'right' : 'left');
        this.pickNext(nowMs);
        return;
      }
      if (this.anim === 'click_shy' && this.pendingComboFollowup) {
        this.pendingComboFollowup = false;
        this.setAnim('click_tsundere', true, nowMs);
        this.emitBubble('哼！才不是为了让你戳才鼓腮帮子轻哼的喵！', 'click', nowMs, {
          durationMs: 4200,
          force: true,
        });
        return;
      }
      if (this.anim.startsWith('click_') || this.anim === 'work_success' || this.anim === 'work_error') {
        if (this.resumeWorkStatus(nowMs)) return;
        this.setAnim('idle', true, nowMs);
        return;
      }
      this.pickNext(nowMs);
      return;
    }

    // Idle loop slice finished -> roll next autonomous action
    if (this.anim === 'idle' && elapsed >= meta.durationMs) {
      this.pickNext(nowMs);
    }
  }
}
