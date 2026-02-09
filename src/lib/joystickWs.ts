import { apiJoystick, baseUrlToWsUrl } from "./api";

export type WsStatus = "disconnected" | "connecting" | "connected" | "reconnecting" | "dev-mode-http";

type JoyPayload = { x: number; y: number; deadzone: number; scale: number };

type Opts = {
  baseUrl: string;
  path?: string;
  onStatus?: (s: WsStatus) => void;
  onErrorText?: (text: string) => void;
};

export class JoystickWsClient {
  private baseUrl: string;
  private path: string;
  private ws: WebSocket | null = null;

  private wantOpen = false;
  private status: WsStatus = "disconnected";
  private attempt = 0;
  private reconnectTimer: any = null;
  private devModeHttp = false;

  private onStatus?: (s: WsStatus) => void;
  private onErrorText?: (text: string) => void;

  private httpThrottle: any = null;

  constructor(opts: Opts) {
    this.baseUrl = opts.baseUrl;
    this.path = opts.path ?? "/ws/joystick";
    this.onStatus = opts.onStatus;
    this.onErrorText = opts.onErrorText;
  }

  getStatus() {
    return this.status;
  }

  connect() {
    this.wantOpen = true;
    this.open("connecting");
  }

  reconnectNow() {
    this.close();
    this.wantOpen = true;
    this.open("reconnecting");
  }

  close() {
    this.wantOpen = false;
    this.devModeHttp = false;
    this.clearReconnect();
    this.clearHttpThrottle();

    if (this.ws) {
      try {
        this.ws.onopen = null as any;
        this.ws.onmessage = null as any;
        this.ws.onerror = null as any;
        this.ws.onclose = null as any;
        this.ws.close();
      } catch {
      }
    }
    this.ws = null;
    this.setStatus("disconnected");
    this.attempt = 0;
  }

  sendJoystick(payload: JoyPayload): boolean {
    if (this.devModeHttp) {
      this.sendViaHttp(payload);
      return true;
    }

    const w = this.ws;
    if (!w || w.readyState !== 1) return false;

    try {
      w.send(JSON.stringify(payload));
      return true;
    } catch (e: any) {
      this.onErrorText?.(e?.message ? String(e.message) : "WS send error");
      return false;
    }
  }

  private sendViaHttp(payload: JoyPayload) {
    if (this.httpThrottle) return;

    this.httpThrottle = setTimeout(() => {
      this.httpThrottle = null;
    }, 50);

    apiJoystick(this.baseUrl, payload).catch((e) => {
    });
  }

  private clearHttpThrottle() {
    if (this.httpThrottle) {
      clearTimeout(this.httpThrottle);
      this.httpThrottle = null;
    }
  }

  private setStatus(s: WsStatus) {
    if (this.status === s) return;
    this.status = s;
    this.onStatus?.(s);
  }

  private clearReconnect() {
    if (this.reconnectTimer) {
      clearTimeout(this.reconnectTimer);
      this.reconnectTimer = null;
    }
  }

  private scheduleReconnect() {
    if (!this.wantOpen) return;
    this.clearReconnect();

    this.attempt += 1;
    const pow = Math.min(this.attempt, 6);
    const delay = Math.min(5000, 300 * Math.pow(2, pow));

    this.reconnectTimer = setTimeout(() => {
      this.open("reconnecting");
    }, delay);
  }

  private open(kind: "connecting" | "reconnecting") {
    if (!this.wantOpen) return;

    if (this.ws && (this.ws.readyState === 0 || this.ws.readyState === 1)) {
      return;
    }

    const url = baseUrlToWsUrl(this.baseUrl, this.path);

    this.setStatus(kind);
    let w: WebSocket;
    try {
      w = new WebSocket(url);
    } catch (e: any) {
      const errMsg = String(e?.message ?? "");
      if (this.attempt < 2) {
        this.onErrorText?.(`WS недоступен, используется HTTP режим: ${errMsg}`);
      }
      this.devModeHttp = true;
      this.setStatus("dev-mode-http");
      return;
    }

    this.ws = w;

    w.onopen = () => {
      this.attempt = 0;
      this.devModeHttp = false;
      this.setStatus("connected");
    };

    w.onerror = () => {
      if (this.attempt < 2) {
        this.onErrorText?.("WS error, переключение на HTTP режим");
      }
      // После нескольких неудачных попыток переключаемся на HTTP
      if (this.attempt >= 3) {
        this.devModeHttp = true;
        this.setStatus("dev-mode-http");
      }
    };

    w.onmessage = (ev) => {
      const txt = String((ev as any)?.data ?? "");
      let msg: any = null;

      try {
        msg = txt ? JSON.parse(txt) : null;
      } catch {
        return;
      }

      if (!msg || typeof msg !== "object") return;

      if (msg.type === "ping") {
        try {
          w.send(JSON.stringify({ type: "pong", t: Date.now() }));
        } catch {
        }
        return;
      }

      if (msg.type === "error") {
        const d = msg.detail;
        this.onErrorText?.(typeof d === "string" ? d : JSON.stringify(d));
        return;
      }
    };

    w.onclose = () => {
      this.ws = null;
      if (!this.wantOpen) {
        this.setStatus("disconnected");
        return;
      }
      if (this.attempt >= 3) {
        this.devModeHttp = true;
        this.setStatus("dev-mode-http");
        return;
      }
      this.setStatus("reconnecting");
      this.scheduleReconnect();
    };
  }
}