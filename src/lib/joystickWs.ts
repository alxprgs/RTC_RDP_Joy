import { baseUrlToWsUrl } from "./api";

export type WsStatus = "disconnected" | "connecting" | "connected" | "reconnecting";

type JoyPayload = { x: number; y: number; deadzone: number; scale: number };

type Opts = {
  baseUrl: string;
  path?: string; // default "/ws/joystick"
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

  private onStatus?: (s: WsStatus) => void;
  private onErrorText?: (text: string) => void;

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
    this.clearReconnect();

    if (this.ws) {
      try {
        this.ws.onopen = null as any;
        this.ws.onmessage = null as any;
        this.ws.onerror = null as any;
        this.ws.onclose = null as any;
        this.ws.close();
      } catch {
        // ignore
      }
    }
    this.ws = null;
    this.setStatus("disconnected");
    this.attempt = 0;
  }

  sendJoystick(payload: JoyPayload): boolean {
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

  // --------------------

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
    const delay = Math.min(5000, 300 * Math.pow(2, pow)); // 300ms..~5s

    this.reconnectTimer = setTimeout(() => {
      this.open("reconnecting");
    }, delay);
  }

  private open(kind: "connecting" | "reconnecting") {
    if (!this.wantOpen) return;

    // позволяем "переподключиться", если ws умер
    if (this.ws && (this.ws.readyState === 0 || this.ws.readyState === 1)) {
      return;
    }

    const url = baseUrlToWsUrl(this.baseUrl, this.path);

    this.setStatus(kind);
    let w: WebSocket;
    try {
      w = new WebSocket(url);
    } catch (e: any) {
      this.onErrorText?.(e?.message ? String(e.message) : "WS create failed");
      this.setStatus("disconnected");
      this.scheduleReconnect();
      return;
    }

    this.ws = w;

    w.onopen = () => {
      this.attempt = 0;
      this.setStatus("connected");
    };

    w.onerror = () => {
      // в RN error не всегда информативен
      this.onErrorText?.("WS error");
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

      // app-level ping/pong от сервера
      if (msg.type === "ping") {
        try {
          w.send(JSON.stringify({ type: "pong", t: Date.now() }));
        } catch {
          // ignore
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
      this.setStatus("reconnecting");
      this.scheduleReconnect();
    };
  }
}
