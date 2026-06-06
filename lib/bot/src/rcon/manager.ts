import WebSocket from "ws";

interface RconMessage {
  Identifier: number;
  Message: string;
  Type: string;
  Stacktrace?: string;
}

type LogListener = (log: string, serverId: number) => void;

class RconConnection {
  private ws: WebSocket | null = null;
  private msgId = 0;
  private pending = new Map<number, { resolve: (r: string) => void; reject: (e: Error) => void; timer: ReturnType<typeof setTimeout> }>();
  private logListeners: LogListener[] = [];
  private reconnectTimer: ReturnType<typeof setTimeout> | null = null;
  private reconnecting = false;
  public lastActivity = Date.now();

  constructor(
    private host: string,
    private port: number,
    private password: string,
    public serverId: number
  ) {}

  async connect(): Promise<void> {
    return new Promise((resolve, reject) => {
      const url = `ws://${this.host}:${this.port}/${this.password}`;
      this.ws = new WebSocket(url, { handshakeTimeout: 10000 });

      const onOpen = () => {
        this.reconnecting = false;
        console.log(`[RCON] Connected to server ${this.serverId}`);
        resolve();
      };

      const onError = (err: Error) => {
        console.error(`[RCON] Server ${this.serverId} error:`, err.message);
        reject(err);
      };

      this.ws.once("open", onOpen);
      this.ws.once("error", onError);

      this.ws.on("message", (data: WebSocket.RawData) => {
        this.lastActivity = Date.now();
        try {
          const msg: RconMessage = JSON.parse(data.toString());
          if (msg.Identifier <= 0) {
            for (const fn of this.logListeners) fn(msg.Message, this.serverId);
          } else {
            const p = this.pending.get(msg.Identifier);
            if (p) {
              clearTimeout(p.timer);
              p.resolve(msg.Message);
              this.pending.delete(msg.Identifier);
            }
          }
        } catch { /* non-JSON */ }
      });

      this.ws.on("close", () => {
        console.warn(`[RCON] Server ${this.serverId} disconnected — scheduling reconnect`);
        this.scheduleReconnect();
      });

      this.ws.on("error", (err: Error) => {
        if (!this.reconnecting) console.error(`[RCON] Server ${this.serverId}:`, err.message);
      });
    });
  }

  private scheduleReconnect(): void {
    if (this.reconnectTimer) return;
    this.reconnecting = true;
    this.reconnectTimer = setTimeout(async () => {
      this.reconnectTimer = null;
      try {
        await this.connect();
      } catch {
        this.scheduleReconnect();
      }
    }, 5000);
  }

  async send(command: string, timeout = 10000): Promise<string> {
    if (!this.ws || this.ws.readyState !== WebSocket.OPEN) {
      throw new Error(`Server ${this.serverId} RCON not connected`);
    }
    const id = ++this.msgId;
    this.lastActivity = Date.now();
    return new Promise((resolve, reject) => {
      const timer = setTimeout(() => {
        this.pending.delete(id);
        reject(new Error("RCON command timed out"));
      }, timeout);
      this.pending.set(id, { resolve, reject, timer });
      this.ws!.send(JSON.stringify({ Identifier: id, Message: command, Name: "WebRcon" }));
    });
  }

  onLog(fn: LogListener): void {
    this.logListeners.push(fn);
  }

  removeLogListener(fn: LogListener): void {
    this.logListeners = this.logListeners.filter(l => l !== fn);
  }

  isIdle(): boolean {
    return Date.now() - this.lastActivity > 5 * 60 * 1000;
  }

  isOpen(): boolean {
    return this.ws?.readyState === WebSocket.OPEN;
  }

  disconnect(): void {
    if (this.reconnectTimer) { clearTimeout(this.reconnectTimer); this.reconnectTimer = null; }
    this.ws?.terminate();
    this.ws = null;
  }
}

class RconManager {
  private connections = new Map<number, RconConnection>();
  private globalLogListeners: LogListener[] = [];
  private idleInterval: ReturnType<typeof setInterval>;

  constructor() {
    this.idleInterval = setInterval(() => this.dropIdleConnections(), 60_000);
  }

  private dropIdleConnections(): void {
    for (const [id, conn] of this.connections) {
      if (conn.isIdle()) {
        console.log(`[RCON] Dropping idle connection for server ${id}`);
        conn.disconnect();
        this.connections.delete(id);
      }
    }
  }

  async getConnection(serverId: number, host: string, port: number, password: string): Promise<RconConnection> {
    const existing = this.connections.get(serverId);
    if (existing && existing.isOpen()) {
      existing.lastActivity = Date.now();
      return existing;
    }
    const conn = new RconConnection(host, port, password, serverId);
    for (const fn of this.globalLogListeners) conn.onLog(fn);
    await conn.connect();
    this.connections.set(serverId, conn);
    return conn;
  }

  async sendCommand(serverId: number, host: string, port: number, password: string, command: string): Promise<string> {
    const conn = await this.getConnection(serverId, host, port, password);
    return conn.send(command);
  }

  onLog(fn: LogListener): void {
    this.globalLogListeners.push(fn);
    for (const conn of this.connections.values()) conn.onLog(fn);
  }

  dropConnection(serverId: number): void {
    const conn = this.connections.get(serverId);
    if (conn) { conn.disconnect(); this.connections.delete(serverId); }
  }

  getStatus(serverId: number): "connected" | "disconnected" {
    const conn = this.connections.get(serverId);
    return conn?.isOpen() ? "connected" : "disconnected";
  }

  getAllStatuses(): Record<number, string> {
    const result: Record<number, string> = {};
    for (const [id, conn] of this.connections) {
      result[id] = conn.isOpen() ? "connected" : "disconnected";
    }
    return result;
  }

  isConnected(serverId: number): boolean {
    return this.getStatus(serverId) === "connected";
  }

  async connect(serverId: number, host: string, port: number, password: string): Promise<void> {
    await this.getConnection(serverId, host, port, password);
  }

  disconnect(serverId: number): void {
    this.dropConnection(serverId);
  }
}

export const rconManager = new RconManager();
export type { RconConnection };
