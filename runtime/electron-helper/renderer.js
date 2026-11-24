'use strict';

(function () {
  const Core = window.GeminiPetCore;
  const bridge = window.petBridge;
  if (!Core || !bridge) {
    console.error('[gemini-pet-renderer] Missing GeminiPetCore or petBridge');
    return;
  }

  const params = new URLSearchParams(window.location.search);
  const SERVER_URL = (params.get('serverUrl') || 'http://127.0.0.1:47821').replace(/\/$/, '');
  const PET_ID = params.get('petId') || 'main';
  const PET_INDEX = Number.parseInt(params.get('petIndex') || '0', 10) || 0;
  let margins = { l: 125, r: 125, t: 168, b: 36 };
  try {
    const m = JSON.parse(params.get('margins') || 'null');
    if (m && Number.isFinite(m.l)) margins = m;
  } catch {
    /* ignore */
  }

  let displays = [];
  try {
    displays = JSON.parse(params.get('displays') || '[]');
  } catch {
    displays = [];
  }

  const petWrap = document.getElementById('pet-wrap');
  const canvas = document.getElementById('pet-canvas');
  const bubbleEl = document.getElementById('pet-bubble');
  const tooltipEl = document.getElementById('pet-tooltip');

  let petConfig = Core.createDefaultPet(PET_INDEX, { id: PET_ID });
  let physicsConfig = { ...Core.DEFAULT_PHYSICS };
  let weightsConfig = { ...Core.DEFAULT_WEIGHTS };
  let avatarStyle = 'chibi';
  let peers = [];
  let bodyX = 1100;
  let bodyY = 580;
  let walkTargetX = null;
  let walkStartMs = 0;
  let soundEnabled = true;
  let activeWindowRect = null;
  let perchJump = null;
  let peekGlideX = null;
  let savedBeforePeekX = null;
  let menuContainer = null;
  let subMenuContainer = null;
  let lastCommandSeq = 0;

  const flightBody = { x: bodyX, y: bodyY, vx: 0, vy: 0, size: petConfig.size, flying: false };
  let dragState = {
    active: false,
    dragging: false,
    startScreenX: 0,
    startScreenY: 0,
    grabOffsetX: 0,
    grabOffsetY: 0,
    spring: { x: bodyX, y: bodyY, vx: 0, vy: 0 },
    trail: [],
    lastStepMs: 0,
  };

  function getWorkAreaUnion() {
    if (!displays || displays.length === 0) {
      return { x: 0, y: 0, width: window.screen.availWidth || 1920, height: window.screen.availHeight || 1040 };
    }
    const primary = displays[0].workArea || displays[0].bounds;
    // Pick display containing current center
    const cx = bodyX + petConfig.size * 0.5;
    const cy = bodyY + petConfig.size * 0.5;
    for (const d of displays) {
      const wa = d.workArea || d.bounds;
      if (cx >= wa.x && cx <= wa.x + wa.width && cy >= wa.y && cy <= wa.y + wa.height) {
        return wa;
      }
    }
    return primary;
  }

  function computeCornerBodyPos(cfg) {
    const wa = (displays[0] && (displays[0].workArea || displays[0].bounds)) || getWorkAreaUnion();
    const size = cfg.size || 240;
    const pos = cfg.position || { corner: 'bottom-right', marginX: 28, marginY: 24 };
    let x = wa.x + wa.width - size - pos.marginX;
    let y = wa.y + wa.height - size - pos.marginY;
    if (pos.corner === 'bottom-left') x = wa.x + pos.marginX;
    else if (pos.corner === 'top-left') {
      x = wa.x + pos.marginX;
      y = wa.y + pos.marginY;
    } else if (pos.corner === 'top-right') {
      y = wa.y + pos.marginY;
    }
    return { x, y };
  }

  function layoutWindowForSize(size) {
    const l = Math.max(110, Math.round(size * 0.52));
    const r = l;
    const t = Math.max(150, Math.round(size * 0.7));
    const b = 36;
    margins = { l, r, t, b };
    petWrap.style.left = `${margins.l}px`;
    petWrap.style.top = `${margins.t}px`;
    petWrap.style.width = `${size}px`;
    petWrap.style.height = `${size}px`;
  }

  function syncWindowBounds() {
    const size = petConfig.size || 240;
    const winX = Math.round(bodyX - margins.l);
    const winY = Math.round(bodyY - margins.t);
    const winW = Math.round(size + margins.l + margins.r);
    const winH = Math.round(size + margins.t + margins.b);
    bridge.setBounds({ x: winX, y: winY, width: winW, height: winH, margins });
    bridge.sendFlightUpdate({
      id: PET_ID,
      x: bodyX,
      y: bodyY,
      vx: flightBody.vx,
      vy: flightBody.vy,
      size,
    });
  }

  layoutWindowForSize(petConfig.size);
  const initialPos = computeCornerBodyPos(petConfig);
  bodyX = initialPos.x;
  bodyY = initialPos.y;
  flightBody.x = bodyX;
  flightBody.y = bodyY;
  syncWindowBounds();

  const runtime = new Core.PetStageRuntime({
    canvas,
    bubbleEl,
    weights: weightsConfig,
    avatarStyle,
    fixedEnabled: petConfig.fixedEnabled,
    workStatusEnabled: petConfig.workStatusEnabled,
    hueShift: petConfig.variantHueShift,
    logicalSize: petConfig.size,
    onRequestWalk: () => {
      if (petConfig.fixedEnabled || dragState.dragging || flightBody.flying || menuContainer || perchJump) return false;
      const wa = getWorkAreaUnion();
      const size = petConfig.size;

      // Free-roaming chance to hop lightly onto the active foreground window's top border
      if (
        activeWindowRect &&
        !runtime.isSittingOnWindow() &&
        activeWindowRect.y >= wa.y + Math.round(size * 0.65) &&
        activeWindowRect.width >= 420 &&
        Math.random() < 0.36
      ) {
        const minWx = Math.max(wa.x + 12, activeWindowRect.x + 28);
        const maxWx = Math.min(wa.x + wa.width - size - 12, activeWindowRect.x + activeWindowRect.width - size - 28);
        if (maxWx > minWx + 40) {
          const targetX = minWx + Math.random() * (maxWx - minWx);
          const targetY = activeWindowRect.y - Math.round(size * 0.9);
          runtime.setFacing(targetX > bodyX ? 'right' : 'left');
          perchJump = {
            startX: bodyX,
            startY: bodyY,
            targetX,
            targetY,
            elapsed: 0,
            duration: 0.62,
            toWindow: true,
          };
          return false;
        }
      }

      // If perched on window top, either walk along window edge or hop down to desktop bottom
      if (runtime.isSittingOnWindow()) {
        if (activeWindowRect && Math.random() < 0.55) {
          const minWx = Math.max(wa.x + 12, activeWindowRect.x + 24);
          const maxWx = Math.min(wa.x + wa.width - size - 12, activeWindowRect.x + activeWindowRect.width - size - 24);
          const target = Math.max(minWx, Math.min(maxWx, bodyX + (Math.random() < 0.5 ? -1 : 1) * (70 + Math.random() * 110)));
          if (Math.abs(target - bodyX) >= 24) {
            walkTargetX = target;
            walkStartMs = performance.now();
            runtime.setFacing(target > bodyX ? 'right' : 'left');
            return true;
          }
        }
        runtime.setSittingOnWindow(false);
        const pos = computeCornerBodyPos(petConfig);
        perchJump = {
          startX: bodyX,
          startY: bodyY,
          targetX: pos.x,
          targetY: pos.y,
          elapsed: 0,
          duration: 0.58,
          toWindow: false,
        };
        return false;
      }

      const minX = wa.x + 12;
      const maxX = Math.max(minX, wa.x + wa.width - size - 12);
      const delta = (Math.random() < 0.5 ? -1 : 1) * (90 + Math.random() * 140);
      const target = Math.max(minX, Math.min(maxX, bodyX + delta));
      if (Math.abs(target - bodyX) < 30) return false;
      walkTargetX = target;
      walkStartMs = performance.now();
      runtime.setFacing(target > bodyX ? 'right' : 'left');
      return true;
    },
    onStateChange: (anim) => {
      if (anim !== 'walk') walkTargetX = null;
      if (anim === 'peek' && !petConfig.fixedEnabled && !dragState.dragging && !flightBody.flying && !runtime.isSittingOnWindow()) {
        const wa = getWorkAreaUnion();
        const size = petConfig.size;
        const nearRight = bodyX + size * 0.5 >= wa.x + wa.width * 0.5;
        savedBeforePeekX = bodyX;
        // Peek playfully from screen side (half-head & cat ears peeking in!)
        peekGlideX = nearRight ? wa.x + wa.width - size * 0.58 : wa.x - size * 0.42;
        runtime.setFacing(nearRight ? 'left' : 'right');
      } else if (anim !== 'peek' && savedBeforePeekX !== null) {
        peekGlideX = savedBeforePeekX;
        savedBeforePeekX = null;
      }
    },
  });

  // Tooltip hover handling
  petWrap.addEventListener('mouseenter', () => {
    if (dragState.dragging || menuContainer) return;
    tooltipEl.textContent = `${petConfig.name} · 左键戳戳 / 拖拽抛甩 / 右键菜单`;
    tooltipEl.classList.add('visible');
  });
  petWrap.addEventListener('mouseleave', () => {
    tooltipEl.classList.remove('visible');
    runtime.setLookTarget(0, 0);
  });
  bridge.onPointerLeft(() => {
    tooltipEl.classList.remove('visible');
    runtime.setLookTarget(0, 0);
  });

  bridge.onCursorProximity((info) => {
    if (!info || dragState.active) return;
    if (info.distPx <= 200) {
      runtime.setLookTarget(info.dirX, info.dirY);
    } else {
      runtime.setLookTarget(0, 0);
    }
    runtime.updatePointerProximity(info.distPx, info.dirX, info.speedPxSec || 0, 0.06);
  });

  bridge.onActiveWindow((winRect) => {
    activeWindowRect = winRect;
    if (runtime.isSittingOnWindow() && !dragState.active && !flightBody.flying && !perchJump) {
      const wa = getWorkAreaUnion();
      const valid =
        winRect &&
        winRect.y >= wa.y + Math.round(petConfig.size * 0.65) &&
        bodyX + petConfig.size * 0.5 >= winRect.x &&
        bodyX + petConfig.size * 0.5 <= winRect.x + winRect.width;
      if (!valid) {
        runtime.setSittingOnWindow(false);
        flightBody.x = bodyX;
        flightBody.y = bodyY;
        flightBody.vx = 0;
        flightBody.vy = 40;
        flightBody.size = petConfig.size;
        flightBody.flying = true;
      } else {
        const nextY = winRect.y - Math.round(petConfig.size * 0.9);
        if (Math.abs(nextY - bodyY) > 2) {
          bodyY = nextY;
          syncWindowBounds();
        }
      }
    }
  });

  window.addEventListener('mousemove', (e) => {
    const cx = margins.l + petConfig.size * 0.5;
    const cy = margins.t + petConfig.size * 0.36;
    runtime.setLookTarget((e.clientX - cx) / 90, (e.clientY - cy) / 90);
  });

  // Dragging + Throwing + Click interaction
  function startDrag(e) {
    if (e.button !== 0) return;
    closeMenu();
    tooltipEl.classList.remove('visible');
    walkTargetX = null;
    perchJump = null;
    peekGlideX = null;
    savedBeforePeekX = null;
    runtime.setSittingOnWindow(false);
    flightBody.flying = false;
    flightBody.vx = 0;
    flightBody.vy = 0;

    const now = performance.now();
    dragState = {
      active: true,
      dragging: false,
      startScreenX: e.screenX,
      startScreenY: e.screenY,
      grabOffsetX: e.screenX - bodyX,
      grabOffsetY: e.screenY - bodyY,
      spring: { x: bodyX, y: bodyY, vx: 0, vy: 0 },
      trail: [{ x: bodyX, y: bodyY, t: now }],
      lastStepMs: now,
    };
    bridge.setInputBusy(true);
    bridge.setInputState({ dragging: true, rects: [] });
  }

  petWrap.addEventListener('mousedown', startDrag);

  window.addEventListener('mousemove', (e) => {
    if (!dragState.active) return;
    const dist = Math.hypot(e.screenX - dragState.startScreenX, e.screenY - dragState.startScreenY);
    if (!dragState.dragging && dist >= 6) {
      dragState.dragging = true;
      petWrap.classList.add('dragging');
      runtime.onDragStart();
    }
    if (dragState.dragging) {
      const targetX = e.screenX - dragState.grabOffsetX;
      const targetY = e.screenY - dragState.grabOffsetY;
      const now = performance.now();
      const dt = Math.max(0.001, (now - dragState.lastStepMs) / 1000);
      dragState.lastStepMs = now;
      dragState.spring = Core.stepSpring(dragState.spring, targetX, targetY, dt, physicsConfig.throwPower);
      bodyX = dragState.spring.x;
      bodyY = dragState.spring.y;
      dragState.trail.push({ x: bodyX, y: bodyY, t: now });
      const cutoff = now - Core.TRAIL_KEEP_MS;
      while (dragState.trail.length > 2 && dragState.trail[0].t < cutoff) {
        dragState.trail.shift();
      }
      runtime.setMotionVelocity(dragState.spring.vx, dragState.spring.vy);
      syncWindowBounds();
    }
  });

  function finishDrag() {
    if (!dragState.active) return;
    const wasDragging = dragState.dragging;
    dragState.active = false;
    dragState.dragging = false;
    petWrap.classList.remove('dragging');
    bridge.setInputState({ dragging: false, rects: [] });
    if (!menuContainer) bridge.setInputBusy(false);

    if (!wasDragging) {
      runtime.onClick();
      return;
    }

    const release = Core.estimateReleaseVelocity(dragState.trail, performance.now(), physicsConfig.throwPower);
    runtime.onDragEnd();
    if (release.thrown) {
      flightBody.x = bodyX;
      flightBody.y = bodyY;
      flightBody.vx = release.vx;
      flightBody.vy = release.vy;
      flightBody.size = petConfig.size;
      flightBody.flying = true;
    } else {
      const wa = getWorkAreaUnion();
      bodyX = Math.max(wa.x, Math.min(wa.x + wa.width - petConfig.size, bodyX));
      bodyY = Math.max(wa.y, Math.min(wa.y + wa.height - petConfig.size, bodyY));
      runtime.setMotionVelocity(0, 0);
      syncWindowBounds();
    }
  }

  window.addEventListener('mouseup', finishDrag);
  window.addEventListener('blur', finishDrag);

  // Main 60fps desktop motion & physics pump
  let lastPhysicsMs = performance.now();
  function stepDesktopMotion(nowPerf) {
    const dt = Math.min(0.05, Math.max(0.001, (nowPerf - lastPhysicsMs) / 1000));
    lastPhysicsMs = nowPerf;

    if (perchJump && !dragState.active) {
      perchJump.elapsed += dt;
      const k = Math.min(1, perchJump.elapsed / perchJump.duration);
      const ease = 1 - Math.pow(1 - k, 3);
      const arc = Math.sin(k * Math.PI) * 58;
      bodyX = perchJump.startX + (perchJump.targetX - perchJump.startX) * ease;
      bodyY = perchJump.startY + (perchJump.targetY - perchJump.startY) * ease - arc;
      runtime.setMotionVelocity((perchJump.targetX - perchJump.startX) / perchJump.duration, (perchJump.targetY - perchJump.startY) / perchJump.duration);
      syncWindowBounds();
      if (k >= 1) {
        bodyX = perchJump.targetX;
        bodyY = perchJump.targetY;
        runtime.setSittingOnWindow(perchJump.toWindow);
        runtime.squash(0.78);
        runtime.setMotionVelocity(0, 0);
        if (perchJump.toWindow) {
          runtime.emitCustomBubble('轻盈跳到窗口顶边坐好啦~ 晃晃小腿 ✦', 'whisper', 4200);
        }
        perchJump = null;
        syncWindowBounds();
      }
    } else if (peekGlideX !== null && !dragState.active && !flightBody.flying) {
      const dx = peekGlideX - bodyX;
      if (Math.abs(dx) <= 1.5) {
        bodyX = peekGlideX;
        if (savedBeforePeekX === null) peekGlideX = null;
        runtime.setMotionVelocity(0, 0);
      } else {
        const vx = dx * 5.2;
        bodyX += vx * dt;
        runtime.setMotionVelocity(vx, 0);
      }
      syncWindowBounds();
    } else if (flightBody.flying && !dragState.active) {
      const wa = getWorkAreaUnion();
      const res = Core.stepFlight(flightBody, wa, physicsConfig, dt, peers, PET_ID);
      bodyX = flightBody.x;
      bodyY = flightBody.y;
      runtime.setMotionVelocity(flightBody.vx, flightBody.vy);
      if (res.impactSpeed > Core.SQ_SOFT_SPEED) {
        runtime.squash(Core.squashScaleForImpact(res.impactSpeed));
      }
      if (res.settled) {
        runtime.setMotionVelocity(0, 0);
      }
      syncWindowBounds();
    } else if (walkTargetX !== null && !dragState.active) {
      const dx = walkTargetX - bodyX;
      const step = Math.sign(dx) * Math.min(Math.abs(dx), 68 * dt);
      bodyX += step;
      runtime.setMotionVelocity(Math.sign(dx) * 68, 0);
      syncWindowBounds();
      if (Math.abs(walkTargetX - bodyX) <= 1.5 || nowPerf - walkStartMs > 3100) {
        walkTargetX = null;
        runtime.setMotionVelocity(0, 0);
      }
    } else if (!dragState.active) {
      runtime.setMotionVelocity(0, 0);
    }

    window.requestAnimationFrame(stepDesktopMotion);
  }
  window.requestAnimationFrame(stepDesktopMotion);

  // Context Menu (Simplified Chinese)
  function syncMenuInputRegions() {
    const rects = [];
    for (const el of [menuContainer, subMenuContainer]) {
      if (!el) continue;
      const r = el.getBoundingClientRect();
      rects.push({ x: r.left, y: r.top, width: r.width, height: r.height });
    }
    bridge.setInputState({ dragging: false, rects });
  }

  function closeMenu() {
    if (subMenuContainer) {
      subMenuContainer.remove();
      subMenuContainer = null;
    }
    if (menuContainer) {
      menuContainer.remove();
      menuContainer = null;
    }
    bridge.setInputState({ dragging: false, rects: [] });
    if (!dragState.active) bridge.setInputBusy(false);
  }

  function showSubMenu(anchorEl, items) {
    if (subMenuContainer) {
      subMenuContainer.remove();
      subMenuContainer = null;
    }
    const sub = document.createElement('div');
    sub.className = 'ctx-sub';
    for (const item of items) {
      const row = document.createElement('div');
      row.className = 'ctx-item';
      row.textContent = item.label;
      row.addEventListener('click', (ev) => {
        ev.stopPropagation();
        closeMenu();
        item.onClick();
      });
      sub.appendChild(row);
    }
    document.body.appendChild(sub);
    const ar = anchorEl.getBoundingClientRect();
    const sr = sub.getBoundingClientRect();
    let left = ar.right + 4;
    if (left + sr.width > window.innerWidth - 6) left = Math.max(6, ar.left - sr.width - 4);
    const top = Math.max(6, Math.min(window.innerHeight - sr.height - 6, ar.top));
    sub.style.left = `${left}px`;
    sub.style.top = `${top}px`;
    subMenuContainer = sub;
    syncMenuInputRegions();
  }

  function triggerLocalOrServerAction(anim, bubble) {
    if (!runtime.triggerAction(anim, bubble, true, 5000)) return;
    const payload = {
      action: 'sync-anim',
      petId: PET_ID,
      anim,
      force: true,
      lockMs: 5000,
    };
    if (typeof bubble === 'string' && bubble) payload.text = bubble;
    void bridge.serverPost('/action', payload);
  }

  petWrap.addEventListener('contextmenu', (e) => {
    e.preventDefault();
    e.stopPropagation();
    closeMenu();
    bridge.focusWindow();
    bridge.setInputBusy(true);

    const menu = document.createElement('div');
    menu.className = 'ctx-menu';
    const sleeping = runtime.isSleeping();

    const entries = [
      { label: '🐟 投喂小鱼干', onClick: () => triggerLocalOrServerAction('eat_fish') },
      { label: '🍪 投喂星形曲奇', onClick: () => triggerLocalOrServerAction('eat_cookie') },
      { label: '💖 打招呼 / 卖萌', onClick: () => triggerLocalOrServerAction('click_wave') },
      { label: '🎉 开心欢呼', onClick: () => triggerLocalOrServerAction('click_happy') },
      { label: '😤 傲娇生闷气', onClick: () => triggerLocalOrServerAction('click_tsundere') },
      { label: '👀 暗中观察', onClick: () => triggerLocalOrServerAction('peek') },
      { label: '✦ 抛玩悬浮四角星', onClick: () => triggerLocalOrServerAction('toss_star') },
      {
        label: '✨ 更多可爱动作 ▸',
        children: [
          { label: '伸个大懒腰', onClick: () => triggerLocalOrServerAction('stretch') },
          { label: '晃耳哼歌 ♪', onClick: () => triggerLocalOrServerAction('hum') },
          { label: '整理呆毛与裙摆', onClick: () => triggerLocalOrServerAction('groom') },
          { label: '凝聚星芒魔法', onClick: () => triggerLocalOrServerAction('star_magic') },
          { label: '转圈展示星空裙', onClick: () => triggerLocalOrServerAction('spin_show') },
          { label: '害羞捂脸 >///<', onClick: () => triggerLocalOrServerAction('click_shy') },
          { label: '挠痒咯咯笑', onClick: () => triggerLocalOrServerAction('click_tickle') },
        ],
      },
      { sep: true },
      {
        label: sleeping ? '☀️ 叫醒猫娘' : '💤 抱星打盹',
        onClick: () => triggerLocalOrServerAction(sleeping ? 'sleep_end' : 'sleep_start'),
      },
      {
        label: '🐾 召唤新猫娘（多开）',
        onClick: () => void bridge.serverPost('/config', { op: 'add-pet' }),
      },
      {
        label: petConfig.fixedEnabled ? '🔓 取消位置固定' : '📌 固定当前位置',
        onClick: () => {
          const nextFixed = !petConfig.fixedEnabled;
          petConfig.fixedEnabled = nextFixed;
          if (nextFixed) runtime.setSittingOnWindow(false);
          runtime.updateConfig({ fixedEnabled: nextFixed });
          void bridge.serverPost('/config', { op: 'toggle-fixed', petId: PET_ID, fixedEnabled: nextFixed });
        },
      },
      {
        label: soundEnabled ? '🔊 交互音效：已开启' : '🔇 交互音效：已关闭',
        onClick: () => {
          soundEnabled = !soundEnabled;
          runtime.setSoundEnabled(soundEnabled);
          void bridge.serverPost('/config', { op: 'toggle-sound', enableSound: soundEnabled });
        },
      },
      { sep: true },
      {
        label: '🤖 演练 Agent 状态 ▸',
        children: [
          { label: '托腮沉思 (thinking)', onClick: () => void bridge.serverPost('/work-status', { state: 'thinking', task: '正在思考架构方案', ttlMs: 8000 }) },
          { label: '专注加油 (working)', onClick: () => void bridge.serverPost('/work-status', { state: 'working', task: '正在执行命令与构建', ttlMs: 8000 }) },
          { label: '整理结果 (result)', onClick: () => void bridge.serverPost('/work-status', { state: 'result', task: '整理输出摘要中', ttlMs: 6000 }) },
          { label: '等你确认 (waiting)', onClick: () => void bridge.serverPost('/work-status', { state: 'waiting', task: '等待主人确认操作', ttlMs: 8000 }) },
          { label: '抛星庆祝 (success)', onClick: () => void bridge.serverPost('/work-status', { state: 'success', task: '全部任务执行成功！', ttlMs: 6000 }) },
          { label: '异常打气 (error)', onClick: () => void bridge.serverPost('/work-status', { state: 'error', task: '遇到报错，猫娘陪你排查', ttlMs: 6000 }) },
          { label: '恢复日常待机 (idle)', onClick: () => void bridge.serverPost('/work-status', { state: null }) },
        ],
      },
      {
        label: '🎨 形象风格切换 ▸',
        children: [
          {
            label: `${avatarStyle === 'chibi' ? '✓ ' : ''}Q版萌系全动作（默认）`,
            onClick: () => {
              avatarStyle = 'chibi';
              runtime.updateConfig({ avatarStyle: 'chibi' });
              void bridge.serverPost('/config', { avatarStyle: 'chibi' });
            },
          },
          {
            label: `${avatarStyle === 'illust' ? '✓ ' : ''}精致立绘全动作`,
            onClick: () => {
              avatarStyle = 'illust';
              runtime.updateConfig({ avatarStyle: 'illust' });
              void bridge.serverPost('/config', { avatarStyle: 'illust' });
            },
          },
          {
            label: `${avatarStyle === 'mixed' ? '✓ ' : ''}双画风混搭`,
            onClick: () => {
              avatarStyle = 'mixed';
              runtime.updateConfig({ avatarStyle: 'mixed' });
              void bridge.serverPost('/config', { avatarStyle: 'mixed' });
            },
          },
        ],
      },
      {
        label: '🖥️ 切换显示形态 ▸',
        children: [
          { label: '双形态全开 (IDE + 桌面)', onClick: () => void bridge.serverPost('/config', { displayMode: 'both' }) },
          { label: '仅 Antigravity 内嵌', onClick: () => void bridge.serverPost('/config', { displayMode: 'ide' }) },
          { label: '仅桌面透明悬浮', onClick: () => void bridge.serverPost('/config', { displayMode: 'desktop' }) },
          { label: '暂时隐藏桌宠', onClick: () => void bridge.serverPost('/config', { displayMode: 'none' }) },
        ],
      },
      {
        label: '🏠 回到右下角',
        onClick: () => {
          flightBody.flying = false;
          walkTargetX = null;
          perchJump = null;
          peekGlideX = null;
          savedBeforePeekX = null;
          runtime.setSittingOnWindow(false);
          const pos = computeCornerBodyPos(petConfig);
          bodyX = pos.x;
          bodyY = pos.y;
          syncWindowBounds();
          runtime.emitCustomBubble('嗖地飞回右下角啦 ✦', 'system', 4500);
        },
      },
    ];

    for (const item of entries) {
      if (item.sep) {
        const sep = document.createElement('div');
        sep.className = 'ctx-sep';
        menu.appendChild(sep);
        continue;
      }
      const row = document.createElement('div');
      row.className = 'ctx-item';
      row.textContent = item.label;
      if (item.children) {
        row.addEventListener('mouseenter', () => showSubMenu(row, item.children));
        row.addEventListener('click', (ev) => {
          ev.stopPropagation();
          showSubMenu(row, item.children);
        });
      } else {
        row.addEventListener('mouseenter', () => {
          if (subMenuContainer) {
            subMenuContainer.remove();
            subMenuContainer = null;
            syncMenuInputRegions();
          }
        });
        row.addEventListener('click', (ev) => {
          ev.stopPropagation();
          closeMenu();
          item.onClick();
        });
      }
      menu.appendChild(row);
    }

    document.body.appendChild(menu);
    const mr = menu.getBoundingClientRect();
    const x = Math.max(6, Math.min(window.innerWidth - mr.width - 6, e.clientX));
    const y = Math.max(6, Math.min(window.innerHeight - mr.height - 6, e.clientY));
    menu.style.left = `${x}px`;
    menu.style.top = `${y}px`;
    menuContainer = menu;
    syncMenuInputRegions();
  });

  window.addEventListener('mousedown', (e) => {
    if (menuContainer && !menuContainer.contains(e.target) && (!subMenuContainer || !subMenuContainer.contains(e.target))) {
      closeMenu();
    }
  });
  window.addEventListener('keydown', (e) => {
    if (e.key === 'Escape') closeMenu();
  });

  bridge.onFlightStates((states) => {
    if (Array.isArray(states)) peers = states;
  });

  bridge.onDisplays((nextDisplays) => {
    if (Array.isArray(nextDisplays) && nextDisplays.length > 0) displays = nextDisplays;
  });

  function applySnapshot(snap) {
    if (!snap || typeof snap !== 'object') return;
    if (snap.config) {
      physicsConfig = snap.config.physics || physicsConfig;
      weightsConfig = snap.config.weights || weightsConfig;
      avatarStyle = snap.config.avatarStyle || avatarStyle;
      soundEnabled = snap.config.enableSound !== false;
      runtime.setSoundEnabled(soundEnabled);
      const found = Array.isArray(snap.config.pets) ? snap.config.pets.find((p) => p.id === PET_ID) : null;
      if (found) {
        const sizeChanged = found.size !== petConfig.size;
        petConfig = found;
        if (sizeChanged) {
          layoutWindowForSize(petConfig.size);
          runtime.resizeCanvas(petConfig.size);
          syncWindowBounds();
        }
        runtime.updateConfig({
          weights: weightsConfig,
          avatarStyle,
          fixedEnabled: petConfig.fixedEnabled,
          workStatusEnabled: petConfig.workStatusEnabled,
          hueShift: petConfig.variantHueShift,
        });
      } else {
        runtime.updateConfig({ weights: weightsConfig, avatarStyle });
      }
    }
    if (snap.sleepByPet && Object.prototype.hasOwnProperty.call(snap.sleepByPet, PET_ID)) {
      const targetSleep = Boolean(snap.sleepByPet[PET_ID]);
      if (targetSleep !== runtime.isSleeping()) {
        runtime.setSleeping(targetSleep);
      }
    }
    if (snap.workStatus) {
      runtime.applyWorkStatus(snap.workStatus);
    }
    if (snap.lastCommand && snap.lastCommand.seq > lastCommandSeq) {
      lastCommandSeq = snap.lastCommand.seq;
      const cmd = snap.lastCommand;
      if (!cmd.petId || cmd.petId === PET_ID) {
        if (cmd.action === 'anim' && cmd.anim) {
          runtime.triggerAction(
            cmd.anim,
            cmd.text,
            Boolean(cmd.force),
            typeof cmd.lockMs === 'number' ? cmd.lockMs : 5000,
          );
        } else if (cmd.action === 'reset-pos') {
          flightBody.flying = false;
          walkTargetX = null;
          perchJump = null;
          peekGlideX = null;
          savedBeforePeekX = null;
          runtime.setSittingOnWindow(false);
          const pos = computeCornerBodyPos(petConfig);
          bodyX = pos.x;
          bodyY = pos.y;
          syncWindowBounds();
          runtime.emitCustomBubble('回到右下角待命咯 ✦', 'system', 4500);
        } else if (cmd.action === 'bubble' && cmd.text) {
          runtime.emitCustomBubble(cmd.text, 'whisper', 6500);
        }
      }
    }
  }

  async function bootstrapConnection() {
    if (params.get('smoke') === '1') {
      runtime.triggerAction('eat_fish', '咔嚓咔嚓~ 小鱼干是世界上最棒的零食喵！✦', true, 5000);
      return;
    }

    try {
      const res = await fetch(`${SERVER_URL}/state`);
      if (res.ok) {
        const snap = await res.json();
        applySnapshot(snap);
      }
    } catch {
      /* offline smoke mode can still run smoothly */
    }

    const connectSse = () => {
      try {
        const es = new EventSource(`${SERVER_URL}/events`);
        es.onmessage = (ev) => {
          try {
            applySnapshot(JSON.parse(ev.data));
          } catch {
            /* ignore */
          }
        };
        es.onerror = () => {
          es.close();
          setTimeout(connectSse, 2000);
        };
      } catch {
        setTimeout(connectSse, 2000);
      }
    };
    connectSse();
  }

  void bootstrapConnection();
})();
