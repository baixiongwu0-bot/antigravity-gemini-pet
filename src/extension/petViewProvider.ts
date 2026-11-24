import * as vscode from 'vscode';
import type { AnimationId, AvatarStyle, ServerStateSnapshot, WorkStatusState } from '../shared/types';

export interface ViewMessageFromWebview {
  type:
    | 'ready'
    | 'action'
    | 'toggle-desktop'
    | 'toggle-sleep'
    | 'toggle-sound'
    | 'set-display'
    | 'set-style'
    | 'add-pet'
    | 'remove-pet'
    | 'toggle-fixed'
    | 'reset-pos'
    | 'simulate-work'
    | 'set-size';
  anim?: AnimationId;
  displayMode?: 'both' | 'ide' | 'desktop' | 'none';
  avatarStyle?: AvatarStyle;
  state?: WorkStatusState | null;
  size?: number;
}

export class PetViewProvider implements vscode.WebviewViewProvider {
  public static readonly viewId = 'geminiPet.stageView';
  private view: vscode.WebviewView | null = null;
  private extensionUri: vscode.Uri;
  private getSnapshot: () => ServerStateSnapshot;
  private onMessage: (msg: ViewMessageFromWebview) => void;

  constructor(
    extensionUri: vscode.Uri,
    getSnapshot: () => ServerStateSnapshot,
    onMessage: (msg: ViewMessageFromWebview) => void,
  ) {
    this.extensionUri = extensionUri;
    this.getSnapshot = getSnapshot;
    this.onMessage = onMessage;
  }

  resolveWebviewView(webviewView: vscode.WebviewView): void {
    this.view = webviewView;
    webviewView.webview.options = {
      enableScripts: true,
      localResourceRoots: [vscode.Uri.joinPath(this.extensionUri, 'dist'), vscode.Uri.joinPath(this.extensionUri, 'assets')],
    };

    webviewView.webview.html = this.buildHtml(webviewView.webview);
    webviewView.webview.onDidReceiveMessage((msg: ViewMessageFromWebview) => {
      if (msg?.type === 'ready') {
        this.pushSnapshot();
        return;
      }
      this.onMessage(msg);
    });

    webviewView.onDidDispose(() => {
      if (this.view === webviewView) this.view = null;
    });
  }

  pushSnapshot(): void {
    if (!this.view) return;
    void this.view.webview.postMessage({ type: 'state', snapshot: this.getSnapshot() });
  }

  triggerAnimInView(anim: AnimationId, bubble?: string): void {
    if (!this.view) return;
    void this.view.webview.postMessage({ type: 'anim', anim, bubble });
  }

  private buildHtml(webview: vscode.Webview): string {
    const scriptUri = webview.asWebviewUri(vscode.Uri.joinPath(this.extensionUri, 'dist', 'webview', 'panel.js'));
    const posesUri = webview.asWebviewUri(vscode.Uri.joinPath(this.extensionUri, 'assets', 'poses'));
    const nonce = `${Date.now().toString(36)}${Math.random().toString(36).slice(2, 10)}`;

    return `<!DOCTYPE html>
<html lang="zh-CN">
<head>
  <meta charset="UTF-8" />
  <meta http-equiv="Content-Security-Policy" content="default-src 'none'; img-src ${webview.cspSource} data:; style-src 'unsafe-inline'; script-src 'nonce-${nonce}';" />
  <meta name="viewport" content="width=device-width, initial-scale=1.0" />
  <title>Gemini 星芒猫娘控制台</title>
  <style>
    * { box-sizing: border-box; user-select: none; }
    body {
      margin: 0;
      padding: 10px;
      color: var(--vscode-foreground);
      font-family: "Microsoft YaHei UI", "PingFang SC", var(--vscode-font-family), sans-serif;
      font-size: 12px;
      background: radial-gradient(circle at 50% 18%, rgba(114, 96, 255, 0.16), transparent 62%);
    }
    .stage-card {
      position: relative;
      display: flex;
      flex-direction: column;
      align-items: center;
      padding: 18px 8px 10px;
      border-radius: 14px;
      border: 1px solid rgba(148, 128, 255, 0.32);
      background: linear-gradient(180deg, rgba(32, 26, 70, 0.55) 0%, rgba(18, 16, 40, 0.72) 100%);
      overflow: hidden;
    }
    .stage-badge {
      position: absolute;
      top: 8px;
      left: 10px;
      right: 10px;
      display: flex;
      justify-content: space-between;
      align-items: center;
      font-size: 11px;
      color: #d9d0ff;
    }
    .pill {
      padding: 2px 8px;
      border-radius: 999px;
      background: rgba(124, 104, 255, 0.25);
      border: 1px solid rgba(162, 146, 255, 0.42);
    }
    .bubble {
      position: relative;
      min-height: 30px;
      max-width: 92%;
      margin: 28px auto 6px;
      padding: 9px 14px;
      border-radius: 20px;
      background: linear-gradient(180deg, #FFF9FE 0%, #F3E7FF 100%);
      border: 2px solid #B983FF;
      box-shadow: 0 8px 20px rgba(108, 66, 178, 0.24), 0 2px 8px rgba(185, 131, 255, 0.26);
      font-family: "YouYuan", "幼圆", "STCaiyun", "华文彩云", "FZShaoEr", "PingFang SC", "Comic Sans MS", sans-serif;
      color: #4A256E;
      font-size: 12.5px;
      font-weight: 700;
      line-height: 1.48;
      letter-spacing: 0.02em;
      text-align: center;
      white-space: normal;
      overflow: visible;
      opacity: 0;
      transform: translateY(6px) scale(0.76);
      transform-origin: center bottom;
      transition: opacity 0.18s ease;
    }
    .bubble .bubble-text {
      position: relative;
      z-index: 2;
      display: block;
      white-space: pre-wrap;
      word-break: break-word;
      overflow-wrap: anywhere;
      color: #4A256E;
      text-shadow:
        -1.5px -1.5px 0 #FFFFFF,
         0px   -1.5px 0 #FFFFFF,
         1.5px -1.5px 0 #FFFFFF,
        -1.5px  0px   0 #FFFFFF,
         1.5px  0px   0 #FFFFFF,
        -1.5px  1.5px 0 #FFFFFF,
         0px    1.5px 0 #FFFFFF,
         1.5px  1.5px 0 #FFFFFF,
         0px    2px   6px rgba(185, 131, 255, 0.36);
    }
    .bubble .bubble-ear {
      position: absolute;
      top: -12px;
      width: 20px;
      height: 14px;
      pointer-events: none;
      z-index: 1;
    }
    .bubble .bubble-ear-l {
      left: 14px;
      transform: rotate(-10deg);
    }
    .bubble .bubble-ear-r {
      right: 14px;
      transform: rotate(10deg);
    }
    .bubble .bubble-star {
      position: absolute;
      pointer-events: none;
      z-index: 3;
      animation: sideBubbleStarTwinkle 2.1s ease-in-out infinite;
    }
    .bubble .bubble-star-l {
      left: -7px;
      top: -7px;
      width: 14px;
      height: 14px;
    }
    .bubble .bubble-star-r {
      right: -6px;
      top: -10px;
      width: 12px;
      height: 12px;
      animation-delay: 0.75s;
    }
    .bubble::after {
      content: '';
      position: absolute;
      left: 50%;
      bottom: -8px;
      width: 11px;
      height: 11px;
      transform: translateX(-50%) rotate(45deg);
      background: #F3E7FF;
      border-right: 2px solid #B983FF;
      border-bottom: 2px solid #B983FF;
      border-bottom-right-radius: 3px;
    }
    .bubble.visible {
      opacity: 1;
      animation:
        sideBubblePopIn 0.42s cubic-bezier(0.34, 1.56, 0.64, 1) forwards,
        sideBubbleFloat 3.2s ease-in-out 0.42s infinite;
    }
    .bubble[data-kind="work"] {
      border-color: #9A7BFF;
      box-shadow: 0 8px 22px rgba(96, 118, 214, 0.28), 0 0 14px rgba(154, 178, 255, 0.42);
    }
    @keyframes sideBubblePopIn {
      0% { opacity: 0; transform: translateY(6px) scale(0.7); }
      65% { opacity: 1; transform: translateY(-2px) scale(1.05); }
      100% { opacity: 1; transform: translateY(0) scale(1); }
    }
    @keyframes sideBubbleFloat {
      0%, 100% { transform: translateY(0) scale(1); }
      50% { transform: translateY(-3px) scale(1); }
    }
    @keyframes sideBubbleStarTwinkle {
      0%, 100% { transform: scale(0.88) rotate(0deg); opacity: 0.84; }
      50% { transform: scale(1.16) rotate(14deg); opacity: 1; }
    }
    #ide-canvas {
      display: block;
      cursor: pointer;
      margin-top: -6px;
    }
    .hidden-note {
      padding: 36px 12px;
      text-align: center;
      color: #b7addb;
    }
    .section {
      margin-top: 10px;
      padding: 9px;
      border-radius: 11px;
      background: rgba(255, 255, 255, 0.03);
      border: 1px solid rgba(148, 128, 255, 0.2);
    }
    .section-title {
      font-size: 11px;
      font-weight: 600;
      color: #cfc6ff;
      margin-bottom: 7px;
      display: flex;
      justify-content: space-between;
      align-items: center;
    }
    .grid {
      display: grid;
      grid-template-columns: repeat(2, minmax(0, 1fr));
      gap: 6px;
    }
    .grid-3 {
      display: grid;
      grid-template-columns: repeat(3, minmax(0, 1fr));
      gap: 5px;
    }
    button {
      border: 1px solid rgba(152, 134, 255, 0.35);
      background: rgba(92, 76, 194, 0.22);
      color: var(--vscode-foreground);
      border-radius: 8px;
      padding: 6px 7px;
      font-size: 11.5px;
      cursor: pointer;
      transition: background 0.15s ease, border-color 0.15s ease;
    }
    button:hover {
      background: rgba(126, 106, 255, 0.36);
      border-color: rgba(182, 166, 255, 0.65);
    }
    button.active {
      background: linear-gradient(135deg, rgba(94, 126, 255, 0.55), rgba(186, 108, 255, 0.52));
      border-color: rgba(196, 182, 255, 0.85);
      color: #ffffff;
    }
    .row {
      display: flex;
      align-items: center;
      justify-content: space-between;
      gap: 8px;
      margin-top: 6px;
    }
    input[type="range"] {
      flex: 1;
      accent-color: #9e7bff;
    }
    .meta-foot {
      margin-top: 8px;
      font-size: 10.5px;
      color: #9e96bf;
      word-break: break-all;
      line-height: 1.45;
    }
  </style>
</head>
<body>
  <div class="stage-card">
    <div class="stage-badge">
      <span id="pet-title">✦ 星芒喵</span>
      <span id="work-pill" class="pill">待机中</span>
    </div>
    <div id="ide-bubble" class="bubble">
      <svg class="bubble-ear bubble-ear-l" viewBox="0 0 24 16" aria-hidden="true">
        <path d="M2 15 Q5 2 11 2 Q17 2 22 15 Z" fill="#FFF9FE" stroke="#B983FF" stroke-width="2" stroke-linejoin="round" />
        <path d="M6.5 14 Q9.5 6 11.2 6 Q13.5 6 17 14 Z" fill="#F8B4EB" />
      </svg>
      <svg class="bubble-ear bubble-ear-r" viewBox="0 0 24 16" aria-hidden="true">
        <path d="M2 15 Q7 2 13 2 Q19 2 22 15 Z" fill="#FFF9FE" stroke="#B983FF" stroke-width="2" stroke-linejoin="round" />
        <path d="M7 14 Q10.5 6 12.8 6 Q14.5 6 17.5 14 Z" fill="#F8B4EB" />
      </svg>
      <svg class="bubble-star bubble-star-l" viewBox="0 0 16 16" aria-hidden="true">
        <path d="M8 0 Q9.4 6.6 16 8 Q9.4 9.4 8 16 Q6.6 9.4 0 8 Q6.6 6.6 8 0 Z" fill="#FFD970" stroke="#FFFFFF" stroke-width="1" />
      </svg>
      <svg class="bubble-star bubble-star-r" viewBox="0 0 16 16" aria-hidden="true">
        <path d="M8 0 Q9.4 6.6 16 8 Q9.4 9.4 8 16 Q6.6 9.4 0 8 Q6.6 6.6 8 0 Z" fill="#C996FF" stroke="#FFFFFF" stroke-width="1" />
      </svg>
      <span class="bubble-text"></span>
    </div>
    <canvas id="ide-canvas" width="210" height="210"></canvas>
    <div id="hidden-note" class="hidden-note" style="display:none">内嵌模式已切换为「仅桌面悬浮」或「隐藏」，点击下方形态按钮可随时唤回 ✦</div>
  </div>

  <div class="section">
    <div class="section-title">
      <span>双形态显示控制</span>
      <span id="desktop-status" class="pill">检测中</span>
    </div>
    <div class="grid">
      <button id="btn-mode-both">✦ 双形态全开</button>
      <button id="btn-mode-desktop">🪟 仅桌面悬浮</button>
      <button id="btn-mode-ide">📌 仅 IDE 内嵌</button>
      <button id="btn-mode-none">🙈 暂时隐藏</button>
    </div>
    <div class="row">
      <button id="btn-sleep" style="flex:1">💤 摸鱼打盹</button>
      <button id="btn-fixed" style="flex:1">📌 位置固定</button>
      <button id="btn-sound" style="flex:1">🔊 音效开</button>
      <button id="btn-reset" style="flex:1">🏠 回右下角</button>
    </div>
  </div>

  <div class="section">
    <div class="section-title">
      <span>形象风格切换</span>
      <span id="style-pill" class="pill">Q版萌系</span>
    </div>
    <div class="row" style="margin-top:0; flex-direction:column; align-items:stretch; gap:6px;">
      <button data-style="chibi">🍡 Q版萌系全动作（默认）</button>
      <button data-style="illust">✨ 精致立绘全动作</button>
      <button data-style="mixed">🎭 双画风混搭</button>
    </div>
  </div>

  <div class="section">
    <div class="section-title"><span>互动动作舞台</span></div>
    <div class="grid-3">
      <button data-anim="eat_fish">🐟 喂小鱼干</button>
      <button data-anim="toss_star">✦ 抛四角星</button>
      <button data-anim="peek">👀 窗边偷看</button>
      <button data-anim="stretch">🙆 伸大懒腰</button>
      <button data-anim="hum">🎵 晃耳哼歌</button>
      <button data-anim="star_magic">✨ 星芒魔法</button>
      <button data-anim="spin_show">💃 转圈展示</button>
      <button data-anim="groom">🎀 理理呆毛</button>
      <button data-anim="eat_cookie">🍪 星形曲奇</button>
    </div>
  </div>

  <div class="section">
    <div class="section-title"><span>Agent 状态联动演练</span></div>
    <div class="grid-3">
      <button data-work="thinking">🤔 托腮沉思</button>
      <button data-work="working">⚡ 专注敲代码</button>
      <button data-work="result">📋 整理结果</button>
      <button data-work="waiting">🙋 等你确认</button>
      <button data-work="success">🎉 抛星庆祝</button>
      <button data-work="error">💦 异常打气</button>
    </div>
    <div class="row">
      <button id="btn-work-idle" style="flex:1">恢复正常待机</button>
    </div>
  </div>

  <div class="section">
    <div class="section-title">
      <span>多开猫娘与桌面尺寸</span>
      <span id="pet-count">1 只</span>
    </div>
    <div class="grid">
      <button id="btn-add-pet">➕ 召唤新猫娘</button>
      <button id="btn-rem-pet">➖ 送走多余猫娘</button>
    </div>
    <div class="row">
      <span>桌面体型</span>
      <input id="size-slider" type="range" min="140" max="380" step="10" value="240" />
      <span id="size-val">240px</span>
    </div>
    <div id="http-info" class="meta-foot">本地 HTTP 联动接口：启动中...</div>
  </div>

  <script nonce="${nonce}">window.__GEMINI_PET_ASSET_BASE__ = ${JSON.stringify(posesUri.toString())};</script>
  <script nonce="${nonce}" src="${scriptUri}"></script>
</body>
</html>`;
  }
}
