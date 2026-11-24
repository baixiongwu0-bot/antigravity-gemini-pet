import type {
  ActionCategory,
  AnimationId,
  AnimationMeta,
  AnimationWeights,
  AvatarStyle,
  PetInstanceConfig,
  PhysicsConfig,
  SharedPetConfig,
  WorkStatusState,
} from './types';

/** Logical square canvas size used by renderer & hit-box math */
export const STAGE_SIZE = 360;

/** Hit box in logical canvas coordinates (matches pointer-target.js in electron-helper) */
export const HIT_BOX = {
  x0: 88,
  y0: 56,
  x1: 272,
  y1: 334,
} as const;

export const BUBBLE_DURATION_MS = 8500;
export const BUBBLE_DEBOUNCE_MS = 1800;
export const CLICK_BUBBLE_COOLDOWN_MS = 1200;

export const DEFAULT_PHYSICS: PhysicsConfig = {
  gravity: 1400,
  restitution: 0.78,
  groundFriction: 2.5,
  ceilingBounce: true,
  throwPower: 1.0,
  petCollision: true,
};

/**
 * Top-level animation weights (mirrors dsh-pet).
 * idle (15) + turn (8) + move (10) + categories (25 + 24 + 18 = 67) = 100.
 */
export const DEFAULT_WEIGHTS: AnimationWeights = {
  idle: 15,
  turn: 8,
  move: 10,
};

export const ACTION_CATEGORIES: ActionCategory[] = [
  {
    id: 'leisure',
    label: '日常休闲',
    weight: 25,
    actions: ['stretch', 'peek', 'hum', 'groom'],
  },
  {
    id: 'play',
    label: '星芒玩耍',
    weight: 24,
    actions: ['toss_star', 'star_magic', 'spin_show'],
  },
  {
    id: 'snack',
    label: '美味零食',
    weight: 18,
    actions: ['eat_fish', 'eat_cookie'],
  },
];

export const CLICK_ANIMS: AnimationId[] = [
  'click_happy',
  'click_shy',
  'click_tsundere',
  'click_tickle',
  'click_wave',
];

export const WORK_STATUS_ANIM: Record<WorkStatusState, AnimationId> = {
  thinking: 'work_thinking',
  working: 'work_working',
  result: 'work_result',
  waiting: 'work_waiting',
  success: 'work_success',
  error: 'work_error',
};

export const AVATAR_STYLE_LABELS: Record<AvatarStyle, string> = {
  chibi: 'Q版萌系全动作（默认）',
  illust: '精致立绘全动作',
  mixed: '双画风混搭',
};

export const WORK_STATUS_LABELS: Record<WorkStatusState, string> = {
  waiting: '等待确认',
  error: '遇到异常',
  working: '专注加油',
  thinking: '托腮沉思',
  result: '整理结果',
  success: '抛星庆祝',
};

export const WORK_STATUS_TEXTS: Record<WorkStatusState, string[]> = {
  thinking: [
    '唔…让我托腮想想怎么写最优雅 ✦',
    '星芒发卡闪烁中！正在整理思路喵~',
    '双子异色瞳全开，深度推理中…',
  ],
  working: [
    '哒哒哒！正在帮主人专注敲代码加油 ✦',
    '终端与工具全速运转中，加油加油喵~',
    '全力执行任务中，马上就搞定啦！',
  ],
  result: [
    '这一步处理好啦，星光归档中 ✦',
    '结果收齐啦，马上核对下一步喵~',
  ],
  waiting: [
    '主人主人，这里需要您点一下确认喵~',
    '探头~ 轮到主人做决定啦 ✦',
    '猫耳竖起来啦！在等主人的指示哦~',
  ],
  success: [
    '耶！任务圆满完成，抛星芒庆祝啦 ✦✨',
    '太棒啦！这一轮大成功，赏块小鱼干吧喵~',
    '星光洒满桌面！全部搞定咯 ✦',
  ],
  error: [
    '呜哇…刚才这步好像卡壳了，别急我陪你排查喵',
    '冒汗…遇到一点小状况，再试一次一定行！',
  ],
};

export const SLEEP_START_TEXTS = [
  '哈欠……星芒都变柔和了，我先打个盹喵~',
  '好困呀，蜷起来小憩一会儿，晚安 ✦',
];

export const SLEEP_END_TEXTS = [
  '唔嗯~ 伸个大懒腰，星芒猫娘满血复活啦！',
  '睡饱啦！主人刚才写代码辛苦了喵 ✦',
];

export const SLEEP_REFUSE_TEXTS = [
  '呼……别戳猫耳啦，再让我眯五分钟喵……',
  'zzZ…梦见好多闪闪发光的小鱼干……',
  '唔嗯…正在充星光能量，稍后再玩嘛……',
];

export const IDLE_WHISPER_TEXTS = [
  '今天的星空裙摆也很蓬松呢 ✦',
  '主人写代码累了记得喝口水哦喵~',
  '左眼粉紫，右眼金黄，今天状态绝佳 ✦',
  '偷偷摸一下悬浮的四角星，暖呼呼的~',
  '要不要投喂我一块脆脆小鱼干呀？',
  '按住我甩一甩，可以体验桌面弹弹乐哦~',
  'Antigravity 运转平稳，随时待命中 ✦',
];

export const ANIMATION_CATALOG: Record<AnimationId, AnimationMeta> = {
  idle: {
    id: 'idle',
    label: '待机呼吸',
    durationMs: 9500,
    loop: true,
    cooldownMs: 0,
  },
  turn: {
    id: 'turn',
    label: '东张西望转向',
    durationMs: 1450,
    loop: false,
    cooldownMs: 8000,
  },
  walk: {
    id: 'walk',
    label: '轻快漫游',
    durationMs: 3200,
    loop: true,
    cooldownMs: 10000,
  },
  drag: {
    id: 'drag',
    label: '被拎起悬空',
    durationMs: 1000,
    loop: true,
    cooldownMs: 0,
    bubbles: ['哇呀！抓到后颈啦，轻一点喵！', '浮空模式启动~ 要带我去哪儿？'],
  },
  sleep_start: {
    id: 'sleep_start',
    label: '犯困入睡',
    durationMs: 1800,
    loop: false,
    cooldownMs: 0,
  },
  sleep_loop: {
    id: 'sleep_loop',
    label: '摸鱼打盹中',
    durationMs: 4000,
    loop: true,
    cooldownMs: 0,
  },
  sleep_end: {
    id: 'sleep_end',
    label: '揉眼醒来',
    durationMs: 1700,
    loop: false,
    cooldownMs: 0,
  },
  stretch: {
    id: 'stretch',
    label: '超大伸懒腰',
    durationMs: 2800,
    loop: false,
    cooldownMs: 16000,
    bubbles: ['唔——伸个超级大的懒腰喵~', '骨头咔哒响，舒服 ✦'],
  },
  peek: {
    id: 'peek',
    label: '扒在窗边偷看',
    durationMs: 3800,
    loop: false,
    cooldownMs: 18000,
    bubbles: ['暗中观察主人写代码……盯 ✦', '悄悄扒在边上偷看一眼喵~'],
  },
  hum: {
    id: 'hum',
    label: '晃耳哼歌',
    durationMs: 3400,
    loop: false,
    cooldownMs: 14000,
    bubbles: ['啦啦啦~ 跟着星光节拍摇猫耳 ♪', '哼哼~ 今天心情像极光一样好 ♪'],
  },
  groom: {
    id: 'groom',
    label: '整理呆毛与裙摆',
    durationMs: 3000,
    loop: false,
    cooldownMs: 18000,
    bubbles: ['压一压翘起来的呆毛…哎又弹回去了！', '抚平蕾丝裙边，保持优雅喵 ✦'],
  },
  toss_star: {
    id: 'toss_star',
    label: '抛玩悬浮四角星',
    durationMs: 3600,
    loop: false,
    cooldownMs: 15000,
    bubbles: ['嘿咻！接住这颗闪闪的四角星 ✦', '转呀转~ Gemini 星芒杂技时间！'],
  },
  star_magic: {
    id: 'star_magic',
    label: '凝聚星芒魔法',
    durationMs: 3400,
    loop: false,
    cooldownMs: 20000,
    bubbles: ['星光汇聚！给主人的代码加个零 Bug 祝福 ✦', 'Biu~ 异色瞳星芒充能完毕！'],
  },
  spin_show: {
    id: 'spin_show',
    label: '转圈展示星空裙',
    durationMs: 2600,
    loop: false,
    cooldownMs: 20000,
    bubbles: ['转一圈~ 星空小短裙配白蕾丝是不是超可爱！'],
  },
  eat_fish: {
    id: 'eat_fish',
    label: '吃脆脆小鱼干',
    durationMs: 4200,
    loop: false,
    cooldownMs: 16000,
    bubbles: ['咔嚓咔嚓~ 小鱼干是世界上最棒的零食喵！', '好吃到猫尾都在打拍子啦~ 🐟'],
  },
  eat_cookie: {
    id: 'eat_cookie',
    label: '偷吃星形曲奇',
    durationMs: 3800,
    loop: false,
    cooldownMs: 18000,
    bubbles: ['啊呜~ 趁主人没注意啃一口星芒小饼干 ✦'],
  },
  click_happy: {
    id: 'click_happy',
    label: '开心跃动',
    durationMs: 1800,
    loop: false,
    cooldownMs: 0,
    bubbles: ['喵呜~ 主人摸摸头最开心啦 ✦', '嘿嘿，异色瞳闪闪发亮中！'],
  },
  click_shy: {
    id: 'click_shy',
    label: '害羞惊讶',
    durationMs: 1900,
    loop: false,
    cooldownMs: 0,
    bubbles: ['呀！突然戳猫耳会脸红的啦 >///<', '呜哇…别、别一直盯着人家看嘛！'],
  },
  click_tsundere: {
    id: 'click_tsundere',
    label: '傲娇鼓腮',
    durationMs: 2000,
    loop: false,
    cooldownMs: 0,
    bubbles: ['哼！才不是因为想被你摸才呆在这里的喵！', '再乱戳我就拿星芒轻轻敲你哦~'],
  },
  click_tickle: {
    id: 'click_tickle',
    label: '挠痒咯咯笑',
    durationMs: 2000,
    loop: false,
    cooldownMs: 0,
    bubbles: ['哈哈哈好痒呀！呆毛都在抖啦喵~', '噗哈哈停下停下，星芒要掉下来啦！'],
  },
  click_wave: {
    id: 'click_wave',
    label: '元气挥手',
    durationMs: 1800,
    loop: false,
    cooldownMs: 0,
    bubbles: ['主人好呀！今天也一起冲鸭 ✦', 'Ciallo~ 星芒猫娘随时待命喵！'],
  },
  work_thinking: {
    id: 'work_thinking',
    label: '托腮沉思',
    durationMs: 3600,
    loop: true,
    cooldownMs: 0,
  },
  work_working: {
    id: 'work_working',
    label: '专注敲代码加油',
    durationMs: 3200,
    loop: true,
    cooldownMs: 0,
  },
  work_result: {
    id: 'work_result',
    label: '星光整理汇总',
    durationMs: 2800,
    loop: true,
    cooldownMs: 0,
  },
  work_waiting: {
    id: 'work_waiting',
    label: '探头等你确认',
    durationMs: 3000,
    loop: true,
    cooldownMs: 0,
  },
  work_success: {
    id: 'work_success',
    label: '跳跃抛星庆祝',
    durationMs: 3200,
    loop: false,
    cooldownMs: 0,
  },
  work_error: {
    id: 'work_error',
    label: '冒汗打气',
    durationMs: 3000,
    loop: false,
    cooldownMs: 0,
  },
};

export function createDefaultPet(index = 0, overrides: Partial<PetInstanceConfig> = {}): PetInstanceConfig {
  const names = ['星芒喵', '极光喵', '双子喵', '星尘喵', '幻紫喵'];
  const hues = [0, 18, -20, 32, -35];
  return {
    id: index === 0 ? 'main' : `pet-${index + 1}`,
    name: overrides.name ?? names[index % names.length],
    size: overrides.size ?? 240,
    display: overrides.display ?? 'both',
    fixedEnabled: overrides.fixedEnabled ?? false,
    workStatusEnabled: overrides.workStatusEnabled ?? true,
    variantHueShift: overrides.variantHueShift ?? hues[index % hues.length],
    position: overrides.position ?? {
      corner: 'bottom-right',
      marginX: 28 + index * 110,
      marginY: 24,
    },
  };
}

export function createDefaultConfig(): SharedPetConfig {
  return {
    displayMode: 'both',
    avatarStyle: 'chibi',
    enableAgentLink: true,
    enableTray: true,
    enableSound: true,
    physics: { ...DEFAULT_PHYSICS },
    weights: { ...DEFAULT_WEIGHTS },
    pets: [createDefaultPet(0)],
  };
}
