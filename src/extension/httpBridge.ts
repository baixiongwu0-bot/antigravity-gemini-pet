import { createServer, type IncomingMessage, type Server, type ServerResponse } from 'node:http';
import { mkdirSync, rmSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import type { AvatarStyle, ServerStateSnapshot, WorkStatusState } from '../shared/types';

export interface WorkStatusInput {
  state: WorkStatusState | null;
  task?: string | null;
  source?: string;
  ttlMs?: number;
}

export interface ActionInput {
  action: string;
  petId?: string;
  anim?: string;
  sleeping?: boolean;
  text?: string;
  force?: boolean;
  lockMs?: number;
}

export interface ConfigPatchInput {
  op?: 'add-pet' | 'remove-pet' | 'toggle-fixed' | 'toggle-sound';
  displayMode?: 'both' | 'ide' | 'desktop' | 'none';
  avatarStyle?: AvatarStyle;
  petId?: string;
  fixedEnabled?: boolean;
  enableSound?: boolean;
}

export interface HttpBridgeHandlers {
  getSnapshot: () => ServerStateSnapshot;
  onWorkStatus: (input: WorkStatusInput) => void;
  onAction: (input: ActionInput) => void;
  onConfigPatch: (input: ConfigPatchInput) => void;
}

const VALID_WORK_STATES = new Set<string>(['waiting', 'error', 'working', 'thinking', 'result', 'success']);

export class HttpBridge {
  private server: Server | null = null;
  private port = 0;
  private sseClients = new Set<ServerResponse>();
  private runtimeDir: string;
  private handlers: HttpBridgeHandlers;

  constructor(runtimeDir: string, handlers: HttpBridgeHandlers) {
    this.runtimeDir = runtimeDir;
    this.handlers = handlers;
  }

  getPort(): number {
    return this.port;
  }

  getUrl(): string {
    return this.port > 0 ? `http://127.0.0.1:${this.port}` : '';
  }

  async start(preferredPort = 47821): Promise<number> {
    if (this.server) return this.port;

    const tryListen = (portToBind: number): Promise<number> =>
      new Promise((resolvePort, rejectPort) => {
        const srv = createServer((req, res) => void this.handleRequest(req, res));
        srv.once('error', (err: NodeJS.ErrnoException) => {
          srv.close();
          rejectPort(err);
        });
        srv.listen(portToBind, '127.0.0.1', () => {
          this.server = srv;
          const addr = srv.address();
          const bound = typeof addr === 'object' && addr ? addr.port : portToBind;
          this.port = bound;
          resolvePort(bound);
        });
      });

    try {
      await tryListen(preferredPort);
    } catch {
      await tryListen(0);
    }

    this.writeServerInfo();
    return this.port;
  }

  private writeServerInfo(): void {
    try {
      mkdirSync(this.runtimeDir, { recursive: true });
      writeFileSync(
        join(this.runtimeDir, 'server-info.json'),
        JSON.stringify(
          {
            port: this.port,
            url: this.getUrl(),
            pid: process.pid,
            startedAt: new Date().toISOString(),
          },
          null,
          2,
        ),
      );
    } catch {
      /* non-fatal */
    }
  }

  broadcastState(): void {
    if (this.sseClients.size === 0) return;
    const payload = `data: ${JSON.stringify(this.handlers.getSnapshot())}\n\n`;
    for (const res of this.sseClients) {
      try {
        res.write(payload);
      } catch {
        this.sseClients.delete(res);
      }
    }
  }

  private async readJsonBody(req: IncomingMessage): Promise<Record<string, unknown>> {
    const chunks: Buffer[] = [];
    let total = 0;
    for await (const chunk of req) {
      const buf = Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk);
      total += buf.length;
      if (total > 256 * 1024) throw new Error('Payload too large');
      chunks.push(buf);
    }
    const raw = Buffer.concat(chunks).toString('utf8').trim();
    if (!raw) return {};
    const parsed = JSON.parse(raw);
    return parsed && typeof parsed === 'object' ? (parsed as Record<string, unknown>) : {};
  }

  private sendJson(res: ServerResponse, status: number, body: unknown): void {
    res.writeHead(status, {
      'content-type': 'application/json; charset=utf-8',
      'access-control-allow-origin': '*',
      'access-control-allow-methods': 'GET, POST, OPTIONS',
      'access-control-allow-headers': 'content-type',
      'cache-control': 'no-store',
    });
    res.end(JSON.stringify(body));
  }

  private async handleRequest(req: IncomingMessage, res: ServerResponse): Promise<void> {
    if (req.method === 'OPTIONS') {
      res.writeHead(204, {
        'access-control-allow-origin': '*',
        'access-control-allow-methods': 'GET, POST, OPTIONS',
        'access-control-allow-headers': 'content-type',
      });
      res.end();
      return;
    }

    const url = new URL(req.url || '/', 'http://127.0.0.1');

    if (req.method === 'GET' && url.pathname === '/health') {
      this.sendJson(res, 200, { ok: true, port: this.port, pid: process.pid });
      return;
    }

    if (req.method === 'GET' && url.pathname === '/state') {
      this.sendJson(res, 200, this.handlers.getSnapshot());
      return;
    }

    if (req.method === 'GET' && url.pathname === '/events') {
      res.writeHead(200, {
        'content-type': 'text/event-stream; charset=utf-8',
        'cache-control': 'no-cache',
        connection: 'keep-alive',
        'access-control-allow-origin': '*',
      });
      res.write(`data: ${JSON.stringify(this.handlers.getSnapshot())}\n\n`);
      this.sseClients.add(res);
      req.on('close', () => {
        this.sseClients.delete(res);
      });
      return;
    }

    if (req.method === 'POST' && url.pathname === '/work-status') {
      try {
        const body = await this.readJsonBody(req);
        const rawState = body.state;
        let state: WorkStatusState | null = null;
        if (typeof rawState === 'string' && VALID_WORK_STATES.has(rawState)) {
          state = rawState as WorkStatusState;
        } else if (rawState !== null && rawState !== undefined && rawState !== 'idle') {
          this.sendJson(res, 400, {
            ok: false,
            error: 'Invalid state. Expected waiting|error|working|thinking|result|success|null',
          });
          return;
        }
        const task = typeof body.task === 'string' ? body.task : null;
        const source = typeof body.source === 'string' && body.source ? body.source : 'http';
        const ttlMs = typeof body.ttlMs === 'number' && body.ttlMs > 0 ? body.ttlMs : undefined;

        this.handlers.onWorkStatus({ state, task, source, ttlMs });
        this.sendJson(res, 200, { ok: true, workStatus: this.handlers.getSnapshot().workStatus });
      } catch (err) {
        this.sendJson(res, 400, { ok: false, error: err instanceof Error ? err.message : String(err) });
      }
      return;
    }

    if (req.method === 'POST' && url.pathname === '/action') {
      try {
        const body = await this.readJsonBody(req);
        const anim =
          typeof body.anim === 'string' && body.anim
            ? body.anim
            : typeof body.state === 'string' && body.state
              ? body.state
              : undefined;
        const lockMs =
          typeof body.lockMs === 'number' && Number.isFinite(body.lockMs)
            ? Math.max(0, Math.min(30_000, Math.round(body.lockMs)))
            : undefined;
        this.handlers.onAction({
          action: String(body.action || ''),
          petId: typeof body.petId === 'string' ? body.petId : undefined,
          anim,
          sleeping: typeof body.sleeping === 'boolean' ? body.sleeping : undefined,
          text: typeof body.text === 'string' ? body.text : undefined,
          force: typeof body.force === 'boolean' ? body.force : undefined,
          lockMs,
        });
        this.sendJson(res, 200, { ok: true });
      } catch (err) {
        this.sendJson(res, 400, { ok: false, error: err instanceof Error ? err.message : String(err) });
      }
      return;
    }

    if (req.method === 'POST' && url.pathname === '/config') {
      try {
        const body = await this.readJsonBody(req);
        this.handlers.onConfigPatch(body as ConfigPatchInput);
        this.sendJson(res, 200, { ok: true });
      } catch (err) {
        this.sendJson(res, 400, { ok: false, error: err instanceof Error ? err.message : String(err) });
      }
      return;
    }

    this.sendJson(res, 404, { ok: false, error: 'Not found' });
  }

  async stop(): Promise<void> {
    for (const res of this.sseClients) {
      try {
        res.end();
      } catch {
        /* ignore */
      }
    }
    this.sseClients.clear();

    try {
      rmSync(join(this.runtimeDir, 'server-info.json'), { force: true });
    } catch {
      /* ignore */
    }

    if (!this.server) return;
    const srv = this.server;
    this.server = null;
    this.port = 0;
    await new Promise<void>((resolveClose) => {
      srv.close(() => resolveClose());
    });
  }
}
