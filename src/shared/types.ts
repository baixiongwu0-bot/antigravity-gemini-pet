/**
 * Shared types for Antigravity Gemini Starlight Catgirl Pet.
 * Used identically across Extension Host, IDE Sidebar Webview, and Electron Desktop Helper.
 */

export type DisplayMode = 'both' | 'ide' | 'desktop' | 'none';
export type AvatarStyle = 'chibi' | 'illust' | 'mixed';
export type PoseStyleKind = 'chibi' | 'illust';
export type Facing = 'left' | 'right';
export type Corner = 'bottom-right' | 'bottom-left' | 'top-right' | 'top-left';

/**
 * Antigravity Agent work status states.
 * Priority order (highest first): waiting > error > working > thinking > result > success
 */
export type WorkStatusState = 'waiting' | 'error' | 'working' | 'thinking' | 'result' | 'success';

export const WORK_STATUS_PRIORITY: Record<WorkStatusState, number> = {
  waiting: 60,
  error: 50,
  working: 40,
  thinking: 30,
  result: 20,
  success: 10,
};

export type AnimationId =
  | 'idle'
  | 'turn'
  | 'walk'
  | 'drag'
  | 'sleep_start'
  | 'sleep_loop'
  | 'sleep_end'
  | 'stretch'
  | 'peek'
  | 'hum'
  | 'groom'
  | 'toss_star'
  | 'star_magic'
  | 'spin_show'
  | 'eat_fish'
  | 'eat_cookie'
  | 'click_happy'
  | 'click_shy'
  | 'click_tsundere'
  | 'click_tickle'
  | 'click_wave'
  | 'work_thinking'
  | 'work_working'
  | 'work_result'
  | 'work_waiting'
  | 'work_success'
  | 'work_error';

export type SleepPhase = 'start' | 'loop' | 'end' | null;

export interface AnimationMeta {
  id: AnimationId;
  label: string;
  durationMs: number;
  loop: boolean;
  cooldownMs: number;
  noMirror?: boolean;
  bubbles?: string[];
}

export interface ActionCategory {
  id: string;
  label: string;
  weight: number;
  noMirror?: boolean;
  actions: AnimationId[];
}

export interface AnimationWeights {
  idle: number;
  turn: number;
  move: number;
}

export interface PhysicsConfig {
  gravity: number;
  restitution: number;
  groundFriction: number;
  ceilingBounce: boolean;
  throwPower: number;
  petCollision: boolean;
}

export interface PetPositionConfig {
  corner: Corner;
  marginX: number;
  marginY: number;
}

export interface PetInstanceConfig {
  id: string;
  name: string;
  size: number;
  display: DisplayMode;
  fixedEnabled: boolean;
  workStatusEnabled: boolean;
  variantHueShift: number;
  position: PetPositionConfig;
}

export interface WorkStatusSnapshot {
  state: WorkStatusState | null;
  task: string | null;
  source: string;
  updatedAt: number;
  expiresAt?: number;
  seq: number;
}

export interface BubbleMessage {
  text: string;
  kind: 'work' | 'whisper' | 'click' | 'sleep' | 'system';
  durationMs: number;
  createdAt: number;
  key?: string;
}

export interface PoseAssetEntry {
  id: string;
  file: string;
  style: PoseStyleKind;
  label: string;
  noMirror: boolean;
  width: number;
  height: number;
  visualScale: number;
  states: AnimationId[];
}

export interface SharedPetConfig {
  displayMode: DisplayMode;
  avatarStyle: AvatarStyle;
  enableAgentLink: boolean;
  enableTray: boolean;
  enableSound: boolean;
  physics: PhysicsConfig;
  weights: AnimationWeights;
  pets: PetInstanceConfig[];
}

export interface FlightPeerState {
  id: string;
  x: number;
  y: number;
  vx: number;
  vy: number;
  size: number;
}

export interface ServerCommandEvent {
  seq: number;
  petId?: string;
  action: string;
  anim?: AnimationId;
  text?: string;
  force?: boolean;
  lockMs?: number;
}

export interface ServerStateSnapshot {
  config: SharedPetConfig;
  workStatus: WorkStatusSnapshot;
  sleepByPet: Record<string, boolean>;
  serverPort: number;
  desktopRunning: boolean;
  electronPath: string | null;
  lastCommand?: ServerCommandEvent;
}
