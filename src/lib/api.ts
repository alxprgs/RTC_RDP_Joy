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

function safeJsonParse(text: string) {
  try {
    return text ? JSON.parse(text) : null;
  } catch {
    return null;
  }
}

function describeFetchError(e: any, fullUrl?: string): string {
  const name = String(e?.name ?? "");
  const message = String(e?.message ?? "");

  if (name === "AbortError" || /aborted/i.test(message)) {
    return "Таймаут: сервер не ответил вовремя (превышено время ожидания).";
  }

  if (/Network request failed/i.test(message)) {
    const hint =
      fullUrl && /localhost|127\.0\.0\.1/.test(fullUrl)
        ? " Подсказка: на телефоне/эмуляторе “localhost” — это сам телефон. Нужен IP твоего ПК в локалке."
        : "";
    return "Сеть/подключение: не удалось выполнить запрос (сервер недоступен, нет сети, неправильный адрес или порт)." + hint;
  }

  if (e instanceof TypeError) {
    return "Сетевая ошибка: проверь адрес, порт и доступность сервера (возможно, он не запущен или не в той сети).";
  }

  if (/SSL|CERT|certificate|TLS/i.test(message)) {
    return "TLS/SSL ошибка: проблемы с сертификатом или https. Попробуй http:// либо проверь сертификат.";
  }

  return message || "Неизвестная ошибка подключения.";
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
    const data = safeJsonParse(text);

    if (text && data === null) {
      const preview = text.slice(0, 120).replace(/\s+/g, " ").trim();
      throw new Error(
        `Сервер ответил не JSON. Возможно, это не тот эндпоинт или прокси/страница. Ответ: "${preview}${text.length > 120 ? "…" : ""}"`
      );
    }

    if (!res.ok) {
      const detail = data?.detail ?? data?.error ?? null;

      const statusHint =
        res.status === 404 ? " (эндпоинт не найден)" :
        res.status === 401 ? " (нужна авторизация)" :
        res.status === 403 ? " (доступ запрещён)" :
        res.status === 422 ? " (неверные параметры/тело запроса)" :
        res.status === 500 ? " (ошибка на сервере)" :
        "";

      const msg =
        (typeof detail === "string" && detail) ||
        (detail ? JSON.stringify(detail) : "") ||
        `HTTP ${res.status}${statusHint}`;

      throw new Error(msg);
    }

    return data;
  } catch (e: any) {
    throw new Error(describeFetchError(e, url));
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

export async function apiRunAction(
  baseUrl: string,
  body: { action: string; power: number; duration_ms: number }
) {
  return fetchJson(
    `${baseUrl}/actions/run`,
    { method: "POST", body: JSON.stringify(body) },
    2500
  );
}

export async function apiStop(baseUrl: string) {
  return fetchJson(`${baseUrl}/actions/stop`, { method: "POST" }, 2000);
}

export async function apiJoystick(baseUrl: string, body: { x: number; y: number; deadzone: number; scale: number }) {
  return fetchJson(
    `${baseUrl}/joystick`,
    { method: "POST", body: JSON.stringify(body) },
    2500
  );
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

export async function apiServoA(baseUrl: string, deg: number) {
  const v = Math.max(0, Math.min(180, Math.round(deg)));
  return fetchJson(`${baseUrl}/servo/a?deg=${v}`, { method: "POST" }, 2500);
}

export async function apiServoB(baseUrl: string, deg: number) {
  const v = Math.max(0, Math.min(180, Math.round(deg)));
  return fetchJson(`${baseUrl}/servo/b?deg=${v}`, { method: "POST" }, 2500);
}

export async function apiServoAll(baseUrl: string, deg: number) {
  const v = Math.max(0, Math.min(180, Math.round(deg)));
  return fetchJson(`${baseUrl}/servo/all?deg=${v}`, { method: "POST" }, 2500);
}

export async function apiServoCenter(baseUrl: string) {
  return fetchJson(`${baseUrl}/servo/center`, { method: "POST" }, 2500);
}

export async function apiTelemetry(baseUrl: string) {
  return fetchJson(
    `${baseUrl}/telemetry?disk=false&net=true&sensors=true&arduino=true`,
    { method: "GET" },
    2500
  );
}