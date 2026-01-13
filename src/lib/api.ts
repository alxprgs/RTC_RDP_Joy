import type { ServerAction } from "../types/buttons";

export function normalizeBaseUrl(input: string) {
  const raw = (input ?? "").trim();
  if (!raw) return "";

  const withScheme = raw.match(/^https?:\/\//i) ? raw : `http://${raw}`;

  let url: URL;
  try {
    url = new URL(withScheme);
  } catch {
    return "";
  }

  const hasPort = Boolean(url.port);
  const host = url.hostname;
  const port = hasPort ? url.port : "8000";
  const protocol = url.protocol.toLowerCase();

  const normalized = `${protocol}//${host}${port ? `:${port}` : ""}`;
  return normalized.replace(/\/+$/, "");
}

async function fetchJson(url: string, init?: RequestInit, timeoutMs = 1500) {
  const ctrl = new AbortController();
  const t = setTimeout(() => ctrl.abort(), timeoutMs);

  try {
    const res = await fetch(url, {
      ...init,
      headers: {
        "Content-Type": "application/json",
        ...(init?.headers ?? {}),
      },
      signal: ctrl.signal,
    });

    const text = await res.text();
    const data = text ? JSON.parse(text) : null;

    if (!res.ok) {
      const msg =
        (data && (data.detail || data.error)) ||
        `HTTP ${res.status}`;
      throw new Error(typeof msg === "string" ? msg : JSON.stringify(msg));
    }
    return data;
  } finally {
    clearTimeout(t);
  }
}

export async function apiHealth(baseUrl: string) {
  return fetchJson(`${baseUrl}/health`, { method: "GET" }, 1500);
}

export async function apiListActions(baseUrl: string): Promise<ServerAction[]> {
  const data = await fetchJson(`${baseUrl}/actions/list`, { method: "GET" }, 2500);
  const actions = (data?.actions ?? []) as ServerAction[];
  return actions;
}

export async function apiRunAction(baseUrl: string, body: { action: string; power: number; duration_ms: number }) {
  return fetchJson(`${baseUrl}/actions/run`, {
    method: "POST",
    body: JSON.stringify(body),
  }, 2500);
}

export async function apiStop(baseUrl: string) {
  return fetchJson(`${baseUrl}/actions/stop`, { method: "POST" }, 2000);
}

export async function apiJoystick(baseUrl: string, body: { x: number; y: number; deadzone: number; scale: number }) {
  return fetchJson(`${baseUrl}/joystick`, {
    method: "POST",
    body: JSON.stringify(body),
  }, 2500);
}

export function baseUrlToWsUrl(baseUrl: string, wsPath = "/ws/joystick") {
  const b = (baseUrl ?? "").trim().replace(/\/+$/, "");
  if (!b) return "";

  const wsBase = b.startsWith("https://")
    ? "wss://" + b.slice("https://".length)
    : b.startsWith("http://")
      ? "ws://" + b.slice("http://".length)
      : b;

  const p = wsPath.startsWith("/") ? wsPath : `/${wsPath}`;
  return `${wsBase}${p}`;
}