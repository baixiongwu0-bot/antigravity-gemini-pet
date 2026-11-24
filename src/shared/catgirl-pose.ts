import type { AnimationId, Facing } from './types';

export type EyeMood =
  | 'normal'
  | 'happy'
  | 'focused'
  | 'sleepy'
  | 'closed'
  | 'shy'
  | 'tsundere'
  | 'sparkle'
  | 'surprised'
  | 'sweat';

export type MouthMood = 'cat' | 'smile' | 'open_happy' | 'chew' | 'yawn' | 'pout' | 'o' | 'focused' | 'sleep';

export type PropKind =
  | 'none'
  | 'fish'
  | 'cookie'
  | 'laptop'
  | 'tossed_star'
  | 'magic_ring'
  | 'confetti_stars'
  | 'zzz'
  | 'question_star'
  | 'checklist'
  | 'music_notes'
  | 'thought_dots';

export interface CatgirlPose {
  bodyX: number;
  bodyY: number;
  bodyTilt: number;
  scaleX: number;
  scaleY: number;
  headTilt: number;
  headBob: number;
  earLeftAngle: number;
  earRightAngle: number;
  ahogeTilt: number;
  tailWag: number;
  tailLift: number;
  hairSway: number;
  skirtFlare: number;
  ribbonSway: number;
  leftArmAngle: number;
  rightArmAngle: number;
  leftArmLift: number;
  rightArmLift: number;
  leftLegAngle: number;
  rightLegAngle: number;
  leftLegLift: number;
  rightLegLift: number;
  eyeMood: EyeMood;
  mouthMood: MouthMood;
  blushAlpha: number;
  starClipGlow: number;
  orbitSpeed: number;
  orbitRadiusScale: number;
  prop: PropKind;
  propPhase: number;
  peekOffset: number;
  spinAngle: number;
  pupilGlow: number;
  sitProgress: number;
}

export interface SecondarySpring {
  hairAngle: number;
  hairVel: number;
  tailAngle: number;
  tailVel: number;
  ribbonAngle: number;
  ribbonVel: number;
  headLagAngle: number;
  headLagVel: number;
  ahogeAngle: number;
  ahogeVel: number;
  vel70X: number;
  vel70Y: number;
  vel130X: number;
  vel130Y: number;
  earTwitchL: number;
  earTwitchR: number;
  earBiasL: number;
  earBiasR: number;
  cursorProximity: number;
  pupilGlow: number;
  startleHop: number;
  startleVel: number;
  startleCooldown: number;
  sitProgress: number;
  blinkTimer: number;
  blinkProgress: number;
  squashScaleY: number;
  squashVel: number;
  nextEarTwitchAt: number;
}

export function createSecondarySpring(): SecondarySpring {
  return {
    hairAngle: 0,
    hairVel: 0,
    tailAngle: 0,
    tailVel: 0,
    ribbonAngle: 0,
    ribbonVel: 0,
    headLagAngle: 0,
    headLagVel: 0,
    ahogeAngle: 0,
    ahogeVel: 0,
    vel70X: 0,
    vel70Y: 0,
    vel130X: 0,
    vel130Y: 0,
    earTwitchL: 0,
    earTwitchR: 0,
    earBiasL: 0,
    earBiasR: 0,
    cursorProximity: 0,
    pupilGlow: 0,
    startleHop: 0,
    startleVel: 0,
    startleCooldown: 0,
    sitProgress: 0,
    blinkTimer: 2.4,
    blinkProgress: 0,
    squashScaleY: 1,
    squashVel: 0,
    nextEarTwitchAt: 4.2 + Math.random() * 1.8,
  };
}

export function triggerSquash(spring: SecondarySpring, targetScaleY: number): void {
  spring.squashScaleY = Math.max(0.52, Math.min(1.25, targetScaleY));
  spring.squashVel = 0;
}

export function triggerStartle(spring: SecondarySpring): boolean {
  if (spring.startleCooldown > 0) return false;
  spring.startleCooldown = 2.0;
  spring.startleVel = 180;
  spring.earTwitchL = 0.28;
  spring.earTwitchR = 0.28;
  triggerSquash(spring, 0.84);
  return true;
}

export function updateCursorProximity(
  spring: SecondarySpring,
  distPx: number,
  dirX: number,
  cursorSpeedPxSec: number,
  dtSec: number,
): boolean {
  const dt = Math.min(Math.max(dtSec, 0.001), 0.05);
  const prox = Number.isFinite(distPx) ? Math.max(0, Math.min(1, 1 - distPx / 160)) : 0;
  const alpha = 1 - Math.exp(-12 * dt);
  spring.cursorProximity += (prox - spring.cursorProximity) * alpha;
  spring.pupilGlow += (prox - spring.pupilGlow) * alpha;

  const clampedDir = Math.max(-1, Math.min(1, dirX));
  const targetL = prox * (clampedDir < 0 ? 0.14 : -0.05) * Math.abs(clampedDir);
  const targetR = prox * (clampedDir > 0 ? 0.14 : -0.05) * Math.abs(clampedDir);
  spring.earBiasL += (targetL - spring.earBiasL) * alpha;
  spring.earBiasR += (targetR - spring.earBiasR) * alpha;

  if (prox > 0.25 && cursorSpeedPxSec > 1350) {
    return triggerStartle(spring);
  }
  return false;
}

function step1DSpring(val: number, vel: number, target: number, k: number, c: number, dt: number): [number, number] {
  const acc = k * (target - val) - c * vel;
  const nextVel = vel + acc * dt;
  const nextVal = val + nextVel * dt;
  return [nextVal, nextVel];
}

export function updateSecondarySpring(
  spring: SecondarySpring,
  dtSec: number,
  velocityX: number,
  velocityY: number,
  tSec: number,
): void {
  const dt = Math.min(Math.max(dtSec, 0.001), 0.04);

  // Genuine phase-lagged motion filters: ~70ms for head, ~130ms for hair/tail/ribbons
  const a70 = 1 - Math.exp(-dt / 0.07);
  const a130 = 1 - Math.exp(-dt / 0.13);
  spring.vel70X += (velocityX - spring.vel70X) * a70;
  spring.vel70Y += (velocityY - spring.vel70Y) * a70;
  spring.vel130X += (velocityX - spring.vel130X) * a130;
  spring.vel130Y += (velocityY - spring.vel130Y) * a130;

  const headInertia = Math.max(-0.36, Math.min(0.36, -spring.vel70X / 1350));
  const inertia = Math.max(-0.55, Math.min(0.55, -spring.vel130X / 1050));
  const dropDrag = Math.max(-0.28, Math.min(0.28, -spring.vel130Y / 1500));

  [spring.headLagAngle, spring.headLagVel] = step1DSpring(
    spring.headLagAngle,
    spring.headLagVel,
    headInertia + Math.max(-0.14, Math.min(0.14, -spring.vel70Y / 2200)),
    150,
    18,
    dt,
  );
  [spring.hairAngle, spring.hairVel] = step1DSpring(spring.hairAngle, spring.hairVel, inertia + dropDrag * 0.42, 68, 9.5, dt);
  [spring.tailAngle, spring.tailVel] = step1DSpring(spring.tailAngle, spring.tailVel, inertia * 1.28, 60, 8.8, dt);
  [spring.ribbonAngle, spring.ribbonVel] = step1DSpring(
    spring.ribbonAngle,
    spring.ribbonVel,
    inertia * 1.15 + dropDrag * 0.35,
    56,
    8.2,
    dt,
  );
  [spring.ahogeAngle, spring.ahogeVel] = step1DSpring(spring.ahogeAngle, spring.ahogeVel, inertia * 1.45, 130, 11, dt);
  [spring.squashScaleY, spring.squashVel] = step1DSpring(spring.squashScaleY, spring.squashVel, 1.0, 240, 15, dt);

  // Startle hop spring decay
  spring.startleCooldown = Math.max(0, spring.startleCooldown - dt);
  [spring.startleHop, spring.startleVel] = step1DSpring(spring.startleHop, spring.startleVel, 0, 220, 19, dt);
  if (Math.abs(spring.startleHop) < 0.05 && Math.abs(spring.startleVel) < 0.5) {
    spring.startleHop = 0;
    spring.startleVel = 0;
  }

  // Organic blink
  spring.blinkTimer -= dt;
  if (spring.blinkTimer <= 0) {
    spring.blinkProgress += dt / 0.16;
    if (spring.blinkProgress >= 1) {
      spring.blinkProgress = 0;
      spring.blinkTimer = 2.6 + Math.random() * 3.1;
    }
  }

  // Idle single cat-ear twitch every 4~6 seconds
  spring.nextEarTwitchAt -= dt;
  if (spring.nextEarTwitchAt <= 0) {
    spring.nextEarTwitchAt = 4.0 + Math.random() * 2.0;
    if (Math.random() < 0.5) spring.earTwitchL = 0.24;
    else spring.earTwitchR = 0.24;
  }
  spring.earTwitchL *= Math.exp(-12 * dt);
  spring.earTwitchR *= Math.exp(-12 * dt);
  void tSec;
}

export function evaluateCatgirlPose(
  anim: AnimationId,
  elapsedSec: number,
  globalSec: number,
  spring: SecondarySpring,
  facing: Facing,
): CatgirlPose {
  const breath = Math.sin(globalSec * 2.35);
  const slowWave = Math.sin(globalSec * 1.45);
  const p: CatgirlPose = {
    bodyX: 0,
    bodyY: breath * 2.2,
    bodyTilt: slowWave * 0.024,
    scaleX: 1 / Math.sqrt(Math.max(0.65, spring.squashScaleY)),
    scaleY: spring.squashScaleY,
    headTilt: Math.sin(globalSec * 1.8) * 0.038 + spring.headLagAngle * 0.48,
    headBob: breath * 1.8,
    earLeftAngle: -0.04 + Math.sin(globalSec * 2.1) * 0.04 + spring.earTwitchL + spring.earBiasL,
    earRightAngle: 0.04 - Math.sin(globalSec * 2.1 + 0.5) * 0.04 - spring.earTwitchR - spring.earBiasR,
    ahogeTilt: Math.sin(globalSec * 3.2) * 0.14 + spring.ahogeAngle,
    tailWag: Math.sin(globalSec * 2.6) * 0.34 + spring.tailAngle,
    tailLift: 0,
    hairSway: Math.sin(globalSec * 1.9) * 0.1 + spring.hairAngle,
    skirtFlare: 1 + breath * 0.016,
    ribbonSway: Math.sin(globalSec * 2.2 + 0.6) * 0.14 + spring.ribbonAngle,
    leftArmAngle: 0.22 + breath * 0.05,
    rightArmAngle: -0.22 - breath * 0.05,
    leftArmLift: 0,
    rightArmLift: 0,
    leftLegAngle: -0.05,
    rightLegAngle: 0.05,
    leftLegLift: 0,
    rightLegLift: 0,
    eyeMood: 'normal',
    mouthMood: 'cat',
    blushAlpha: 0.42,
    starClipGlow: 0.58 + 0.22 * Math.sin(globalSec * 2.8) + spring.pupilGlow * 0.35,
    orbitSpeed: 1.0,
    orbitRadiusScale: 1.0,
    prop: 'none',
    propPhase: elapsedSec,
    peekOffset: 0,
    spinAngle: 0,
    pupilGlow: spring.pupilGlow,
    sitProgress: spring.sitProgress,
  };

  switch (anim) {
    case 'idle':
      break;

    case 'turn': {
      const k = Math.min(1, elapsedSec / 1.45);
      p.headTilt = Math.sin(k * Math.PI * 2) * 0.16;
      p.bodyTilt = Math.sin(k * Math.PI) * 0.06;
      p.earLeftAngle += 0.14 * Math.sin(k * Math.PI * 3);
      p.earRightAngle -= 0.14 * Math.sin(k * Math.PI * 3);
      p.scaleX *= 1 - 0.14 * Math.sin(k * Math.PI);
      p.mouthMood = 'smile';
      break;
    }

    case 'walk': {
      const stride = Math.sin(globalSec * 9.5);
      const bounce = Math.abs(Math.cos(globalSec * 9.5));
      p.bodyY = -bounce * 9.5;
      p.bodyTilt = stride * 0.075 + (facing === 'right' ? 0.05 : -0.05);
      p.headTilt = -stride * 0.05;
      p.leftArmAngle = 0.25 + stride * 0.55;
      p.rightArmAngle = -0.25 + stride * 0.55;
      p.leftLegAngle = -stride * 0.52;
      p.rightLegAngle = stride * 0.52;
      p.leftLegLift = Math.max(0, stride) * 8;
      p.rightLegLift = Math.max(0, -stride) * 8;
      p.tailWag = Math.sin(globalSec * 7.2) * 0.55;
      p.hairSway += Math.sin(globalSec * 9.5 - 0.5) * 0.18;
      p.eyeMood = 'happy';
      p.mouthMood = 'open_happy';
      break;
    }

    case 'drag': {
      const kick = Math.sin(globalSec * 15);
      p.bodyY = -12 + Math.sin(globalSec * 6) * 2.5;
      p.bodyTilt = spring.hairAngle * 0.65;
      p.headTilt = -spring.hairAngle * 0.35;
      p.earLeftAngle = -0.26;
      p.earRightAngle = 0.26;
      p.leftArmAngle = 0.95 + kick * 0.18;
      p.rightArmAngle = -0.95 - kick * 0.18;
      p.leftArmLift = 12;
      p.rightArmLift = 12;
      p.leftLegAngle = kick * 0.42;
      p.rightLegAngle = -kick * 0.42;
      p.tailWag = Math.sin(globalSec * 12) * 0.65;
      p.eyeMood = 'surprised';
      p.mouthMood = 'o';
      p.blushAlpha = 0.68;
      break;
    }

    case 'sleep_start': {
      const k = Math.min(1, elapsedSec / 1.8);
      p.bodyY = k * 24;
      p.bodyTilt = k * 0.08;
      p.headTilt = k * 0.16;
      p.earLeftAngle = -0.2 * k;
      p.earRightAngle = 0.2 * k;
      p.leftArmAngle = 0.45 + Math.sin(k * Math.PI) * 0.65;
      p.rightArmAngle = -0.45 - Math.sin(k * Math.PI) * 0.65;
      p.eyeMood = k < 0.65 ? 'sleepy' : 'closed';
      p.mouthMood = k > 0.2 && k < 0.72 ? 'yawn' : 'sleep';
      p.tailWag = Math.sin(globalSec * 1.1) * 0.14;
      p.starClipGlow = 0.35;
      break;
    }

    case 'sleep_loop': {
      const snore = Math.sin(globalSec * 1.45);
      p.bodyY = 26 + snore * 3.0;
      p.bodyTilt = 0.08 + snore * 0.02;
      p.headTilt = 0.18 + snore * 0.04;
      p.earLeftAngle = -0.24;
      p.earRightAngle = 0.24;
      p.leftArmAngle = 0.62;
      p.rightArmAngle = -0.62;
      p.leftLegAngle = -0.35;
      p.rightLegAngle = 0.35;
      p.leftLegLift = 6;
      p.rightLegLift = 6;
      p.tailWag = Math.sin(globalSec * 0.9) * 0.16;
      p.eyeMood = 'closed';
      p.mouthMood = 'sleep';
      p.blushAlpha = 0.55;
      p.starClipGlow = 0.28 + 0.12 * snore;
      p.orbitSpeed = 0.42;
      p.prop = 'zzz';
      break;
    }

    case 'sleep_end': {
      const k = Math.min(1, elapsedSec / 1.7);
      const lift = 1 - k;
      p.bodyY = lift * 24 - Math.sin(k * Math.PI) * 8;
      p.headTilt = lift * 0.16 - Math.sin(k * Math.PI) * 0.08;
      p.leftArmAngle = 1.25 * Math.sin(k * Math.PI);
      p.rightArmAngle = -1.25 * Math.sin(k * Math.PI);
      p.leftArmLift = 14 * Math.sin(k * Math.PI);
      p.rightArmLift = 14 * Math.sin(k * Math.PI);
      p.eyeMood = k < 0.45 ? 'sleepy' : 'happy';
      p.mouthMood = k < 0.5 ? 'yawn' : 'open_happy';
      p.starClipGlow = 0.45 + 0.5 * k;
      break;
    }

    case 'stretch': {
      const w = Math.sin(Math.min(1, elapsedSec / 2.8) * Math.PI);
      p.scaleY *= 1 + w * 0.12;
      p.scaleX *= 1 - w * 0.06;
      p.bodyY = -w * 10;
      p.headTilt = -w * 0.12;
      p.leftArmAngle = 0.25 + w * 1.9;
      p.rightArmAngle = -0.25 - w * 1.9;
      p.leftArmLift = w * 18;
      p.rightArmLift = w * 18;
      p.earLeftAngle = 0.18 * w;
      p.earRightAngle = -0.18 * w;
      p.tailLift = w * 16;
      p.eyeMood = w > 0.35 ? 'happy' : 'normal';
      p.mouthMood = w > 0.35 ? 'open_happy' : 'cat';
      break;
    }

    case 'peek': {
      const k = Math.min(1, elapsedSec / 3.8);
      const pop = k < 0.2 ? k / 0.2 : k > 0.82 ? (1 - k) / 0.18 : 1;
      p.peekOffset = pop * 64;
      p.bodyY = 16 * pop + Math.sin(globalSec * 3) * 2;
      p.bodyX = -14 * pop;
      p.headTilt = -0.14 * pop + Math.sin(globalSec * 2.2) * 0.06;
      p.earLeftAngle = 0.18 * pop;
      p.earRightAngle = -0.18 * pop;
      p.eyeMood = 'sparkle';
      p.mouthMood = 'cat';
      break;
    }

    case 'hum': {
      const sway = Math.sin(globalSec * 4.4);
      p.bodyTilt = sway * 0.11;
      p.headTilt = -sway * 0.13;
      p.bodyY = -Math.abs(sway) * 5;
      p.earLeftAngle = sway * 0.22;
      p.earRightAngle = sway * 0.22;
      p.tailWag = sway * 0.6;
      p.leftArmAngle = 0.45 + sway * 0.3;
      p.rightArmAngle = -0.45 + sway * 0.3;
      p.eyeMood = 'happy';
      p.mouthMood = 'smile';
      p.prop = 'music_notes';
      break;
    }

    case 'groom': {
      const pat = Math.sin(globalSec * 6.5);
      p.headTilt = 0.12 + pat * 0.08;
      p.rightArmAngle = -1.65 - pat * 0.22;
      p.rightArmLift = 16;
      p.leftArmAngle = 0.4;
      p.ahogeTilt = pat * 0.55;
      p.eyeMood = 'focused';
      p.mouthMood = 'cat';
      break;
    }

    case 'toss_star': {
      const cycle = (elapsedSec % 1.2) / 1.2;
      const tossImpulse = Math.sin(cycle * Math.PI);
      p.bodyY = -tossImpulse * 7;
      p.headTilt = -0.12 + tossImpulse * 0.16;
      p.leftArmAngle = 0.7 + tossImpulse * 0.9;
      p.rightArmAngle = -0.7 - tossImpulse * 0.9;
      p.leftArmLift = 10 + tossImpulse * 10;
      p.rightArmLift = 10 + tossImpulse * 10;
      p.tailWag = Math.sin(globalSec * 6) * 0.52;
      p.eyeMood = 'sparkle';
      p.mouthMood = 'open_happy';
      p.starClipGlow = 1.0;
      p.prop = 'tossed_star';
      p.propPhase = cycle;
      break;
    }

    case 'star_magic': {
      const pulse = Math.sin(globalSec * 5.2);
      p.bodyY = -10 + pulse * 5;
      p.leftArmAngle = 1.35 + pulse * 0.18;
      p.rightArmAngle = -1.35 - pulse * 0.18;
      p.leftArmLift = 14;
      p.rightArmLift = 14;
      p.hairSway += pulse * 0.22;
      p.skirtFlare = 1.1;
      p.eyeMood = 'sparkle';
      p.mouthMood = 'open_happy';
      p.starClipGlow = 1.25;
      p.orbitSpeed = 2.6;
      p.orbitRadiusScale = 1.18;
      p.prop = 'magic_ring';
      break;
    }

    case 'spin_show': {
      const k = Math.min(1, elapsedSec / 2.6);
      p.spinAngle = k * Math.PI * 2;
      p.scaleX *= Math.max(0.28, Math.abs(Math.cos(p.spinAngle)));
      p.bodyY = -Math.sin(k * Math.PI * 2) * 10;
      p.leftArmAngle = 1.1;
      p.rightArmAngle = -1.1;
      p.skirtFlare = 1.16;
      p.hairSway += 0.28;
      p.eyeMood = 'happy';
      p.mouthMood = 'open_happy';
      p.starClipGlow = 1.0;
      break;
    }

    case 'eat_fish':
    case 'eat_cookie': {
      const munch = Math.sin(globalSec * 10.5);
      p.bodyY = Math.abs(munch) * 2.5;
      p.headTilt = munch * 0.06;
      p.leftArmAngle = 0.92 + munch * 0.08;
      p.rightArmAngle = -0.92 - munch * 0.08;
      p.leftArmLift = 10;
      p.rightArmLift = 10;
      p.tailWag = Math.sin(globalSec * 7.5) * 0.55;
      p.eyeMood = 'happy';
      p.mouthMood = munch > 0 ? 'chew' : 'cat';
      p.blushAlpha = 0.62;
      p.prop = anim === 'eat_fish' ? 'fish' : 'cookie';
      break;
    }

    case 'click_happy': {
      const jump = Math.abs(Math.sin(elapsedSec * 7.5));
      p.bodyY = -jump * 24;
      p.leftArmAngle = 1.45;
      p.rightArmAngle = -1.45;
      p.leftArmLift = 14;
      p.rightArmLift = 14;
      p.tailWag = Math.sin(globalSec * 11) * 0.65;
      p.eyeMood = 'happy';
      p.mouthMood = 'open_happy';
      p.blushAlpha = 0.65;
      p.starClipGlow = 1.05;
      break;
    }

    case 'click_shy': {
      const shiver = Math.sin(globalSec * 20) * 0.03;
      p.bodyTilt = shiver;
      p.headTilt = 0.14;
      p.earLeftAngle = -0.25;
      p.earRightAngle = 0.25;
      p.leftArmAngle = 0.78;
      p.rightArmAngle = -0.78;
      p.leftArmLift = 10;
      p.rightArmLift = 10;
      p.eyeMood = 'shy';
      p.mouthMood = 'o';
      p.blushAlpha = 0.92;
      break;
    }

    case 'click_tsundere': {
      p.headTilt = -0.15;
      p.bodyTilt = 0.07;
      p.leftArmAngle = 0.68;
      p.rightArmAngle = -0.68;
      p.tailWag = Math.sin(globalSec * 9.5) * 0.75;
      p.earLeftAngle = -0.16;
      p.earRightAngle = 0.16;
      p.eyeMood = 'tsundere';
      p.mouthMood = 'pout';
      p.blushAlpha = 0.78;
      break;
    }

    case 'click_tickle': {
      const wiggle = Math.sin(globalSec * 16);
      p.bodyTilt = wiggle * 0.14;
      p.headTilt = -wiggle * 0.16;
      p.bodyY = -Math.abs(wiggle) * 10;
      p.leftArmAngle = 1.2 + wiggle * 0.35;
      p.rightArmAngle = -1.2 + wiggle * 0.35;
      p.ahogeTilt = wiggle * 0.5;
      p.eyeMood = 'happy';
      p.mouthMood = 'open_happy';
      p.blushAlpha = 0.75;
      break;
    }

    case 'click_wave': {
      const wave = Math.sin(globalSec * 11);
      p.bodyY = -4 + Math.sin(globalSec * 5) * 3;
      p.headTilt = -0.1;
      p.rightArmAngle = -1.9 + wave * 0.38;
      p.rightArmLift = 16;
      p.leftArmAngle = 0.35;
      p.eyeMood = 'sparkle';
      p.mouthMood = 'open_happy';
      p.starClipGlow = 1.0;
      break;
    }

    case 'work_thinking': {
      const pulse = 0.5 + 0.5 * Math.sin(globalSec * 7.2);
      p.headTilt = 0.11 + Math.sin(globalSec * 1.4) * 0.03;
      p.bodyTilt = -0.04;
      p.leftArmAngle = 1.38;
      p.leftArmLift = 16;
      p.rightArmAngle = -0.35;
      p.earLeftAngle = 0.08 + pulse * 0.08;
      p.earRightAngle = -0.05;
      p.tailWag = Math.sin(globalSec * 1.9) * 0.28;
      p.eyeMood = 'focused';
      p.mouthMood = 'focused';
      p.starClipGlow = 0.75 + pulse * 0.85;
      p.orbitSpeed = 1.85;
      p.prop = 'thought_dots';
      break;
    }

    case 'work_working': {
      const type = Math.sin(globalSec * 18);
      p.bodyY = -3 + Math.abs(Math.sin(globalSec * 6)) * 4;
      p.bodyTilt = 0.05;
      p.headTilt = -0.06 + Math.sin(globalSec * 4.5) * 0.04;
      p.leftArmAngle = 0.95 + type * 0.24;
      p.rightArmAngle = -0.95 + type * 0.24;
      p.leftArmLift = 10;
      p.rightArmLift = 10;
      p.tailWag = Math.sin(globalSec * 8.5) * 0.62;
      p.earLeftAngle = 0.14;
      p.earRightAngle = -0.14;
      p.eyeMood = 'sparkle';
      p.mouthMood = 'open_happy';
      p.starClipGlow = 1.15;
      p.orbitSpeed = 2.4;
      p.prop = 'laptop';
      break;
    }

    case 'work_result': {
      const nod = Math.sin(globalSec * 4.2);
      p.headTilt = nod * 0.08;
      p.leftArmAngle = 0.85;
      p.rightArmAngle = -1.15;
      p.rightArmLift = 12;
      p.eyeMood = 'happy';
      p.mouthMood = 'smile';
      p.starClipGlow = 0.9;
      p.prop = 'checklist';
      break;
    }

    case 'work_waiting': {
      const lean = Math.sin(globalSec * 3.8);
      p.bodyY = -4 + Math.abs(lean) * 4;
      p.headTilt = lean * 0.15;
      p.earLeftAngle = 0.22;
      p.earRightAngle = -0.22;
      p.leftArmAngle = 0.72 + lean * 0.16;
      p.rightArmAngle = -0.72 + lean * 0.16;
      p.leftArmLift = 8;
      p.rightArmLift = 8;
      p.eyeMood = 'sparkle';
      p.mouthMood = 'cat';
      p.starClipGlow = 0.95;
      p.prop = 'question_star';
      break;
    }

    case 'work_success': {
      const hop = Math.abs(Math.sin(elapsedSec * 7.2));
      p.bodyY = -hop * 32;
      p.bodyTilt = Math.sin(elapsedSec * 7.2) * 0.1;
      p.leftArmAngle = 1.75 + hop * 0.25;
      p.rightArmAngle = -1.75 - hop * 0.25;
      p.leftArmLift = 18;
      p.rightArmLift = 18;
      p.leftLegAngle = -hop * 0.35;
      p.rightLegAngle = hop * 0.35;
      p.tailWag = Math.sin(globalSec * 12) * 0.72;
      p.skirtFlare = 1.15;
      p.eyeMood = 'sparkle';
      p.mouthMood = 'open_happy';
      p.blushAlpha = 0.72;
      p.starClipGlow = 1.4;
      p.orbitSpeed = 3.0;
      p.orbitRadiusScale = 1.24;
      p.prop = 'confetti_stars';
      break;
    }

    case 'work_error': {
      const droop = Math.sin(globalSec * 4.5);
      p.bodyY = 8 + droop * 2.5;
      p.headTilt = -0.14 + droop * 0.04;
      p.earLeftAngle = -0.32;
      p.earRightAngle = 0.32;
      p.leftArmAngle = 0.95;
      p.rightArmAngle = -0.95;
      p.leftArmLift = 12;
      p.rightArmLift = 12;
      p.tailWag = Math.sin(globalSec * 2.4) * 0.16;
      p.eyeMood = 'sweat';
      p.mouthMood = 'pout';
      p.blushAlpha = 0.55;
      p.starClipGlow = 0.35;
      break;
    }
  }

  return p;
}
