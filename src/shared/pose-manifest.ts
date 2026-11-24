import type { AnimationId, AvatarStyle, PoseAssetEntry } from './types';

/**
 * Pure-transparent pose manifest synced with assets/poses/manifest.json (15 Chibi + 2 Illust).
 * All poses are text-free, tight-cropped flush to bottom, and free to mirror horizontally.
 */
export const POSE_MANIFEST_ENTRIES: readonly PoseAssetEntry[] = [
  {
    id: 'chibi_01_please',
    file: 'chibi/chibi_01_please.png',
    style: 'chibi',
    label: '乖巧合手',
    noMirror: false,
    width: 605,
    height: 640,
    visualScale: 0.9,
    states: ['idle', 'work_waiting', 'click_shy'],
  },
  {
    id: 'chibi_02_shock',
    file: 'chibi/chibi_02_shock.png',
    style: 'chibi',
    label: '惊吓捂脸',
    noMirror: false,
    width: 640,
    height: 632,
    visualScale: 0.919,
    states: ['work_error', 'drag'],
  },
  {
    id: 'chibi_03_fighting',
    file: 'chibi/chibi_03_fighting.png',
    style: 'chibi',
    label: '元气加油',
    noMirror: false,
    width: 640,
    height: 551,
    visualScale: 0.944,
    states: ['work_working', 'walk', 'star_magic', 'toss_star'],
  },
  {
    id: 'chibi_04_tired',
    file: 'chibi/chibi_04_tired.png',
    style: 'chibi',
    label: '脑容量告急',
    noMirror: false,
    width: 640,
    height: 625,
    visualScale: 0.998,
    states: ['work_thinking', 'work_error', 'stretch'],
  },
  {
    id: 'chibi_05_hooray',
    file: 'chibi/chibi_05_hooray.png',
    style: 'chibi',
    label: '欢呼庆祝',
    noMirror: false,
    width: 631,
    height: 640,
    visualScale: 0.967,
    states: ['work_success', 'click_happy', 'click_tickle', 'hum', 'spin_show', 'toss_star'],
  },
  {
    id: 'chibi_06_pout',
    file: 'chibi/chibi_06_pout.png',
    style: 'chibi',
    label: '抱臂傲娇',
    noMirror: false,
    width: 595,
    height: 640,
    visualScale: 0.9,
    states: ['click_tsundere'],
  },
  {
    id: 'chibi_07_melon',
    file: 'chibi/chibi_07_melon.png',
    style: 'chibi',
    label: '暗中吃瓜观察',
    noMirror: false,
    width: 640,
    height: 591,
    visualScale: 0.974,
    states: ['peek', 'work_waiting'],
  },
  {
    id: 'chibi_08_roger',
    file: 'chibi/chibi_08_roger.png',
    style: 'chibi',
    label: '元气收到',
    noMirror: false,
    width: 640,
    height: 598,
    visualScale: 0.943,
    states: ['work_working', 'work_result'],
  },
  {
    id: 'chibi_09_thanks',
    file: 'chibi/chibi_09_thanks.png',
    style: 'chibi',
    label: '温柔比心',
    noMirror: false,
    width: 623,
    height: 640,
    visualScale: 0.963,
    states: ['idle', 'work_success', 'work_result', 'click_wave', 'groom', 'turn'],
  },
  {
    id: 'chibi_10_happy',
    file: 'chibi/chibi_10_happy.png',
    style: 'chibi',
    label: '捧脸开心',
    noMirror: false,
    width: 640,
    height: 592,
    visualScale: 0.902,
    states: ['eat_fish', 'eat_cookie', 'click_wave', 'click_tickle', 'hum'],
  },
  {
    id: 'chibi_11_love',
    file: 'chibi/chibi_11_love.png',
    style: 'chibi',
    label: '抱心相伴',
    noMirror: false,
    width: 640,
    height: 611,
    visualScale: 1.006,
    states: ['idle', 'click_shy', 'groom', 'eat_cookie'],
  },
  {
    id: 'chibi_12_awesome',
    file: 'chibi/chibi_12_awesome.png',
    style: 'chibi',
    label: '点赞庆祝',
    noMirror: false,
    width: 640,
    height: 614,
    visualScale: 0.925,
    states: ['work_success', 'work_result', 'toss_star'],
  },
  {
    id: 'chibi_13_cry',
    file: 'chibi/chibi_13_cry.png',
    style: 'chibi',
    label: '擦泪委屈',
    noMirror: false,
    width: 637,
    height: 640,
    visualScale: 0.909,
    states: ['work_error', 'drag', 'click_shy'],
  },
  {
    id: 'chibi_14_coffee',
    file: 'chibi/chibi_14_coffee.png',
    style: 'chibi',
    label: '捧咖啡杯待机',
    noMirror: false,
    width: 595,
    height: 640,
    visualScale: 1,
    states: [
      'idle',
      'work_working',
      'work_thinking',
      'eat_cookie',
      'walk',
      'turn',
      'spin_show',
      'star_magic',
    ],
  },
  {
    id: 'chibi_15_sleep',
    file: 'chibi/chibi_15_sleep.png',
    style: 'chibi',
    label: '抱星打盹',
    noMirror: false,
    width: 640,
    height: 600,
    visualScale: 0.927,
    states: ['sleep_start', 'sleep_loop', 'sleep_end', 'stretch'],
  },
  {
    id: 'illust_01_full',
    file: 'illust/illust_01_full.png',
    style: 'illust',
    label: '星芒猫娘全身立绘',
    noMirror: false,
    width: 382,
    height: 640,
    visualScale: 1,
    states: [
      'idle',
      'walk',
      'turn',
      'stretch',
      'peek',
      'hum',
      'groom',
      'toss_star',
      'star_magic',
      'spin_show',
      'eat_fish',
      'eat_cookie',
      'click_happy',
      'click_tickle',
      'click_wave',
      'work_thinking',
      'work_working',
      'work_result',
      'work_waiting',
      'work_success',
      'sleep_start',
      'sleep_loop',
      'sleep_end',
    ],
  },
  {
    id: 'illust_02_shy_stand',
    file: 'illust/illust_02_shy_stand.png',
    style: 'illust',
    label: '微羞乖巧立绘',
    noMirror: false,
    width: 461,
    height: 640,
    visualScale: 1.015,
    states: [
      'idle',
      'turn',
      'peek',
      'groom',
      'click_shy',
      'click_tsundere',
      'click_tickle',
      'drag',
      'work_thinking',
      'work_waiting',
      'work_error',
      'sleep_start',
      'sleep_loop',
      'sleep_end',
    ],
  },
];

const POSE_BY_ID = new Map<string, PoseAssetEntry>(POSE_MANIFEST_ENTRIES.map((p) => [p.id, p]));

export function resolvePoseEntryById(id: string | null | undefined): PoseAssetEntry | null {
  if (!id) return null;
  return POSE_BY_ID.get(id) ?? null;
}

function prioritizeIdFirst(pool: PoseAssetEntry[], preferredId: string): PoseAssetEntry[] {
  const idx = pool.findIndex((p) => p.id === preferredId);
  if (idx <= 0) return pool;
  return [pool[idx], ...pool.slice(0, idx), ...pool.slice(idx + 1)];
}

export function getPosePoolForState(style: AvatarStyle, anim: AnimationId): PoseAssetEntry[] {
  const collectSingleStyle = (target: 'chibi' | 'illust'): PoseAssetEntry[] => {
    let matches = POSE_MANIFEST_ENTRIES.filter((p) => p.style === target && p.states.includes(anim));
    if (matches.length === 0) {
      matches = POSE_MANIFEST_ENTRIES.filter((p) => p.style === target && p.states.includes('idle'));
    }
    if (target === 'chibi') {
      if (anim === 'idle') {
        matches = prioritizeIdFirst(matches, 'chibi_14_coffee');
      } else if (anim === 'click_happy') {
        matches = prioritizeIdFirst(matches, 'chibi_05_hooray');
      } else if (anim === 'eat_fish' || anim === 'eat_cookie') {
        matches = prioritizeIdFirst(matches, 'chibi_10_happy');
      } else if (anim === 'click_wave') {
        matches = prioritizeIdFirst(prioritizeIdFirst(matches, 'chibi_10_happy'), 'chibi_09_thanks');
      } else if (anim === 'peek') {
        matches = prioritizeIdFirst(matches, 'chibi_07_melon');
      } else if (anim === 'click_tsundere') {
        matches = prioritizeIdFirst(matches, 'chibi_06_pout');
      } else if (anim === 'sleep_start' || anim === 'sleep_loop' || anim === 'sleep_end') {
        matches = prioritizeIdFirst(matches, 'chibi_15_sleep');
      }
    } else if (target === 'illust' && anim === 'idle') {
      matches = prioritizeIdFirst(matches, 'illust_01_full');
    }
    return matches;
  };

  if (style === 'chibi') return collectSingleStyle('chibi');
  if (style === 'illust') return collectSingleStyle('illust');

  const chibiPool = collectSingleStyle('chibi');
  const illustPool = collectSingleStyle('illust');
  const merged: PoseAssetEntry[] = [];
  const maxLen = Math.max(chibiPool.length, illustPool.length);
  for (let i = 0; i < maxLen; i++) {
    if (i < chibiPool.length) merged.push(chibiPool[i]);
    if (i < illustPool.length) merged.push(illustPool[i]);
  }
  return merged;
}

export function pickPoseForState(
  style: AvatarStyle,
  anim: AnimationId,
  rotationStep: number,
  currentPoseId?: string,
): PoseAssetEntry {
  const pool = getPosePoolForState(style, anim);
  if (pool.length === 0) {
    return POSE_MANIFEST_ENTRIES[0];
  }
  if (pool.length === 1) {
    return pool[0];
  }
  let idx = Math.abs(Math.floor(rotationStep)) % pool.length;
  if (rotationStep > 0 && currentPoseId && pool[idx].id === currentPoseId) {
    idx = (idx + 1) % pool.length;
  }
  return pool[idx];
}
