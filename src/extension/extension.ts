import * as vscode from 'vscode';
import { ANIMATION_CATALOG, AVATAR_STYLE_LABELS, createDefaultConfig, createDefaultPet, WORK_STATUS_LABELS } from '../shared/config';
import type { AnimationId, AvatarStyle, DisplayMode, ServerCommandEvent, ServerStateSnapshot, SharedPetConfig, WorkStatusState } from '../shared/types';
import { AgentWatcher } from './agentWatcher';
import { resolveElectronExecutable, resolveRuntimeDataDir } from './electronResolver';
import { HelperManager } from './helperManager';
import { HttpBridge } from './httpBridge';
import { PetViewProvider } from './petViewProvider';

let helperManager: HelperManager | null = null;
let httpBridge: HttpBridge | null = null;
let agentWatcher: AgentWatcher | null = null;

function readConfigFromSettings(): {
  shared: SharedPetConfig;
  autoLaunchDesktop: boolean;
  electronSetting: string;
  runtimeDirSetting: string;
  httpPort: number;
  brainDirSetting: string;
} {
  const cfg = vscode.workspace.getConfiguration('geminiPet');
  const shared = createDefaultConfig();
  const displayMode = cfg.get<DisplayMode>('displayMode', 'both');
  const rawStyle = cfg.get<AvatarStyle>('avatarStyle', 'chibi');
  const avatarStyle: AvatarStyle = rawStyle === 'illust' || rawStyle === 'mixed' ? rawStyle : 'chibi';
  const autoLaunchDesktop = cfg.get<boolean>('autoLaunchDesktop', true);
  const petSize = cfg.get<number>('petSize', 240);
  const petName = cfg.get<string>('petName', '星芒喵') || '星芒喵';
  const fixedPosition = cfg.get<boolean>('fixedPosition', false);
  const enableAgentLink = cfg.get<boolean>('enableAgentLink', true);
  const enableTray = cfg.get<boolean>('enableTray', true);
  const enablePetCollision = cfg.get<boolean>('enablePetCollision', true);
  const enableSound = cfg.get<boolean>('enableSound', true);

  shared.displayMode = displayMode;
  shared.avatarStyle = avatarStyle;
  shared.enableAgentLink = enableAgentLink;
  shared.enableTray = enableTray;
  shared.enableSound = enableSound;
  shared.physics.petCollision = enablePetCollision;
  shared.pets[0].name = petName;
  shared.pets[0].size = petSize;
  shared.pets[0].fixedEnabled = fixedPosition;
  shared.pets[0].workStatusEnabled = enableAgentLink;
  shared.pets[0].display = displayMode;

  return {
    shared,
    autoLaunchDesktop,
    electronSetting: cfg.get<string>('electronPath', ''),
    runtimeDirSetting: cfg.get<string>('runtimeDataDir', ''),
    httpPort: cfg.get<number>('httpPort', 47821),
    brainDirSetting: cfg.get<string>('antigravityBrainDir', ''),
  };
}

export async function activate(context: vscode.ExtensionContext): Promise<void> {
  const output = vscode.window.createOutputChannel('Gemini 星芒猫娘');
  context.subscriptions.push(output);

  let settings = readConfigFromSettings();
  let sharedConfig = settings.shared;
  const sleepByPet: Record<string, boolean> = { main: false };
  let commandSeq = 0;
  let lastCommand: ServerCommandEvent | undefined;
  let electronExe = resolveElectronExecutable(context.extensionPath, settings.electronSetting);
  let runtimeDir = resolveRuntimeDataDir(context.extensionPath, settings.runtimeDirSetting);
  let desktopBootAllowed = settings.autoLaunchDesktop;

  helperManager = new HelperManager();

  const statusBar = vscode.window.createStatusBarItem(vscode.StatusBarAlignment.Right, 95);
  statusBar.command = 'geminiPet.toggleDesktopMode';
  statusBar.tooltip = '左键切换透明桌面悬浮猫娘 (Ctrl+Alt+P)';
  context.subscriptions.push(statusBar);

  const getSnapshot = (): ServerStateSnapshot => ({
    config: sharedConfig,
    workStatus: agentWatcher?.getSnapshot() ?? {
      state: null,
      task: null,
      source: 'idle',
      updatedAt: Date.now(),
      seq: 1,
    },
    sleepByPet: { ...sleepByPet },
    serverPort: httpBridge?.getPort() ?? 0,
    desktopRunning: helperManager?.isRunning() ?? false,
    electronPath: electronExe,
    lastCommand,
  });

  const updateStatusBar = (): void => {
    const mode = sharedConfig.displayMode;
    const ws = agentWatcher?.getSnapshot().state;
    const stateText = ws ? WORK_STATUS_LABELS[ws] : sleepByPet.main ? '打盹中' : '待机中';
    const modeTag =
      mode === 'both'
        ? helperManager?.isRunning()
          ? '双形态'
          : 'IDE内嵌'
        : mode === 'desktop'
          ? '桌面悬浮'
          : mode === 'ide'
            ? '仅IDE'
            : '已隐藏';
    statusBar.text = `$(sparkle) ${sharedConfig.pets[0]?.name || '星芒喵'} · ${stateText} [${modeTag}]`;
    statusBar.show();
  };

  let viewProvider: PetViewProvider | null = null;

  const pushAll = (): void => {
    updateStatusBar();
    httpBridge?.broadcastState();
    viewProvider?.pushSnapshot();
  };

  const syncDesktopHelper = async (): Promise<void> => {
    electronExe = resolveElectronExecutable(context.extensionPath, settings.electronSetting);
    const wantsDesktop =
      (sharedConfig.displayMode === 'both' || sharedConfig.displayMode === 'desktop') && desktopBootAllowed;
    if (wantsDesktop && !electronExe) {
      output.appendLine('[warning] 未探测到可用的 Electron 运行时，已降级为仅 IDE 内嵌模式；可在设置 geminiPet.electronPath 中指定。');
    }
    if (!helperManager) return;
    await helperManager.sync(
      {
        electronExe: electronExe || '',
        extensionPath: context.extensionPath,
        runtimeDir,
        serverUrl: httpBridge?.getUrl() || 'http://127.0.0.1:47821',
        pets: sharedConfig.pets.filter((p) => p.display !== 'none' && p.display !== 'ide'),
        enableTray: sharedConfig.enableTray,
        onStatusChange: () => {
          updateStatusBar();
          viewProvider?.pushSnapshot();
        },
        logger: (msg) => output.appendLine(msg),
      },
      Boolean(wantsDesktop && electronExe),
    );
    pushAll();
  };

  const issueCommand = (cmd: Omit<ServerCommandEvent, 'seq'>): void => {
    commandSeq += 1;
    lastCommand = { ...cmd, seq: commandSeq };
    if (cmd.action === 'anim' && cmd.anim) {
      viewProvider?.triggerAnimInView(cmd.anim, cmd.text);
    }
    pushAll();
  };

  const setDisplayMode = async (nextMode: DisplayMode): Promise<void> => {
    sharedConfig.displayMode = nextMode;
    for (const p of sharedConfig.pets) p.display = nextMode;
    if (nextMode === 'both' || nextMode === 'desktop') desktopBootAllowed = true;
    await vscode.workspace.getConfiguration('geminiPet').update('displayMode', nextMode, vscode.ConfigurationTarget.Global);
    await syncDesktopHelper();
  };

  const setAvatarStyle = async (nextStyle: AvatarStyle): Promise<void> => {
    const valid: AvatarStyle = nextStyle === 'illust' || nextStyle === 'mixed' ? nextStyle : 'chibi';
    sharedConfig.avatarStyle = valid;
    await vscode.workspace.getConfiguration('geminiPet').update('avatarStyle', valid, vscode.ConfigurationTarget.Global);
    pushAll();
  };

  const toggleSleep = (petId = 'main', explicit?: boolean): void => {
    const next = explicit !== undefined ? explicit : !sleepByPet[petId];
    sleepByPet[petId] = next;
    pushAll();
  };

  const addExtraPet = async (): Promise<void> => {
    if (sharedConfig.pets.length >= 5) {
      void vscode.window.showInformationMessage('最多同时召唤 5 只星芒猫娘，避免屏幕太挤喵~');
      return;
    }
    const idx = sharedConfig.pets.length;
    const extra = createDefaultPet(idx, {
      display: sharedConfig.displayMode,
      size: sharedConfig.pets[0]?.size ?? 240,
      fixedEnabled: sharedConfig.pets[0]?.fixedEnabled ?? false,
      workStatusEnabled: sharedConfig.enableAgentLink,
    });
    sharedConfig.pets.push(extra);
    sleepByPet[extra.id] = false;
    await syncDesktopHelper();
  };

  const removeExtraPet = async (): Promise<void> => {
    if (sharedConfig.pets.length <= 1) return;
    const removed = sharedConfig.pets.pop();
    if (removed) delete sleepByPet[removed.id];
    await syncDesktopHelper();
  };

  httpBridge = new HttpBridge(runtimeDir, {
    getSnapshot,
    onWorkStatus: (input) => {
      agentWatcher?.pushSignal(input.source || 'http', input.state, input.task ?? null, input.ttlMs);
      pushAll();
    },
    onAction: (input) => {
      const targetId = input.petId || 'main';
      if (input.action === 'toggle-sleep') {
        toggleSleep(targetId);
      } else if (input.action === 'set-sleep') {
        toggleSleep(targetId, input.sleeping);
      } else if (input.action === 'anim' && input.anim) {
        const animId = input.anim as AnimationId;
        if (animId === 'sleep_start' || animId === 'sleep_loop') {
          sleepByPet[targetId] = true;
        } else if (animId === 'sleep_end' || (input.force && sleepByPet[targetId])) {
          sleepByPet[targetId] = false;
        }
        issueCommand({
          action: 'anim',
          petId: targetId,
          anim: animId,
          text: input.text,
          force: input.force,
          lockMs: input.lockMs,
        });
      } else if (input.action === 'sync-anim' && input.anim) {
        const animId = input.anim as AnimationId;
        let sleepChanged = false;
        if (animId === 'sleep_start' || animId === 'sleep_loop') {
          if (!sleepByPet[targetId]) {
            sleepByPet[targetId] = true;
            sleepChanged = true;
          }
        } else if ((animId === 'sleep_end' || input.force) && sleepByPet[targetId]) {
          sleepByPet[targetId] = false;
          sleepChanged = true;
        }
        viewProvider?.triggerAnimInView(animId, input.text);
        if (sleepChanged) pushAll();
      } else if (input.action === 'reset-pos') {
        issueCommand({ action: 'reset-pos', petId: targetId });
      } else if (input.action === 'bubble' && input.text) {
        issueCommand({ action: 'bubble', petId: targetId, text: input.text });
      }
    },
    onConfigPatch: (patch) => {
      if (patch.displayMode) {
        void setDisplayMode(patch.displayMode);
      }
      if (patch.avatarStyle) {
        void setAvatarStyle(patch.avatarStyle);
      }
      if (patch.op === 'add-pet') {
        void addExtraPet();
      } else if (patch.op === 'remove-pet') {
        void removeExtraPet();
      } else if (patch.op === 'toggle-fixed') {
        const p = sharedConfig.pets.find((x) => x.id === (patch.petId || 'main'));
        if (p) {
          p.fixedEnabled = patch.fixedEnabled ?? !p.fixedEnabled;
          pushAll();
        }
      } else if (patch.op === 'toggle-sound') {
        const nextSound = patch.enableSound ?? !sharedConfig.enableSound;
        sharedConfig.enableSound = nextSound;
        void vscode.workspace.getConfiguration('geminiPet').update('enableSound', nextSound, vscode.ConfigurationTarget.Global);
        pushAll();
      }
    },
  });

  const boundPort = await httpBridge.start(settings.httpPort);
  output.appendLine(`[gemini-pet] HTTP bridge listening at http://127.0.0.1:${boundPort}`);
  output.appendLine(`[gemini-pet] runtimeDir=${runtimeDir}, electron=${electronExe ?? 'NOT FOUND'}`);

  agentWatcher = new AgentWatcher({
    enabled: sharedConfig.enableAgentLink,
    brainDirOverride: settings.brainDirSetting,
    onChange: () => {
      pushAll();
    },
  });
  context.subscriptions.push(agentWatcher);

  viewProvider = new PetViewProvider(context.extensionUri, getSnapshot, (msg) => {
    switch (msg.type) {
      case 'action':
        if (msg.anim) {
          if (msg.anim === 'sleep_start' || msg.anim === 'sleep_loop') {
            sleepByPet.main = true;
          } else if (sleepByPet.main) {
            sleepByPet.main = false;
          }
          issueCommand({ action: 'anim', anim: msg.anim, force: true, lockMs: 5000 });
        }
        break;
      case 'set-display':
        if (msg.displayMode) void setDisplayMode(msg.displayMode);
        break;
      case 'set-style':
        if (msg.avatarStyle) void setAvatarStyle(msg.avatarStyle);
        break;
      case 'toggle-desktop':
        void vscode.commands.executeCommand('geminiPet.toggleDesktopMode');
        break;
      case 'toggle-sleep':
        toggleSleep('main');
        break;
      case 'add-pet':
        void addExtraPet();
        break;
      case 'remove-pet':
        void removeExtraPet();
        break;
      case 'toggle-fixed':
        if (sharedConfig.pets[0]) {
          sharedConfig.pets[0].fixedEnabled = !sharedConfig.pets[0].fixedEnabled;
          void vscode.workspace
            .getConfiguration('geminiPet')
            .update('fixedPosition', sharedConfig.pets[0].fixedEnabled, vscode.ConfigurationTarget.Global);
          pushAll();
        }
        break;
      case 'toggle-sound': {
        const nextSound = !sharedConfig.enableSound;
        sharedConfig.enableSound = nextSound;
        void vscode.workspace
          .getConfiguration('geminiPet')
          .update('enableSound', nextSound, vscode.ConfigurationTarget.Global);
        pushAll();
        break;
      }
      case 'reset-pos':
        issueCommand({ action: 'reset-pos' });
        break;
      case 'simulate-work':
        agentWatcher?.pushSignal('manual', msg.state ?? null, msg.state ? `手动演练：${WORK_STATUS_LABELS[msg.state]}` : null, 12_000);
        pushAll();
        break;
      case 'set-size':
        if (msg.size && Number.isFinite(msg.size)) {
          for (const p of sharedConfig.pets) p.size = msg.size;
          void vscode.workspace.getConfiguration('geminiPet').update('petSize', msg.size, vscode.ConfigurationTarget.Global);
          pushAll();
        }
        break;
    }
  });

  context.subscriptions.push(
    vscode.window.registerWebviewViewProvider(PetViewProvider.viewId, viewProvider, {
      webviewOptions: { retainContextWhenHidden: true },
    }),
  );

  // Register Commands
  context.subscriptions.push(
    vscode.commands.registerCommand('geminiPet.toggleVisibility', async () => {
      const next: DisplayMode = sharedConfig.displayMode === 'none' ? 'both' : 'none';
      await setDisplayMode(next);
    }),
    vscode.commands.registerCommand('geminiPet.toggleDesktopMode', async () => {
      const hasDesktop = sharedConfig.displayMode === 'both' || sharedConfig.displayMode === 'desktop';
      if (hasDesktop && helperManager?.isRunning()) {
        await setDisplayMode('ide');
      } else {
        desktopBootAllowed = true;
        if (!electronExe) {
          void vscode.window.showWarningMessage(
            '未检测到本机 Electron 运行时。请在设置「geminiPet.electronPath」填入 electron.exe 路径（已默认为您打开 IDE 侧边栏内嵌模式）。',
          );
          await setDisplayMode('ide');
          return;
        }
        await setDisplayMode('both');
      }
    }),
    vscode.commands.registerCommand('geminiPet.openPanel', async () => {
      await vscode.commands.executeCommand('workbench.view.extension.gemini-pet-sidebar');
    }),
    vscode.commands.registerCommand('geminiPet.triggerAction', async () => {
      const items = Object.values(ANIMATION_CATALOG)
        .filter((m) => !m.id.startsWith('sleep_') && m.id !== 'drag')
        .map((m) => ({ label: m.label, description: m.id, anim: m.id }));
      const picked = await vscode.window.showQuickPick(items, { placeHolder: '选择要让星芒猫娘表演的动作' });
      if (picked) {
        if (sleepByPet.main && !picked.anim.startsWith('sleep_')) sleepByPet.main = false;
        issueCommand({ action: 'anim', anim: picked.anim, force: true, lockMs: 5000 });
      }
    }),
    vscode.commands.registerCommand('geminiPet.feedSnack', () => {
      if (sleepByPet.main) sleepByPet.main = false;
      issueCommand({ action: 'anim', anim: 'eat_fish', force: true, lockMs: 5000 });
    }),
    vscode.commands.registerCommand('geminiPet.tossStar', () => {
      if (sleepByPet.main) sleepByPet.main = false;
      issueCommand({ action: 'anim', anim: 'toss_star', force: true, lockMs: 5000 });
    }),
    vscode.commands.registerCommand('geminiPet.toggleSleep', () => {
      toggleSleep('main');
    }),
    vscode.commands.registerCommand('geminiPet.switchAvatarStyle', async () => {
      const styles: Array<{ label: string; style: AvatarStyle }> = [
        { label: AVATAR_STYLE_LABELS.chibi, style: 'chibi' },
        { label: AVATAR_STYLE_LABELS.illust, style: 'illust' },
        { label: AVATAR_STYLE_LABELS.mixed, style: 'mixed' },
      ];
      const picked = await vscode.window.showQuickPick(styles, { placeHolder: '选择猫娘形象风格' });
      if (picked) {
        await setAvatarStyle(picked.style);
      }
    }),
    vscode.commands.registerCommand('geminiPet.summonPet', () => {
      void addExtraPet();
    }),
    vscode.commands.registerCommand('geminiPet.removeExtraPet', () => {
      void removeExtraPet();
    }),
    vscode.commands.registerCommand('geminiPet.resetPositions', () => {
      issueCommand({ action: 'reset-pos' });
    }),
    vscode.commands.registerCommand('geminiPet.simulateAgentState', async () => {
      const states: Array<{ label: string; state: WorkStatusState | null }> = [
        { label: '🤔 托腮沉思 (thinking)', state: 'thinking' },
        { label: '⚡ 专注敲代码加油 (working)', state: 'working' },
        { label: '📋 星光整理结果 (result)', state: 'result' },
        { label: '🙋 探头等你确认 (waiting)', state: 'waiting' },
        { label: '🎉 跳跃抛星庆祝 (success)', state: 'success' },
        { label: '💦 遇到异常打气 (error)', state: 'error' },
        { label: '🌸 恢复正常待机 (idle)', state: null },
      ];
      const picked = await vscode.window.showQuickPick(states, { placeHolder: '测试 Agent 状态联动效果' });
      if (!picked) return;
      agentWatcher?.pushSignal(
        'manual',
        picked.state,
        picked.state ? `演练：${WORK_STATUS_LABELS[picked.state]}` : null,
        12_000,
      );
      pushAll();
    }),
    vscode.commands.registerCommand('geminiPet.showServerInfo', () => {
      const url = httpBridge?.getUrl();
      void vscode.window.showInformationMessage(
        url
          ? `猫娘状态联动接口运行中：POST ${url}/work-status (例如 {"state":"working","task":"构建中"})`
          : '本地 HTTP 服务尚未启动',
      );
    }),
    vscode.workspace.onDidChangeConfiguration((e) => {
      if (!e.affectsConfiguration('geminiPet')) return;
      settings = readConfigFromSettings();
      const extraPets = sharedConfig.pets.slice(1);
      sharedConfig = settings.shared;
      for (const ep of extraPets) {
        ep.display = sharedConfig.displayMode;
        ep.size = sharedConfig.pets[0].size;
        ep.workStatusEnabled = sharedConfig.enableAgentLink;
        sharedConfig.pets.push(ep);
      }
      runtimeDir = resolveRuntimeDataDir(context.extensionPath, settings.runtimeDirSetting);
      agentWatcher?.setOptions({
        enabled: sharedConfig.enableAgentLink,
        brainDirOverride: settings.brainDirSetting,
      });
      void syncDesktopHelper();
    }),
  );

  // Start desktop floating helper if configured
  await syncDesktopHelper();
  updateStatusBar();
}

export async function deactivate(): Promise<void> {
  agentWatcher?.dispose();
  agentWatcher = null;
  if (helperManager) {
    await helperManager.stopAndWait(1800);
    helperManager = null;
  }
  if (httpBridge) {
    await httpBridge.stop();
    httpBridge = null;
  }
}
