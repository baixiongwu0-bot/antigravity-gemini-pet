import { STAGE_SIZE } from './config';
import type { CatgirlPose, SecondarySpring } from './catgirl-pose';
import { pickPoseForState, POSE_MANIFEST_ENTRIES, resolvePoseEntryById } from './pose-manifest';
import type { AnimationId, AvatarStyle, Facing, PoseAssetEntry } from './types';

export interface RenderOptions {
  pose: CatgirlPose;
  spring: SecondarySpring;
  facing: Facing;
  globalSec: number;
  anim?: AnimationId;
  avatarStyle?: AvatarStyle;
  activePoseId?: string;
  previousPoseId?: string | null;
  poseBlend?: number;
  lookX?: number;
  lookY?: number;
  hueShift?: number;
  showShadow?: boolean;
  assetBaseUrl?: string;
}

/** Logical stage placement (bottom-anchored inside 360x360 canvas) */
const STAGE_ROOT_X = 180;
const STAGE_ROOT_Y = 330;
const MAX_POSE_W = 246;
const MAX_POSE_H = 266;

interface PoseBank {
  baseUrl: string;
  images: Map<string, HTMLImageElement>;
}

let activeBank: PoseBank | null = null;
let configuredBaseUrl = '';

function resolveDefaultAssetBaseUrl(): string {
  if (configuredBaseUrl) return configuredBaseUrl;
  if (typeof window !== 'undefined') {
    const g = window as unknown as { __GEMINI_PET_ASSET_BASE__?: string };
    if (typeof g.__GEMINI_PET_ASSET_BASE__ === 'string' && g.__GEMINI_PET_ASSET_BASE__.trim()) {
      return g.__GEMINI_PET_ASSET_BASE__.trim();
    }
  }
  return 'assets/poses';
}

export function setCatgirlAssetBaseUrl(baseUrl: string): void {
  const normalized = baseUrl.replace(/\/+$/, '');
  if (!normalized) return;
  configuredBaseUrl = normalized;
  if (!activeBank || activeBank.baseUrl !== normalized) {
    ensurePoseBank(normalized);
  }
}

function loadPoseImage(bank: PoseBank, entry: PoseAssetEntry): HTMLImageElement {
  const existing = bank.images.get(entry.id);
  if (existing) return existing;
  const img = new Image();
  img.decoding = 'async';
  img.src = `${bank.baseUrl}/${entry.file}`;
  if (typeof img.decode === 'function') {
    void img.decode().catch(() => {});
  }
  bank.images.set(entry.id, img);
  return img;
}

function ensurePoseBank(baseUrl?: string): PoseBank | null {
  if (typeof Image === 'undefined') return null;
  const resolved = (baseUrl || resolveDefaultAssetBaseUrl()).replace(/\/+$/, '');
  if (activeBank && activeBank.baseUrl === resolved) {
    return activeBank;
  }

  const bank: PoseBank = { baseUrl: resolved, images: new Map() };
  // Eagerly queue startup poses first so initial & smoke frames decode immediately
  const priorityIds = ['chibi_14_coffee', 'chibi_10_happy', 'illust_01_full'];
  for (const id of priorityIds) {
    const entry = resolvePoseEntryById(id);
    if (entry) loadPoseImage(bank, entry);
  }
  for (const entry of POSE_MANIFEST_ENTRIES) {
    loadPoseImage(bank, entry);
  }

  activeBank = bank;
  return activeBank;
}

export function preloadCatgirlAssets(baseUrl?: string): void {
  ensurePoseBank(baseUrl);
}

function getReadyPoseImage(bank: PoseBank | null, entry: PoseAssetEntry): HTMLImageElement | null {
  if (!bank) return null;
  const img = loadPoseImage(bank, entry);
  if (!img.complete || img.naturalWidth <= 0) return null;
  return img;
}

/** Draw a crisp Gemini 4-point concave star */
export function traceGeminiStar(ctx: CanvasRenderingContext2D, cx: number, cy: number, r: number, innerRatio = 0.27): void {
  const k = r * innerRatio;
  ctx.beginPath();
  ctx.moveTo(cx, cy - r);
  ctx.quadraticCurveTo(cx + k * 0.45, cy - k * 0.45, cx + r, cy);
  ctx.quadraticCurveTo(cx + k * 0.45, cy + k * 0.45, cx, cy + r);
  ctx.quadraticCurveTo(cx - k * 0.45, cy + k * 0.45, cx - r, cy);
  ctx.quadraticCurveTo(cx - k * 0.45, cy - k * 0.45, cx, cy - r);
  ctx.closePath();
}

function drawMicroSparkle(
  ctx: CanvasRenderingContext2D,
  cx: number,
  cy: number,
  r: number,
  rot: number,
  colorA: string,
  colorB: string,
  alpha = 0.9,
): void {
  ctx.save();
  ctx.translate(cx, cy);
  ctx.rotate(rot);
  ctx.globalAlpha *= alpha;
  traceGeminiStar(ctx, 0, 0, r, 0.26);
  const grad = ctx.createLinearGradient(-r, -r, r, r);
  grad.addColorStop(0, colorA);
  grad.addColorStop(1, colorB);
  ctx.fillStyle = grad;
  ctx.fill();
  ctx.restore();
}

function drawOrbitingGeminiStar(
  ctx: CanvasRenderingContext2D,
  cx: number,
  cy: number,
  radius: number,
  rot: number,
  glowStrength: number,
  colorA: string,
  colorB: string,
  auraColor: string,
): void {
  ctx.save();
  ctx.translate(cx, cy);

  if (glowStrength > 0.05) {
    const auraR = radius * (1.85 + glowStrength * 0.45);
    const aura = ctx.createRadialGradient(0, 0, 2, 0, 0, auraR);
    aura.addColorStop(0, auraColor);
    aura.addColorStop(1, 'rgba(160, 140, 255, 0)');
    ctx.fillStyle = aura;
    ctx.beginPath();
    ctx.arc(0, 0, auraR, 0, Math.PI * 2);
    ctx.fill();
  }

  ctx.rotate(rot);
  traceGeminiStar(ctx, 0, 0, radius, 0.28);
  const grad = ctx.createLinearGradient(-radius, -radius, radius, radius);
  grad.addColorStop(0, colorA);
  grad.addColorStop(1, colorB);
  ctx.fillStyle = grad;
  ctx.fill();

  ctx.strokeStyle = 'rgba(255, 255, 255, 0.85)';
  ctx.lineWidth = 1.2;
  ctx.stroke();

  // Inner bright core gleam
  traceGeminiStar(ctx, 0, 0, radius * 0.42, 0.26);
  ctx.fillStyle = 'rgba(255, 255, 255, 0.78)';
  ctx.fill();
  ctx.restore();
}

function drawWholePoseImage(
  ctx: CanvasRenderingContext2D,
  img: HTMLImageElement,
  entry: PoseAssetEntry,
  pose: CatgirlPose,
  spring: SecondarySpring,
  facing: Facing,
  globalSec: number,
  clampedBodyX: number,
  clampedBodyY: number,
  lookX: number,
  lookY: number,
  alpha: number,
): void {
  if (alpha <= 0.01) return;
  const imgW = img.naturalWidth || entry.width;
  const imgH = img.naturalHeight || entry.height;
  if (imgW <= 0 || imgH <= 0) return;

  const visualScale = entry.visualScale ?? 1.0;
  const fitScale = Math.min(MAX_POSE_W / imgW, MAX_POSE_H / imgH) * visualScale;
  const breath = Math.sin(globalSec * 2.35);
  const breathScaleX = 1 - breath * 0.01;
  const breathScaleY = 1 + breath * 0.015;

  // Velocity inertia tilt + gentle cursor look micro-sway around bottom anchor
  const inertiaTilt = Math.max(-0.14, Math.min(0.14, -spring.vel130X / 2400));
  const lookTilt = Math.max(-0.04, Math.min(0.04, lookX * 0.025));
  const rawTilt = pose.bodyTilt * 0.55 + inertiaTilt + lookTilt;
  const finalTilt = Math.max(-0.18, Math.min(0.18, rawTilt));

  const flipSign = entry.noMirror || facing === 'left' ? 1 : -1;
  const spinCos = !entry.noMirror && pose.spinAngle !== 0 ? Math.max(0.26, Math.abs(Math.cos(pose.spinAngle))) : 1;

  const scaleX = Math.max(0.68, Math.min(1.32, pose.scaleX)) * breathScaleX * spinCos;
  const scaleY = Math.max(0.68, Math.min(1.32, pose.scaleY)) * breathScaleY;

  const parallaxX = lookX * 3.0;
  const parallaxY = lookY * 2.2;

  ctx.save();
  if (alpha < 0.999) ctx.globalAlpha *= alpha;
  ctx.translate(STAGE_ROOT_X + clampedBodyX + parallaxX, STAGE_ROOT_Y + clampedBodyY + parallaxY);
  ctx.rotate(finalTilt);
  ctx.scale(flipSign * scaleX * fitScale, scaleY * fitScale);
  // Flush bottom anchor (-imgH) so tight-cropped character feet sit directly on ground baseline
  ctx.translate(-imgW * 0.5, -imgH);
  ctx.drawImage(img, 0, 0, imgW, imgH);
  ctx.restore();
}

function drawStateMicroAccents(ctx: CanvasRenderingContext2D, pose: CatgirlPose, globalSec: number): void {
  switch (pose.prop) {
    case 'none':
      break;

    case 'zzz': {
      ctx.save();
      ctx.font = 'bold 16px "Segoe UI", sans-serif';
      for (let i = 0; i < 3; i++) {
        const cyc = (globalSec * 0.45 + i * 0.33) % 1;
        const alpha = (1 - cyc) * Math.min(1, cyc * 4);
        ctx.fillStyle = `rgba(218, 206, 255, ${alpha.toFixed(3)})`;
        ctx.strokeStyle = `rgba(42, 30, 78, ${(alpha * 0.85).toFixed(3)})`;
        ctx.lineWidth = 2.5;
        const zx = 250 + i * 12 + Math.sin(globalSec * 2 + i) * 3;
        const zy = 104 - cyc * 44;
        const ch = i === 2 ? 'Z' : 'z';
        ctx.strokeText(ch, zx, zy);
        ctx.fillText(ch, zx, zy);
      }
      ctx.restore();
      break;
    }

    case 'music_notes': {
      ctx.save();
      ctx.font = 'bold 18px "Segoe UI", sans-serif';
      for (let i = 0; i < 2; i++) {
        const cyc = (globalSec * 0.75 + i * 0.48) % 1;
        const alpha = (1 - cyc) * Math.min(1, cyc * 4);
        ctx.fillStyle = i === 0 ? `rgba(245, 152, 234, ${alpha.toFixed(3)})` : `rgba(128, 214, 255, ${alpha.toFixed(3)})`;
        ctx.fillText(i === 0 ? '♪' : '♫', 68 + i * 214, 114 - cyc * 34);
      }
      ctx.restore();
      break;
    }

    case 'thought_dots': {
      ctx.save();
      for (let i = 0; i < 3; i++) {
        const pulse = 0.5 + 0.5 * Math.sin(globalSec * 5 - i * 1.1);
        ctx.fillStyle = `rgba(204, 186, 255, ${(0.46 + pulse * 0.5).toFixed(3)})`;
        ctx.beginPath();
        ctx.arc(262 + i * 11, 92 - i * 8, 3.0 + i * 1.1, 0, Math.PI * 2);
        ctx.fill();
      }
      ctx.restore();
      break;
    }

    case 'question_star': {
      const bob = Math.sin(globalSec * 4) * 4;
      ctx.save();
      ctx.fillStyle = '#ffe994';
      ctx.strokeStyle = '#3a2856';
      ctx.lineWidth = 3;
      ctx.font = 'bold 22px "Segoe UI", sans-serif';
      ctx.strokeText('?', 272, 84 + bob);
      ctx.fillText('?', 272, 84 + bob);
      ctx.restore();
      break;
    }

    case 'checklist': {
      ctx.save();
      ctx.translate(284, 168 + Math.sin(globalSec * 3) * 3);
      ctx.fillStyle = 'rgba(26, 22, 58, 0.88)';
      ctx.strokeStyle = 'rgba(176, 156, 255, 0.9)';
      ctx.lineWidth = 1.6;
      ctx.beginPath();
      ctx.roundRect(-14, -14, 28, 28, 8);
      ctx.fill();
      ctx.stroke();
      ctx.strokeStyle = '#9ef7c8';
      ctx.lineWidth = 2.4;
      ctx.lineCap = 'round';
      ctx.lineJoin = 'round';
      ctx.beginPath();
      ctx.moveTo(-6, 0);
      ctx.lineTo(-1, 5);
      ctx.lineTo(7, -5);
      ctx.stroke();
      ctx.restore();
      break;
    }

    case 'laptop': {
      const pulse = 0.72 + 0.28 * Math.sin(globalSec * 8);
      ctx.save();
      ctx.translate(286, 174 + Math.sin(globalSec * 5) * 2.5);
      ctx.fillStyle = 'rgba(22, 20, 56, 0.86)';
      ctx.strokeStyle = `rgba(120, 224, 255, ${pulse.toFixed(3)})`;
      ctx.lineWidth = 1.5;
      ctx.beginPath();
      ctx.roundRect(-19, -12, 38, 24, 7);
      ctx.fill();
      ctx.stroke();
      ctx.fillStyle = '#9ee8ff';
      ctx.font = 'bold 11px monospace';
      ctx.textAlign = 'center';
      ctx.textBaseline = 'middle';
      ctx.fillText('</>', 0, 1);
      ctx.restore();
      break;
    }

    case 'fish': {
      const lanes = [58, 96, 264, 302, 76, 284];
      for (let i = 0; i < lanes.length; i++) {
        const cyc = (globalSec * 0.56 + i * 0.167) % 1;
        const alpha = Math.min(1, cyc * 4.5) * (1 - Math.pow(cyc, 2.6));
        if (alpha <= 0.02) continue;
        const px = lanes[i] + Math.sin(globalSec * 3.1 + i * 1.4) * 9;
        const py = 30 + cyc * 228;
        const rot = (i % 2 === 0 ? 1 : -1) * (globalSec * (1.8 + (i % 3) * 0.5) + i * 0.9);
        const sc = 0.78 + (i % 3) * 0.13;
        ctx.save();
        ctx.globalAlpha *= alpha;
        ctx.translate(px, py);
        ctx.rotate(rot);
        ctx.scale(sc, sc);
        ctx.fillStyle = i % 2 === 0 ? '#ffbe7d' : '#ffab68';
        ctx.strokeStyle = '#4a2e5c';
        ctx.lineWidth = 1.7;
        ctx.beginPath();
        ctx.ellipse(0, 0, 10.5, 5.2, 0, 0, Math.PI * 2);
        ctx.fill();
        ctx.stroke();
        ctx.beginPath();
        ctx.moveTo(8.5, 0);
        ctx.lineTo(15.5, -5);
        ctx.lineTo(15.5, 5);
        ctx.closePath();
        ctx.fill();
        ctx.stroke();
        ctx.fillStyle = '#4a2e5c';
        ctx.beginPath();
        ctx.arc(-4.5, -1, 1.1, 0, Math.PI * 2);
        ctx.fill();
        ctx.restore();
      }
      for (let i = 0; i < 4; i++) {
        const cyc = (globalSec * 0.7 + i * 0.25) % 1;
        const alpha = (1 - cyc) * Math.min(1, cyc * 4);
        drawMicroSparkle(
          ctx,
          56 + ((i * 78) % 248),
          56 + cyc * 170,
          5.8,
          globalSec * 2.8 + i,
          '#ffe694',
          '#ff9ce2',
          alpha * 0.9,
        );
      }
      break;
    }

    case 'cookie': {
      const lanes = [60, 100, 260, 300, 78, 282];
      for (let i = 0; i < lanes.length; i++) {
        const cyc = (globalSec * 0.54 + i * 0.167) % 1;
        const alpha = Math.min(1, cyc * 4.5) * (1 - Math.pow(cyc, 2.6));
        if (alpha <= 0.02) continue;
        const px = lanes[i] + Math.cos(globalSec * 2.9 + i * 1.3) * 9;
        const py = 32 + cyc * 224;
        const rot = (i % 2 === 0 ? -1 : 1) * (globalSec * (1.7 + (i % 3) * 0.5) + i * 0.8);
        const sc = 0.8 + (i % 3) * 0.12;
        ctx.save();
        ctx.globalAlpha *= alpha;
        ctx.translate(px, py);
        ctx.rotate(rot);
        ctx.scale(sc, sc);
        ctx.fillStyle = i % 2 === 0 ? '#f8d28c' : '#ffe0a3';
        ctx.strokeStyle = '#5c3c60';
        ctx.lineWidth = 1.6;
        traceGeminiStar(ctx, 0, 0, 10.5, 0.44);
        ctx.fill();
        ctx.stroke();
        ctx.fillStyle = i % 2 === 0 ? '#ff9ce2' : '#9be8ff';
        ctx.beginPath();
        ctx.arc(0, 0, 2.1, 0, Math.PI * 2);
        ctx.fill();
        ctx.restore();
      }
      for (let i = 0; i < 4; i++) {
        const cyc = (globalSec * 0.68 + i * 0.25) % 1;
        const alpha = (1 - cyc) * Math.min(1, cyc * 4);
        drawMicroSparkle(
          ctx,
          62 + ((i * 74) % 236),
          54 + cyc * 172,
          5.8,
          -globalSec * 2.6 + i,
          '#ffe694',
          '#c59eff',
          alpha * 0.9,
        );
      }
      break;
    }

    case 'magic_ring': {
      ctx.save();
      ctx.translate(180, 206);
      ctx.scale(1, 0.34);
      ctx.rotate(globalSec * 1.4);
      ctx.strokeStyle = 'rgba(164, 206, 255, 0.72)';
      ctx.lineWidth = 2.4;
      ctx.setLineDash([12, 8]);
      ctx.beginPath();
      ctx.arc(0, 0, 108, 0, Math.PI * 2);
      ctx.stroke();
      ctx.restore();
      for (let i = 0; i < 4; i++) {
        const a = globalSec * 2.1 + (i * Math.PI) / 2;
        drawMicroSparkle(
          ctx,
          180 + Math.cos(a) * 116,
          190 + Math.sin(a) * 52,
          7.5,
          globalSec * 2 + i,
          '#8be9ff',
          '#f7a6ee',
          0.85,
        );
      }
      break;
    }

    case 'confetti_stars': {
      for (let i = 0; i < 6; i++) {
        const cyc = (globalSec * 0.72 + i * 0.17) % 1;
        const sx = 64 + ((i * 49) % 232);
        const sy = 210 - cyc * 155;
        drawMicroSparkle(
          ctx,
          sx,
          sy,
          6.8,
          globalSec * 3.5 + i,
          i % 2 === 0 ? '#ffe98a' : '#8ce4ff',
          '#f6a4ec',
          1 - cyc,
        );
      }
      break;
    }

    case 'tossed_star':
      break;
  }
}

export function renderCatgirlFrame(
  ctx: CanvasRenderingContext2D,
  width: number,
  height: number,
  opts: RenderOptions,
): void {
  const {
    pose,
    spring,
    facing,
    globalSec,
    anim = 'idle',
    avatarStyle = 'chibi',
    activePoseId,
    previousPoseId,
    poseBlend = 1,
    lookX = 0,
    lookY = 0,
    hueShift = 0,
    showShadow = true,
    assetBaseUrl,
  } = opts;
  const bank = ensurePoseBank(assetBaseUrl);

  ctx.clearRect(0, 0, width, height);
  ctx.imageSmoothingEnabled = true;
  ctx.imageSmoothingQuality = 'high';

  const scale = Math.min(width, height) / STAGE_SIZE;
  ctx.save();
  ctx.scale(scale, scale);

  if (hueShift !== 0 && 'filter' in ctx) {
    ctx.filter = `hue-rotate(${hueShift}deg)`;
  }

  // Clamp body offsets so complete portrait stays neatly framed inside the 360x360 stage
  const clampedBodyY = Math.max(-28, Math.min(20, pose.bodyY - spring.startleHop + pose.sitProgress * 4));
  const clampedBodyX = Math.max(-24, Math.min(24, pose.bodyX));

  // Soft ground shadow beneath bottom-anchored character
  if (showShadow && pose.peekOffset < 10 && pose.sitProgress < 0.65) {
    const airFactor = Math.max(0.32, 1 - Math.abs(clampedBodyY) / 72) * (1 - pose.sitProgress);
    ctx.save();
    ctx.fillStyle = `rgba(38, 24, 72, ${(0.22 * airFactor).toFixed(3)})`;
    ctx.beginPath();
    ctx.ellipse(STAGE_ROOT_X + clampedBodyX, 331, 56 * airFactor, 9.5 * airFactor, 0, 0, Math.PI * 2);
    ctx.fill();
    ctx.restore();
  }

  // Resolve current and previous full-body pose entries (never split into parts!)
  const currEntry = resolvePoseEntryById(activePoseId) ?? pickPoseForState(avatarStyle, anim, 0);
  const prevEntry = previousPoseId ? resolvePoseEntryById(previousPoseId) : null;
  const currImg = getReadyPoseImage(bank, currEntry);
  const prevImg = prevEntry && prevEntry.id !== currEntry.id ? getReadyPoseImage(bank, prevEntry) : null;

  const easedBlend = poseBlend >= 1 ? 1 : poseBlend * poseBlend * (3 - 2 * poseBlend);

  if (prevImg && easedBlend < 0.999) {
    drawWholePoseImage(
      ctx,
      prevImg,
      prevEntry!,
      pose,
      spring,
      facing,
      globalSec,
      clampedBodyX,
      clampedBodyY,
      lookX,
      lookY,
      currImg ? 1 - easedBlend : 1,
    );
  }

  if (currImg) {
    drawWholePoseImage(
      ctx,
      currImg,
      currEntry,
      pose,
      spring,
      facing,
      globalSec,
      clampedBodyX,
      clampedBodyY,
      lookX,
      lookY,
      prevImg && easedBlend < 0.999 ? easedBlend : 1,
    );
  } else if (!prevImg) {
    // Graceful fallback while image decodes on first frame
    const fallbackEntry = resolvePoseEntryById(avatarStyle === 'illust' ? 'illust_01_full' : 'chibi_14_coffee');
    const fallbackImg = fallbackEntry ? getReadyPoseImage(bank, fallbackEntry) : null;
    if (fallbackEntry && fallbackImg) {
      drawWholePoseImage(
        ctx,
        fallbackImg,
        fallbackEntry,
        pose,
        spring,
        facing,
        globalSec,
        clampedBodyX,
        clampedBodyY,
        lookX,
        lookY,
        1,
      );
    }
  }

  // Outer floating Gemini 4-point stars (orbiting outside main portrait)
  const bobL = Math.sin(globalSec * 1.9 * pose.orbitSpeed) * 9;
  const swayL = Math.sin(globalSec * 1.15 * pose.orbitSpeed) * 5 * pose.orbitRadiusScale;
  const starLx = 54 + clampedBodyX * 0.45 + swayL;
  const starLy = 122 + clampedBodyY * 0.4 + bobL;
  drawOrbitingGeminiStar(
    ctx,
    starLx,
    starLy,
    13 + 1.2 * Math.sin(globalSec * 2.5),
    Math.sin(globalSec * 1.3 * pose.orbitSpeed) * 0.22,
    pose.starClipGlow,
    '#9ae8ff',
    '#9a8fff',
    'rgba(120, 212, 255, 0.42)',
  );

  let starRx = 306 + clampedBodyX * 0.45 - swayL;
  let starRy = 108 + clampedBodyY * 0.4 + Math.cos(globalSec * 1.65 * pose.orbitSpeed) * 9;
  let starRRot = -Math.sin(globalSec * 1.45 * pose.orbitSpeed) * 0.22;
  let starRRadius = 14 + 1.2 * Math.cos(globalSec * 2.3);
  if (pose.prop === 'tossed_star') {
    const arc = Math.sin(pose.propPhase * Math.PI);
    starRy -= arc * 48;
    starRx += Math.cos(pose.propPhase * Math.PI) * 10;
    starRRot = pose.propPhase * Math.PI * 2;
    starRRadius = 16.5;
  }
  drawOrbitingGeminiStar(
    ctx,
    starRx,
    starRy,
    starRRadius,
    starRRot,
    pose.starClipGlow,
    '#c7a6ff',
    '#ff9ce2',
    'rgba(186, 148, 255, 0.42)',
  );

  // Subtle orbiting micro-sparkles around outer perimeter
  drawMicroSparkle(
    ctx,
    44 + Math.sin(globalSec * 1.7) * 5,
    228 + Math.cos(globalSec * 2.1) * 7,
    5.4,
    globalSec * 1.8,
    '#9be8ff',
    '#eab0ff',
    0.58 + 0.25 * Math.sin(globalSec * 3.1),
  );
  drawMicroSparkle(
    ctx,
    314 + Math.cos(globalSec * 1.5) * 5,
    220 + Math.sin(globalSec * 2.3) * 7,
    5.8,
    -globalSec * 1.6,
    '#ffe596',
    '#f6a4ec',
    0.58 + 0.25 * Math.cos(globalSec * 2.9),
  );

  // Lightweight state particle accents (zzZ, fish, cookie, laptop, music notes, etc.)
  drawStateMicroAccents(ctx, pose, globalSec);

  ctx.restore();
}
