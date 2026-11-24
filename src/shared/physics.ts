import type { FlightPeerState, PhysicsConfig } from './types';

/** Physics constants faithfully derived from dsh-pet */
export const SPRING_K = 200;
export const SPRING_C = 30;
export const TRAIL_KEEP_MS = 200;
export const RELEASE_WINDOW_MS = 150;
export const RELEASE_STALE_MS = 150;
export const MIN_SPAN_MS = 20;
export const SEG_MIN_DT_MS = 8;
export const DEAD_ZONE_SPEED = 500;
export const MAX_THROW_SPEED = 3600;
export const PEAK_WEIGHT = 0.5;
export const ACCEL_REF = 8000;
export const ACCEL_GAIN_MAX = 0.6;
export const REST_NORMAL = 40;
export const REST_TANGENT = 15;
export const MAX_STEP_DT = 0.05;
export const SUBSTEP_PX = 8;
export const SUBSTEP_MAX = 64;
export const SQ_SQUASH = 0.55;
export const SQ_DURATION_MS = 220;
export const SQ_SOFT_SPEED = 300;
export const SQ_HARD_SPEED = 1500;
export const PET_BOUNCE_E = 0.995;

export interface TrailSample {
  x: number;
  y: number;
  t: number;
}

export interface Rect {
  x: number;
  y: number;
  width: number;
  height: number;
}

export interface FlightBody {
  x: number;
  y: number;
  vx: number;
  vy: number;
  size: number;
  flying: boolean;
}

export interface SpringState {
  x: number;
  y: number;
  vx: number;
  vy: number;
}

/** Overdamped spring follower for smooth responsive dragging */
export function stepSpring(
  state: SpringState,
  targetX: number,
  targetY: number,
  dt: number,
  throwPower = 1,
): SpringState {
  const clampedDt = Math.min(Math.max(dt, 0.001), MAX_STEP_DT);
  const k = SPRING_K * Math.max(0.25, throwPower);
  const c = SPRING_C * Math.sqrt(Math.max(0.25, throwPower));
  const ax = k * (targetX - state.x) - c * state.vx;
  const ay = k * (targetY - state.y) - c * state.vy;
  const vx = state.vx + ax * clampedDt;
  const vy = state.vy + ay * clampedDt;
  return {
    x: state.x + vx * clampedDt,
    y: state.y + vy * clampedDt,
    vx,
    vy,
  };
}

/** Soft asymptotic speed cap: cap * (1 - exp(-speed / cap)) */
export function softCapSpeed(speed: number, cap: number): number {
  if (speed <= 0 || cap <= 0) return 0;
  return cap * (1 - Math.exp(-speed / cap));
}

/** Estimate throw velocity on mouse release using dsh-pet's trail window + peak blend */
export function estimateReleaseVelocity(
  trail: readonly TrailSample[],
  nowMs: number,
  throwPower = 1,
): { vx: number; vy: number; thrown: boolean } {
  if (trail.length < 2) return { vx: 0, vy: 0, thrown: false };
  const last = trail[trail.length - 1];
  if (nowMs - last.t > RELEASE_STALE_MS) {
    return { vx: 0, vy: 0, thrown: false };
  }

  const cutoff = last.t - RELEASE_WINDOW_MS;
  const recent = trail.filter((p) => p.t >= cutoff);
  if (recent.length < 2) return { vx: 0, vy: 0, thrown: false };

  const first = recent[0];
  const spanMs = last.t - first.t;
  if (spanMs < MIN_SPAN_MS) return { vx: 0, vy: 0, thrown: false };

  const spanSec = spanMs / 1000;
  const avgVx = (last.x - first.x) / spanSec;
  const avgVy = (last.y - first.y) / spanSec;
  const avgSpeed = Math.hypot(avgVx, avgVy);

  let peakSpeed = avgSpeed;
  let prevSegSpeed = avgSpeed;
  let endAccel = 0;
  for (let i = 1; i < recent.length; i++) {
    const dtMs = recent[i].t - recent[i - 1].t;
    if (dtMs < SEG_MIN_DT_MS) continue;
    const dtSec = dtMs / 1000;
    const segSpeed = Math.hypot(recent[i].x - recent[i - 1].x, recent[i].y - recent[i - 1].y) / dtSec;
    if (segSpeed > peakSpeed) peakSpeed = segSpeed;
    endAccel = (segSpeed - prevSegSpeed) / dtSec;
    prevSegSpeed = segSpeed;
  }

  let speed = avgSpeed * (1 - PEAK_WEIGHT) + peakSpeed * PEAK_WEIGHT;
  if (endAccel > 0) {
    const gain = Math.min(ACCEL_GAIN_MAX, (endAccel / ACCEL_REF) * ACCEL_GAIN_MAX);
    speed *= 1 + gain;
  }
  speed *= Math.max(0.25, throwPower);

  if (speed < DEAD_ZONE_SPEED || avgSpeed < 1e-3) {
    return { vx: 0, vy: 0, thrown: false };
  }

  const capped = softCapSpeed(speed, MAX_THROW_SPEED * Math.max(0.25, throwPower));
  const ux = avgVx / avgSpeed;
  const uy = avgVy / avgSpeed;
  return { vx: ux * capped, vy: uy * capped, thrown: true };
}

export interface StepFlightResult {
  impactSpeed: number;
  settled: boolean;
  hitWall: boolean;
  hitFloor: boolean;
  collidedPeerId?: string;
}

/**
 * Integrate one frame of throw flight with substepping, screen wall/floor/ceiling bounce,
 * ground friction, and optional multi-pet elastic collision.
 */
export function stepFlight(
  body: FlightBody,
  bounds: Rect,
  physics: PhysicsConfig,
  dt: number,
  peers: readonly FlightPeerState[] = [],
  selfId = 'main',
): StepFlightResult {
  if (!body.flying) {
    return { impactSpeed: 0, settled: true, hitWall: false, hitFloor: false };
  }

  const clampedDt = Math.min(Math.max(dt, 0.001), MAX_STEP_DT);
  const speed = Math.hypot(body.vx, body.vy);
  const steps = Math.max(1, Math.min(SUBSTEP_MAX, Math.ceil((speed * clampedDt) / SUBSTEP_PX)));
  const subDt = clampedDt / steps;

  const minX = bounds.x;
  const maxX = Math.max(bounds.x, bounds.x + bounds.width - body.size);
  const minY = bounds.y;
  const maxY = Math.max(bounds.y, bounds.y + bounds.height - body.size);

  let maxImpact = 0;
  let hitWall = false;
  let hitFloor = false;
  let collidedPeerId: string | undefined;

  for (let s = 0; s < steps; s++) {
    body.vy += physics.gravity * subDt;
    body.x += body.vx * subDt;
    body.y += body.vy * subDt;

    // Left / Right screen walls
    if (body.x < minX) {
      body.x = minX;
      const imp = Math.abs(body.vx);
      if (imp > maxImpact) maxImpact = imp;
      body.vx = Math.abs(body.vx) * physics.restitution;
      if (Math.abs(body.vx) < REST_NORMAL) body.vx = 0;
      hitWall = true;
    } else if (body.x > maxX) {
      body.x = maxX;
      const imp = Math.abs(body.vx);
      if (imp > maxImpact) maxImpact = imp;
      body.vx = -Math.abs(body.vx) * physics.restitution;
      if (Math.abs(body.vx) < REST_NORMAL) body.vx = 0;
      hitWall = true;
    }

    // Ceiling
    if (physics.ceilingBounce && body.y < minY) {
      body.y = minY;
      const imp = Math.abs(body.vy);
      if (imp > maxImpact) maxImpact = imp;
      body.vy = Math.abs(body.vy) * physics.restitution;
      if (Math.abs(body.vy) < REST_NORMAL) body.vy = 0;
    }

    // Floor
    if (body.y >= maxY) {
      body.y = maxY;
      const imp = Math.abs(body.vy);
      if (imp > REST_NORMAL) {
        if (imp > maxImpact) maxImpact = imp;
        body.vy = -imp * physics.restitution;
        hitFloor = true;
      } else {
        body.vy = 0;
      }
      // Tangential ground friction
      const damp = Math.exp(-physics.groundFriction * subDt);
      body.vx *= damp;
      if (Math.abs(body.vx) < REST_TANGENT) body.vx = 0;
    }

    // Multi-pet elastic collision (momentum conservation, mass proportional to size^2)
    if (physics.petCollision && peers.length > 0) {
      const r1 = body.size * 0.32;
      const cx1 = body.x + body.size * 0.5;
      const cy1 = body.y + body.size * 0.55;
      const m1 = body.size * body.size;
      for (const peer of peers) {
        if (peer.id === selfId) continue;
        const r2 = peer.size * 0.32;
        const cx2 = peer.x + peer.size * 0.5;
        const cy2 = peer.y + peer.size * 0.55;
        const dx = cx1 - cx2;
        const dy = cy1 - cy2;
        const dist = Math.hypot(dx, dy);
        const minDist = r1 + r2;
        if (dist > 0.001 && dist < minDist) {
          const nx = dx / dist;
          const ny = dy / dist;
          const overlap = minDist - dist;
          body.x += nx * overlap * 0.55;
          body.y += ny * overlap * 0.55;
          const rvx = body.vx - peer.vx;
          const rvy = body.vy - peer.vy;
          const velAlongNormal = rvx * nx + rvy * ny;
          if (velAlongNormal < 0) {
            const m2 = peer.size * peer.size;
            const j = (-(1 + PET_BOUNCE_E) * velAlongNormal) / (1 / m1 + 1 / m2);
            body.vx += (j / m1) * nx;
            body.vy += (j / m1) * ny;
            maxImpact = Math.max(maxImpact, Math.abs(velAlongNormal));
            collidedPeerId = peer.id;
          }
        }
      }
    }
  }

  const onFloor = Math.abs(body.y - maxY) <= 1.5;
  const settled =
    (physics.gravity > 0 && onFloor && Math.abs(body.vy) <= 1 && Math.abs(body.vx) < REST_TANGENT) ||
    (physics.gravity === 0 && Math.hypot(body.vx, body.vy) < REST_TANGENT);

  if (settled) {
    body.flying = false;
    body.vx = 0;
    body.vy = 0;
  }

  return { impactSpeed: maxImpact, settled, hitWall, hitFloor, collidedPeerId };
}

/** Map impact speed to squash scaleY (0.55 heavy impact -> 0.84 soft tap) */
export function squashScaleForImpact(impactSpeed: number): number {
  const t = Math.max(0, Math.min(1, (impactSpeed - SQ_SOFT_SPEED) / (SQ_HARD_SPEED - SQ_SOFT_SPEED)));
  return 0.84 - t * (0.84 - SQ_SQUASH);
}
