import {
  createSecondarySpring,
  evaluateCatgirlPose,
  triggerSquash,
  updateCursorProximity,
  updateSecondarySpring,
  type SecondarySpring,
} from './catgirl-pose';
import { preloadCatgirlAssets, renderCatgirlFrame, setCatgirlAssetBaseUrl } from './catgirl-renderer';
import { STAGE_SIZE } from './config';
import { getPosePoolForState, pickPoseForState } from './pose-manifest';
import { isSoundEnabled, playPetSound, setSoundEnabled } from './sound-fx';
import { PetStateMachine } from './state-machine';
import type { AnimationId, AnimationWeights, AvatarStyle, BubbleMessage, Facing, WorkStatusSnapshot } from './types';

export interface PetStageRuntimeOptions {
  canvas: HTMLCanvasElement;
  bubbleEl?: HTMLElement | null;
  weights: AnimationWeights;
  avatarStyle?: AvatarStyle;
  fixedEnabled?: boolean;
  workStatusEnabled?: boolean;
  hueShift?: number;
  logicalSize?: number;
  assetBaseUrl?: string;
  enableSound?: boolean;
  onRequestWalk?: () => boolean;
  onStateChange?: (anim: AnimationId, facing: Facing, sleeping: boolean) => void;
}

export class PetStageRuntime {
  private canvas: HTMLCanvasElement;
  private ctx: CanvasRenderingContext2D;
  private bubbleEl: HTMLElement | null;
  private machine: PetStateMachine;
  private spring: SecondarySpring;
  private hueShift: number;
  private logicalSize: number;
  private assetBaseUrl?: string;
  private avatarStyle: AvatarStyle;
  private activePoseId: string;
  private previousPoseId: string | null = null;
  private poseBlend = 1;
  private poseRotationStep = 0;
  private poseHoldElapsedSec = 0;
  private rafId: number | null = null;
  private lastFrameMs = performance.now();
  private startMs = performance.now();
  private velX = 0;
  private velY = 0;
  private lookX = 0;
  private lookY = 0;
  private sittingOnWindow = false;
  private lastAnimForSound: AnimationId = 'idle';
  private bubbleTimer: ReturnType<typeof setTimeout> | null = null;
  private disposed = false;
  private onStateChange?: (anim: AnimationId, facing: Facing, sleeping: boolean) => void;

  constructor(opts: PetStageRuntimeOptions) {
    this.canvas = opts.canvas;
    const ctx = opts.canvas.getContext('2d', { alpha: true });
    if (!ctx) throw new Error('2D canvas context unavailable');
    this.ctx = ctx;
    this.bubbleEl = opts.bubbleEl ?? null;
    this.hueShift = opts.hueShift ?? 0;
    this.logicalSize = opts.logicalSize ?? STAGE_SIZE;
    this.assetBaseUrl = opts.assetBaseUrl;
    this.avatarStyle = opts.avatarStyle ?? 'chibi';
    this.activePoseId = pickPoseForState(this.avatarStyle, 'idle', 0).id;
    this.onStateChange = opts.onStateChange;
    this.spring = createSecondarySpring();

    if (opts.enableSound !== undefined) {
      setSoundEnabled(opts.enableSound);
    }
    if (opts.assetBaseUrl) {
      setCatgirlAssetBaseUrl(opts.assetBaseUrl);
    } else {
      preloadCatgirlAssets();
    }

    this.machine = new PetStateMachine({
      weights: opts.weights,
      fixedEnabled: opts.fixedEnabled,
      workStatusEnabled: opts.workStatusEnabled,
      nowMs: Date.now(),
      callbacks: {
        onAnimationChange: (anim) => {
          this.advancePoseForAnim(anim);
          this.emitAnimSound(anim);
          this.onStateChange?.(anim, this.machine.getFacing(), this.machine.isSleeping());
        },
        onFacingChange: (facing) => {
          this.onStateChange?.(this.machine.getAnimation(), facing, this.machine.isSleeping());
        },
        onBubble: (msg) => this.showBubble(msg),
        onRequestWalk: opts.onRequestWalk,
      },
    });

    this.resizeCanvas(this.logicalSize);
    this.startLoop();
  }

  private emitAnimSound(anim: AnimationId): void {
    if (anim === this.lastAnimForSound) return;
    this.lastAnimForSound = anim;
    switch (anim) {
      case 'click_happy':
      case 'click_tickle':
        playPetSound('meow_happy');
        break;
      case 'click_shy':
        playPetSound('meow_shy');
        break;
      case 'click_tsundere':
        playPetSound('meow_tsundere');
        break;
      case 'click_wave':
      case 'toss_star':
      case 'star_magic':
      case 'work_result':
        playPetSound('star_chime');
        break;
      case 'work_success':
        playPetSound('star_celebrate');
        break;
      case 'eat_fish':
      case 'eat_cookie':
        playPetSound('crunch');
        break;
      case 'sleep_start':
        playPetSound('meow_sleepy');
        break;
      default:
        break;
    }
  }

  setSoundEnabled(enabled: boolean): void {
    setSoundEnabled(enabled);
  }

  isSoundEnabled(): boolean {
    return isSoundEnabled();
  }

  setSittingOnWindow(sitting: boolean): void {
    this.sittingOnWindow = sitting;
  }

  isSittingOnWindow(): boolean {
    return this.sittingOnWindow;
  }

  resizeCanvas(logicalSize: number): void {
    this.logicalSize = logicalSize;
    const dpr = Math.min(2.5, Math.max(1, window.devicePixelRatio || 1));
    this.canvas.width = Math.round(logicalSize * dpr);
    this.canvas.height = Math.round(logicalSize * dpr);
    this.canvas.style.width = `${logicalSize}px`;
    this.canvas.style.height = `${logicalSize}px`;
  }

  private advancePoseForAnim(anim: AnimationId, forceFresh = false): void {
    const nextStep = forceFresh ? 0 : this.poseRotationStep + 1;
    this.poseRotationStep = nextStep;
    const nextEntry = pickPoseForState(this.avatarStyle, anim, nextStep, this.activePoseId);
    if (nextEntry.id !== this.activePoseId) {
      this.previousPoseId = this.activePoseId;
      this.activePoseId = nextEntry.id;
      this.poseBlend = 0;
      if (Math.abs(this.spring.squashScaleY - 1) < 0.04) {
        triggerSquash(this.spring, 0.94);
      }
    }
    this.poseHoldElapsedSec = 0;
  }

  getAvatarStyle(): AvatarStyle {
    return this.avatarStyle;
  }

  getCurrentPoseId(): string {
    return this.activePoseId;
  }

  updateConfig(opts: {
    weights?: AnimationWeights;
    avatarStyle?: AvatarStyle;
    fixedEnabled?: boolean;
    workStatusEnabled?: boolean;
    hueShift?: number;
    enableSound?: boolean;
  }): void {
    this.machine.updateOptions(opts);
    if (opts.hueShift !== undefined) this.hueShift = opts.hueShift;
    if (opts.enableSound !== undefined) setSoundEnabled(opts.enableSound);
    if (opts.avatarStyle !== undefined && opts.avatarStyle !== this.avatarStyle) {
      this.avatarStyle = opts.avatarStyle;
      this.poseRotationStep = 0;
      this.advancePoseForAnim(this.machine.getAnimation(), true);
    }
  }

  setMotionVelocity(vx: number, vy: number): void {
    this.velX = vx;
    this.velY = vy;
  }

  setLookTarget(nx: number, ny: number): void {
    this.lookX = Math.max(-1, Math.min(1, nx));
    this.lookY = Math.max(-1, Math.min(1, ny));
  }

  updatePointerProximity(distPx: number, dirX: number, cursorSpeedPxSec: number, dtSec = 0.06): void {
    const startled = updateCursorProximity(this.spring, distPx, dirX, cursorSpeedPxSec, dtSec);
    if (startled && !this.machine.isSleeping() && !this.machine.isDragging()) {
      playPetSound('meow_startle');
      this.machine.emitBubble('哇！鼠标嗖地划过去，吓得猫耳一竖喵~', 'click', Date.now(), {
        durationMs: 2800,
      });
    }
  }

  squash(targetScaleY = 0.72): void {
    triggerSquash(this.spring, targetScaleY);
  }

  onClick(): void {
    triggerSquash(this.spring, 0.78);
    playPetSound('click');
    this.machine.onClick(Date.now());
  }

  onDragStart(): void {
    this.sittingOnWindow = false;
    this.machine.onDragStart(Date.now());
  }

  onDragEnd(): void {
    this.machine.onDragEnd(Date.now());
  }

  triggerAction(anim: AnimationId, bubble?: string, force = false, lockMs = 5000): boolean {
    const prevStep = this.poseRotationStep;
    this.poseRotationStep = -1;
    const ok = this.machine.triggerAction(anim, Date.now(), bubble, force, lockMs);
    if (!ok) {
      this.poseRotationStep = prevStep;
      return false;
    }
    if (anim === 'click_happy' || anim === 'work_success') {
      triggerSquash(this.spring, 0.76);
    }
    return true;
  }

  setSleeping(sleeping: boolean): void {
    this.machine.setSleeping(sleeping, Date.now());
    this.onStateChange?.(this.machine.getAnimation(), this.machine.getFacing(), this.machine.isSleeping());
  }

  isSleeping(): boolean {
    return this.machine.isSleeping();
  }

  getAnimation(): AnimationId {
    return this.machine.getAnimation();
  }

  getFacing(): Facing {
    return this.machine.getFacing();
  }

  setFacing(facing: Facing): void {
    this.machine.setFacing(facing);
  }

  applyWorkStatus(snapshot: WorkStatusSnapshot | null): void {
    this.machine.applyWorkStatus(snapshot, Date.now());
  }

  showBubble(msg: BubbleMessage): void {
    if (!this.bubbleEl) return;
    if (this.bubbleTimer) {
      clearTimeout(this.bubbleTimer);
      this.bubbleTimer = null;
    }
    const textEl = this.bubbleEl.querySelector<HTMLElement>('.bubble-text') ?? this.bubbleEl;
    textEl.textContent = msg.text;
    this.bubbleEl.dataset.kind = msg.kind;
    this.bubbleEl.classList.remove('visible');
    void this.bubbleEl.offsetWidth;
    this.bubbleEl.classList.add('visible');
    this.bubbleTimer = setTimeout(() => {
      if (this.bubbleEl) this.bubbleEl.classList.remove('visible');
      this.bubbleTimer = null;
    }, msg.durationMs);
  }

  emitCustomBubble(text: string, kind: BubbleMessage['kind'] = 'whisper', durationMs = 7000): void {
    this.machine.emitBubble(text, kind, Date.now(), { durationMs, force: true });
  }

  private startLoop(): void {
    const tick = (nowPerf: number): void => {
      if (this.disposed) return;
      const dtSec = Math.min(0.05, Math.max(0.001, (nowPerf - this.lastFrameMs) / 1000));
      this.lastFrameMs = nowPerf;
      const nowMs = Date.now();
      const globalSec = (nowPerf - this.startMs) / 1000;

      this.machine.tick(nowMs);
      updateSecondarySpring(this.spring, dtSec, this.velX, this.velY, globalSec);

      // Smooth 0.35s crossfade pose transition & calm multi-pose rotation (10s in idle, 5.2s in active states)
      if (this.poseBlend < 1) {
        this.poseBlend = Math.min(1, this.poseBlend + dtSec / 0.35);
      }
      const currentAnim = this.machine.getAnimation();
      const pool = getPosePoolForState(this.avatarStyle, currentAnim);
      if (pool.length > 1 && !this.machine.isManualLocked(nowMs)) {
        const rotateIntervalSec = currentAnim === 'idle' ? 10.0 : 5.2;
        this.poseHoldElapsedSec += dtSec;
        if (this.poseHoldElapsedSec >= rotateIntervalSec) {
          this.advancePoseForAnim(currentAnim);
        }
      }

      const sitTarget = this.sittingOnWindow ? 1 : 0;
      this.spring.sitProgress += (sitTarget - this.spring.sitProgress) * (1 - Math.exp(-9 * dtSec));

      const pose = evaluateCatgirlPose(
        currentAnim,
        this.machine.getAnimationElapsedMs(nowMs) / 1000,
        globalSec,
        this.spring,
        this.machine.getFacing(),
      );

      renderCatgirlFrame(this.ctx, this.canvas.width, this.canvas.height, {
        pose,
        spring: this.spring,
        facing: this.machine.getFacing(),
        globalSec,
        anim: currentAnim,
        avatarStyle: this.avatarStyle,
        activePoseId: this.activePoseId,
        previousPoseId: this.previousPoseId,
        poseBlend: this.poseBlend,
        lookX: this.lookX,
        lookY: this.lookY,
        hueShift: this.hueShift,
        showShadow: !this.sittingOnWindow,
        assetBaseUrl: this.assetBaseUrl,
      });

      this.rafId = window.requestAnimationFrame(tick);
    };
    this.rafId = window.requestAnimationFrame(tick);
  }

  dispose(): void {
    this.disposed = true;
    if (this.rafId !== null) {
      window.cancelAnimationFrame(this.rafId);
      this.rafId = null;
    }
    if (this.bubbleTimer) {
      clearTimeout(this.bubbleTimer);
      this.bubbleTimer = null;
    }
  }
}
