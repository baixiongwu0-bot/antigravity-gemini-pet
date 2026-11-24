import { AVATAR_STYLE_LABELS, DEFAULT_WEIGHTS, WORK_STATUS_LABELS } from '../shared/config';
import { PetStageRuntime } from '../shared/pet-runtime';
import type { AnimationId, AvatarStyle, ServerStateSnapshot, WorkStatusState } from '../shared/types';

declare function acquireVsCodeApi(): {
  postMessage(msg: unknown): void;
};

const vscode = acquireVsCodeApi();
const canvas = document.getElementById('ide-canvas') as HTMLCanvasElement;
const bubbleEl = document.getElementById('ide-bubble') as HTMLElement;
const hiddenNote = document.getElementById('hidden-note') as HTMLElement;
const petTitle = document.getElementById('pet-title') as HTMLElement;
const workPill = document.getElementById('work-pill') as HTMLElement;
const desktopStatus = document.getElementById('desktop-status') as HTMLElement;
const petCount = document.getElementById('pet-count') as HTMLElement;
const sizeSlider = document.getElementById('size-slider') as HTMLInputElement;
const sizeVal = document.getElementById('size-val') as HTMLElement;
const httpInfo = document.getElementById('http-info') as HTMLElement;

const btnSleep = document.getElementById('btn-sleep') as HTMLButtonElement;
const btnFixed = document.getElementById('btn-fixed') as HTMLButtonElement;
const btnSound = document.getElementById('btn-sound') as HTMLButtonElement | null;
const stylePill = document.getElementById('style-pill') as HTMLElement | null;
const styleButtons = Array.from(document.querySelectorAll<HTMLButtonElement>('button[data-style]'));

const runtime = new PetStageRuntime({
  canvas,
  bubbleEl,
  weights: DEFAULT_WEIGHTS,
  fixedEnabled: true,
  workStatusEnabled: true,
  logicalSize: 210,
});

let lastMouseMoveAt = performance.now();
let lastMouseX = 0;
let lastMouseY = 0;

canvas.addEventListener('click', () => {
  runtime.onClick();
});

canvas.addEventListener('mousemove', (e) => {
  const rect = canvas.getBoundingClientRect();
  const nx = ((e.clientX - rect.left) / rect.width - 0.5) * 2;
  const ny = ((e.clientY - rect.top) / rect.height - 0.36) * 2;
  runtime.setLookTarget(nx, ny);

  const now = performance.now();
  const dt = Math.max(0.01, (now - lastMouseMoveAt) / 1000);
  const dx = e.clientX - (rect.left + rect.width * 0.5);
  const dy = e.clientY - (rect.top + rect.height * 0.42);
  const dist = Math.hypot(dx, dy);
  const speed = lastMouseX === 0 && lastMouseY === 0 ? 0 : Math.hypot(e.clientX - lastMouseX, e.clientY - lastMouseY) / dt;
  lastMouseMoveAt = now;
  lastMouseX = e.clientX;
  lastMouseY = e.clientY;
  runtime.updatePointerProximity(dist, nx, speed, dt);
});

canvas.addEventListener('mouseleave', () => {
  runtime.setLookTarget(0, 0);
  runtime.updatePointerProximity(9999, 0, 0, 0.05);
  lastMouseX = 0;
  lastMouseY = 0;
});

for (const btn of document.querySelectorAll<HTMLButtonElement>('button[data-anim]')) {
  btn.addEventListener('click', () => {
    const anim = btn.dataset.anim as AnimationId;
    runtime.triggerAction(anim);
    vscode.postMessage({ type: 'action', anim });
  });
}

for (const btn of document.querySelectorAll<HTMLButtonElement>('button[data-work]')) {
  btn.addEventListener('click', () => {
    const state = btn.dataset.work as WorkStatusState;
    vscode.postMessage({ type: 'simulate-work', state });
  });
}

document.getElementById('btn-work-idle')?.addEventListener('click', () => {
  vscode.postMessage({ type: 'simulate-work', state: null });
});

const modeButtons: Record<string, HTMLElement | null> = {
  both: document.getElementById('btn-mode-both'),
  desktop: document.getElementById('btn-mode-desktop'),
  ide: document.getElementById('btn-mode-ide'),
  none: document.getElementById('btn-mode-none'),
};

for (const [mode, el] of Object.entries(modeButtons)) {
  el?.addEventListener('click', () => {
    vscode.postMessage({ type: 'set-display', displayMode: mode });
  });
}

for (const btn of styleButtons) {
  btn.addEventListener('click', () => {
    const avatarStyle = (btn.dataset.style as AvatarStyle) || 'chibi';
    runtime.updateConfig({ avatarStyle });
    for (const b of styleButtons) b.classList.toggle('active', b.dataset.style === avatarStyle);
    if (stylePill) stylePill.textContent = AVATAR_STYLE_LABELS[avatarStyle];
    vscode.postMessage({ type: 'set-style', avatarStyle });
  });
}

btnSleep.addEventListener('click', () => {
  vscode.postMessage({ type: 'toggle-sleep' });
});

btnFixed.addEventListener('click', () => {
  vscode.postMessage({ type: 'toggle-fixed' });
});

btnSound?.addEventListener('click', () => {
  vscode.postMessage({ type: 'toggle-sound' });
});

document.getElementById('btn-reset')?.addEventListener('click', () => {
  vscode.postMessage({ type: 'reset-pos' });
});

document.getElementById('btn-add-pet')?.addEventListener('click', () => {
  vscode.postMessage({ type: 'add-pet' });
});

document.getElementById('btn-rem-pet')?.addEventListener('click', () => {
  vscode.postMessage({ type: 'remove-pet' });
});

sizeSlider.addEventListener('change', () => {
  const size = Number.parseInt(sizeSlider.value, 10);
  sizeVal.textContent = `${size}px`;
  vscode.postMessage({ type: 'set-size', size });
});

sizeSlider.addEventListener('input', () => {
  sizeVal.textContent = `${sizeSlider.value}px`;
});

function renderSnapshot(snap: ServerStateSnapshot): void {
  const mode = snap.config.displayMode;
  for (const [key, el] of Object.entries(modeButtons)) {
    el?.classList.toggle('active', key === mode);
  }

  const showInIde = mode === 'both' || mode === 'ide';
  canvas.style.display = showInIde ? 'block' : 'none';
  bubbleEl.style.display = showInIde ? 'block' : 'none';
  hiddenNote.style.display = showInIde ? 'none' : 'block';

  const mainPet = snap.config.pets[0];
  if (mainPet) {
    petTitle.textContent = `✦ ${mainPet.name}`;
    sizeSlider.value = String(mainPet.size);
    sizeVal.textContent = `${mainPet.size}px`;
    btnFixed.textContent = mainPet.fixedEnabled ? '🔓 已固定位置' : '📌 位置固定';
    btnFixed.classList.toggle('active', mainPet.fixedEnabled);
  }

  const avatarStyle: AvatarStyle = snap.config.avatarStyle || 'chibi';
  runtime.updateConfig({ avatarStyle });
  for (const b of styleButtons) {
    b.classList.toggle('active', b.dataset.style === avatarStyle);
  }
  if (stylePill) {
    stylePill.textContent = avatarStyle === 'chibi' ? 'Q版萌系' : avatarStyle === 'illust' ? '精致立绘' : '双画风混搭';
  }

  const sleeping = Boolean(snap.sleepByPet?.main);
  if (sleeping !== runtime.isSleeping()) {
    runtime.setSleeping(sleeping);
  }
  btnSleep.textContent = sleeping ? '☀️ 叫醒猫娘' : '💤 摸鱼打盹';
  btnSleep.classList.toggle('active', sleeping);

  const soundOn = snap.config.enableSound !== false;
  runtime.setSoundEnabled(soundOn);
  if (btnSound) {
    btnSound.textContent = soundOn ? '🔊 音效开' : '🔇 音效关';
    btnSound.classList.toggle('active', soundOn);
  }

  petCount.textContent = `${snap.config.pets.length} 只`;
  desktopStatus.textContent = snap.desktopRunning ? '桌面悬浮运行中' : snap.electronPath ? '桌面未开启' : '未检测到 Electron';

  if (snap.workStatus?.state) {
    workPill.textContent = WORK_STATUS_LABELS[snap.workStatus.state] || snap.workStatus.state;
  } else {
    workPill.textContent = sleeping ? '打盹中' : '待机中';
  }
  runtime.applyWorkStatus(snap.workStatus);

  httpInfo.textContent =
    snap.serverPort > 0
      ? `HTTP 联动接口：POST http://127.0.0.1:${snap.serverPort}/work-status`
      : 'HTTP 联动接口：未就绪';
}

window.addEventListener('message', (event) => {
  const msg = event.data as { type?: string; snapshot?: ServerStateSnapshot; anim?: AnimationId; bubble?: string };
  if (!msg) return;
  if (msg.type === 'state' && msg.snapshot) {
    renderSnapshot(msg.snapshot);
  } else if (msg.type === 'anim' && msg.anim) {
    runtime.triggerAction(msg.anim, msg.bubble);
  }
});

vscode.postMessage({ type: 'ready' });
