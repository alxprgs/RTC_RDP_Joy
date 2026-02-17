import React, { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { Animated, Easing, FlatList, View, ScrollView } from "react-native";
import Slider from "@react-native-community/slider";
import {
  Appbar,
  Button,
  Card,
  Dialog,
  Divider,
  FAB,
  IconButton,
  Portal,
  RadioButton,
  Snackbar,
  Text,
  TextInput,
  useTheme,
} from "react-native-paper";

import { useThemeMode } from "../app/themeContext";
import JoystickPad from "../components/JoystickPad";
import {
  apiJoystick,
  apiListActions,
  apiRunAction,
  apiStop,
  apiHealth,
  apiServo,
  apiServoCenter,
  apiTelemetry,
  baseUrlToWsUrl,
  apiServoBatch,
} from "../lib/api";
import { loadButtons, saveButtons } from "../lib/storage";
import type { CustomButton, ServerAction } from "../types/buttons";

import { JoystickWsClient, type WsStatus } from "../lib/joystickWs";
import { loadTransportMode, saveTransportMode, type TransportMode } from "../lib/prefs";

function uid() {
  return Math.random().toString(16).slice(2) + Date.now().toString(16);
}

function clamp(v: number, lo: number, hi: number) {
  return Math.max(lo, Math.min(hi, v));
}

type Props = {
  baseUrl: string;
  onChangeHost: () => void;
};

export default function ControlScreen({ baseUrl, onChangeHost }: Props) {
  const theme = useTheme();
  const { mode, toggle } = useThemeMode();

  const [serverActions, setServerActions] = useState<ServerAction[]>([]);
  const [buttons, setButtons] = useState<CustomButton[]>([]);
  const [loadingActions, setLoadingActions] = useState(false);

  const [deadzone, setDeadzone] = useState(20);

  const [scalePct, setScalePct] = useState(100);

  const scale = useMemo(() => clamp(scalePct, 1, 100) / 100, [scalePct]);

  const [snack, setSnack] = useState<{ open: boolean; text: string }>({ open: false, text: "" });
  const [healthText, setHealthText] = useState<string>("");

  const [transportMode, setTransportMode] = useState<TransportMode>("http");
  const [wsStatus, setWsStatus] = useState<WsStatus>("disconnected");
  const [wsErrText, setWsErrText] = useState<string>("");

  const wsRef = useRef<JoystickWsClient | null>(null);

  const [healthChecking, setHealthChecking] = useState(false);
  const heartScale = useRef(new Animated.Value(1)).current;
  const heartRot = useRef(new Animated.Value(0)).current;
  const heartShake = useRef(new Animated.Value(0)).current;

  const pulseLoopRef = useRef<Animated.CompositeAnimation | null>(null);

  const [servo1, setServo1] = useState(90);
  const [servo2, setServo2] = useState(90);
  const [servo3, setServo3] = useState(90);

  const [servo1Text, setServo1Text] = useState("90");
  const [servo2Text, setServo2Text] = useState("90");
  const [servo3Text, setServo3Text] = useState("90");
  
  const [telemetry, setTelemetry] = useState<any | null>(null);
  const [telemetryErr, setTelemetryErr] = useState<string>("");
  const [telemetryTs, setTelemetryTs] = useState<number>(0);

  const [telemetryTransport, setTelemetryTransport] = useState<"ws" | "http">("ws");
  const [telemetryWsStatus, setTelemetryWsStatus] = useState<WsStatus>("disconnected");

  const telemetryWsRef = useRef<WebSocket | null>(null);
  const telemetryPollRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const telemetryReconnectRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const telemetryFallbackTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  const telemetryShouldRunRef = useRef(false);
  const telemetryHasWsDataRef = useRef(false);
  const telemetryInFlightRef = useRef(false);

  const [telemetryOpen, setTelemetryOpen] = useState(false);

  const joyPendingRef = useRef({ x: 0, y: 0, active: false });
  const joyLastSentRef = useRef({ x: 0, y: 0, active: false });
  const joyInFlightRef = useRef(false);

  const [alertSnack, setAlertSnack] = useState<{ open: boolean; text: string }>({
    open: false,
    text: "",
  });
  const handleJoystickChange = useCallback((x: number, y: number, active: boolean) => {
    joyPendingRef.current = { x, y, active };
  }, []);

  const lastAlertRef = useRef({
    undervoltageNow: false,
    vccLow: false,
    hotCpu: false,
  });

  function fmtBytesAny(x: any) {
    const b = typeof x === "number" ? x : typeof x?.bytes === "number" ? x.bytes : null;
    if (b == null) return "—";

    const kb = 1024;
    const mb = kb * 1024;
    const gb = mb * 1024;

    if (b >= gb) return `${(b / gb).toFixed(1)} GB`;
    if (b >= mb) return `${(b / mb).toFixed(0)} MB`;
    if (b >= kb) return `${(b / kb).toFixed(0)} KB`;
    return `${b} B`;
  }

  function checkTelemetryAlerts(t: any) {
    if (!t) return;

    const uvNow = Boolean(t?.host?.rpi?.throttled_flags?.undervoltage_now);
    const vccMv = t?.arduino?.data?.vcc_mv;
    const vccLow = typeof vccMv === "number" && vccMv > 0 && vccMv < 4700;

    const cpuTemp = t?.host?.rpi?.cpu_temp_c;
    const hotCpu = typeof cpuTemp === "number" && cpuTemp >= 80;

    if (uvNow && !lastAlertRef.current.undervoltageNow) {
      setAlertSnack({ open: true, text: "⚠️ UNDERVOLTAGE NOW! Питание Raspberry просело." });
    }
    if (vccLow && !lastAlertRef.current.vccLow) {
      setAlertSnack({
        open: true,
        text: `⚠️ Arduino VCC низкое: ${(vccMv / 1000).toFixed(2)}V (норма ~5.0V)`,
      });
    }
    if (hotCpu && !lastAlertRef.current.hotCpu) {
      setAlertSnack({ open: true, text: `⚠️ Перегрев CPU: ${cpuTemp.toFixed(1)}°C` });
    }

    lastAlertRef.current = {
      undervoltageNow: uvNow,
      vccLow,
      hotCpu,
    };
  }

  function stopTelemetryHttpPolling() {
    if (telemetryPollRef.current) {
      clearInterval(telemetryPollRef.current);
      telemetryPollRef.current = null;
    }
  }

  function startTelemetryHttpPolling() {
    if (telemetryPollRef.current) return;

    setTelemetryTransport("http");

    refreshTelemetryHttp();

    telemetryPollRef.current = setInterval(() => {
      refreshTelemetryHttp();
    }, 2000);
  }

  async function refreshTelemetryHttp() {
    if (!baseUrl) return;
    if (telemetryInFlightRef.current) return;

    telemetryInFlightRef.current = true;
    try {
      const t = await apiTelemetry(baseUrl);
      setTelemetry(t);
      checkTelemetryAlerts(t);
      setTelemetryErr("");
      setTelemetryTs(Date.now());
    } catch (e: any) {
      setTelemetryErr(e?.message ? String(e.message) : "Telemetry error");
    } finally {
      telemetryInFlightRef.current = false;
    }
  }

  function closeTelemetryWs() {
    if (telemetryWsRef.current) {
      try {
        telemetryWsRef.current.close();
      } catch {}
      telemetryWsRef.current = null;
    }
  }

  function scheduleTelemetryWsReconnect(delayMs = 4000) {
    if (!telemetryShouldRunRef.current) return;

    if (telemetryReconnectRef.current) clearTimeout(telemetryReconnectRef.current);
    telemetryReconnectRef.current = setTimeout(() => {
      connectTelemetryWs();
    }, delayMs);
  }

  function connectTelemetryWs() {
    closeTelemetryWs();

    if (telemetryFallbackTimerRef.current) clearTimeout(telemetryFallbackTimerRef.current);
    telemetryHasWsDataRef.current = false;

    if (!baseUrl) {
      startTelemetryHttpPolling();
      return;
    }

    const wsUrl = baseUrlToWsUrl(baseUrl, "/ws/telemetry");
    if (!wsUrl) {
      startTelemetryHttpPolling();
      return;
    }

    setTelemetryTransport("ws");
    setTelemetryWsStatus("connecting");

    const ws = new WebSocket(wsUrl);
    telemetryWsRef.current = ws;

    telemetryFallbackTimerRef.current = setTimeout(() => {
      if (!telemetryHasWsDataRef.current) {
        startTelemetryHttpPolling();
      }
    }, 1500);

    ws.onopen = () => {
      setTelemetryWsStatus("connected");
      setTelemetryTransport("ws");
      stopTelemetryHttpPolling(); 
    };

    ws.onmessage = (ev) => {
      const text = String(ev?.data ?? "").trim();
      if (!text) return;

      try {
        const data = JSON.parse(text);
        telemetryHasWsDataRef.current = true;
        setTelemetry(data);
        setTelemetryErr("");
        setTelemetryTs(Date.now());

        setTelemetryTransport("ws");
        stopTelemetryHttpPolling();
      } catch {
      }
    };

    ws.onerror = () => {
      setTelemetryWsStatus("disconnected");
      startTelemetryHttpPolling();
      scheduleTelemetryWsReconnect(4000);
    };

    ws.onclose = () => {
      setTelemetryWsStatus("disconnected");
      startTelemetryHttpPolling();
      scheduleTelemetryWsReconnect(4000);
    };
  }

  function refreshTelemetryNow() {
    if (telemetryTransport === "ws") {
      connectTelemetryWs();
      return;
    }
    refreshTelemetryHttp();
  }

  useEffect(() => {
    telemetryShouldRunRef.current = true;
    connectTelemetryWs();

    return () => {
      telemetryShouldRunRef.current = false;

      stopTelemetryHttpPolling();

      if (telemetryReconnectRef.current) clearTimeout(telemetryReconnectRef.current);
      if (telemetryFallbackTimerRef.current) clearTimeout(telemetryFallbackTimerRef.current);

      closeTelemetryWs();
    };
  }, [baseUrl]);

  const servoInFlightRef = useRef(false);

  function digitsOnly(t: string) {
    return (t ?? "").replace(/[^\d]/g, "");
  }

  async function sendServo(servoId: number, deg: number) {
    if (!baseUrl) return;
    if (servoInFlightRef.current) return;

    const v = clamp(Math.round(deg), 0, 180);

    servoInFlightRef.current = true;
    try {
      await apiServo(baseUrl, servoId, v);
    } catch (e: any) {
      setSnack({ open: true, text: e?.message ? String(e.message) : "Servo error" });
    } finally {
      servoInFlightRef.current = false;
    }
  }

  // Замени функцию centerServos:
  async function centerServos() {
    try {
      setServo1(90);
      setServo2(90);
      setServo3(90);
      setServo1Text("90");
      setServo2Text("90");
      setServo3Text("90");
      await apiServoCenter(baseUrl);
    } catch (e: any) {
      setSnack({ open: true, text: e?.message ? String(e.message) : "Servo center error" });
    }
  }

  // Замени функции apply:
  function applyServo1FromText() {
    const cleaned = digitsOnly(servo1Text);
    const v = clamp(parseInt(cleaned || "0", 10) || 0, 0, 180);
    setServo1(v);
    setServo1Text(String(v));
    sendServo(1, v);
  }

  function applyServo2FromText() {
    const cleaned = digitsOnly(servo2Text);
    const v = clamp(parseInt(cleaned || "0", 10) || 0, 0, 180);
    setServo2(v);
    setServo2Text(String(v));
    sendServo(2, v);
  }

  function applyServo3FromText() {
    const cleaned = digitsOnly(servo3Text);
    const v = clamp(parseInt(cleaned || "0", 10) || 0, 0, 180);
    setServo3(v);
    setServo3Text(String(v));
    sendServo(3, v);
  }

  

  function startHeartLoop() {
    pulseLoopRef.current?.stop();

    heartScale.setValue(1);
    heartRot.setValue(0);

    const loop = Animated.loop(
      Animated.sequence([
        Animated.parallel([
          Animated.timing(heartScale, {
            toValue: 1.18,
            duration: 260,
            easing: Easing.out(Easing.cubic),
            useNativeDriver: true,
          }),
          Animated.timing(heartRot, {
            toValue: 6,
            duration: 260,
            easing: Easing.out(Easing.cubic),
            useNativeDriver: true,
          }),
        ]),
        Animated.parallel([
          Animated.timing(heartScale, {
            toValue: 1.0,
            duration: 260,
            easing: Easing.inOut(Easing.cubic),
            useNativeDriver: true,
          }),
          Animated.timing(heartRot, {
            toValue: -6,
            duration: 260,
            easing: Easing.inOut(Easing.cubic),
            useNativeDriver: true,
          }),
        ]),
        Animated.timing(heartRot, {
          toValue: 0,
          duration: 160,
          easing: Easing.out(Easing.cubic),
          useNativeDriver: true,
        }),
      ])
    );

    pulseLoopRef.current = loop;
    loop.start();
  }

  function stopHeartLoop() {
    pulseLoopRef.current?.stop();
    pulseLoopRef.current = null;

    Animated.parallel([
      Animated.spring(heartScale, { toValue: 1, useNativeDriver: true }),
      Animated.spring(heartRot, { toValue: 0, useNativeDriver: true }),
    ]).start();
  }

  function playOkTick() {
    Animated.sequence([
      Animated.timing(heartScale, { toValue: 1.22, duration: 120, useNativeDriver: true }),
      Animated.timing(heartScale, { toValue: 1.0, duration: 120, useNativeDriver: true }),
      Animated.timing(heartScale, { toValue: 1.18, duration: 110, useNativeDriver: true }),
      Animated.timing(heartScale, { toValue: 1.0, duration: 140, useNativeDriver: true }),
    ]).start();
  }

  function playErrorShake() {
    heartShake.setValue(0);
    Animated.sequence([
      Animated.timing(heartShake, { toValue: 5, duration: 60, useNativeDriver: true }),
      Animated.timing(heartShake, { toValue: -5, duration: 60, useNativeDriver: true }),
      Animated.timing(heartShake, { toValue: 4, duration: 55, useNativeDriver: true }),
      Animated.timing(heartShake, { toValue: -4, duration: 55, useNativeDriver: true }),
      Animated.timing(heartShake, { toValue: 0, duration: 80, useNativeDriver: true }),
    ]).start();
  }

  useEffect(() => {
    let alive = true;
    (async () => {
      const m = await loadTransportMode(baseUrl);
      if (alive) setTransportMode(m);
    })();
    return () => {
      alive = false;
    };
  }, [baseUrl]);

  useEffect(() => {
    if (!baseUrl) return;
    saveTransportMode(baseUrl, transportMode);
  }, [baseUrl, transportMode]);

  useEffect(() => {
    wsRef.current?.close();
    wsRef.current = null;
    setWsErrText("");
    setWsStatus("disconnected");

    if (!baseUrl || transportMode !== "ws") return;

    const client = new JoystickWsClient({
      baseUrl,
      path: "/ws/joystick",
      onStatus: (s) => setWsStatus(s),
      onErrorText: (t) => setWsErrText(t),
    });

    wsRef.current = client;
    client.connect();

    return () => {
      client.close();
      if (wsRef.current === client) wsRef.current = null;
    };
  }, [baseUrl, transportMode]);

  useEffect(() => {
    (async () => {
      try {
        setLoadingActions(true);
        const [acts, saved] = await Promise.all([apiListActions(baseUrl), loadButtons(baseUrl)]);
        setServerActions(acts);
        setButtons(saved);
      } catch (e: any) {
        setSnack({ open: true, text: e?.message ? String(e.message) : "Ошибка загрузки" });
      } finally {
        setLoadingActions(false);
      }
    })();
  }, [baseUrl]);

  async function refreshHealth() {
    if (!baseUrl) return;

    if (healthChecking) return;

    setHealthChecking(true);
    startHeartLoop();

    try {
      const r = await apiHealth(baseUrl);
      setHealthText(r?.ok ? `OK: ${String(r.arduino ?? "")}` : `Нет: ${String(r?.error ?? "")}`);

      stopHeartLoop();

      if (r?.ok) {
        playOkTick();
      } else {
        playErrorShake();
      }
    } catch (e: any) {
      setHealthText(e?.message ? String(e.message) : "health error");
      stopHeartLoop();
      playErrorShake();
    } finally {
      setHealthChecking(false);
    }
  }

  useEffect(() => {
    refreshHealth();
  }, [baseUrl]);

  async function persist(next: CustomButton[]) {
    setButtons(next);
    await saveButtons(baseUrl, next);
  }

  useEffect(() => {
    const tickMs = transportMode === "ws" ? 33 : 50;

    const id = setInterval(async () => {
      const p = joyPendingRef.current;
      const l = joyLastSentRef.current;

      const changed = p.x !== l.x || p.y !== l.y || p.active !== l.active;
      if (!changed) return;

      if (transportMode === "http") {
        if (joyInFlightRef.current) return;

        joyInFlightRef.current = true;
        try {
          await apiJoystick(baseUrl, { x: p.x, y: p.y, deadzone, scale });
          joyLastSentRef.current = { ...p };
        } catch (e: any) {
          setSnack({ open: true, text: e?.message ? String(e.message) : "Joystick error" });
        } finally {
          joyInFlightRef.current = false;
        }
        return;
      }

      const ws = wsRef.current;
      if (!ws) return;

      const ok = ws.sendJoystick({ x: p.x, y: p.y, deadzone, scale });
      if (ok) {
        joyLastSentRef.current = { ...p };
      }
    }, tickMs);

    return () => clearInterval(id);
  }, [baseUrl, deadzone, scale, transportMode]);

  async function runAction(action: string, power: number, durationMs: number) {
    try {
      await apiRunAction(baseUrl, {
        action,
        power: clamp(Math.round(power), 0, 255),
        duration_ms: clamp(Math.round(durationMs), 0, 10_000),
      });
    } catch (e: any) {
      setSnack({ open: true, text: e?.message ? String(e.message) : "Action error" });
      throw e;
    }
  }

  async function stop() {
    try {
      await apiStop(baseUrl);
    } catch (e: any) {
      setSnack({ open: true, text: e?.message ? String(e.message) : "Stop error" });
    }
  }

  const [editOpen, setEditOpen] = useState(false);
  const [editingId, setEditingId] = useState<string | null>(null);

  const editing = useMemo(
    () => (editingId ? buttons.find((b) => b.id === editingId) ?? null : null),
    [editingId, buttons]
  );

  const [fTitle, setFTitle] = useState("");
  const [fAction, setFAction] = useState("");
  const [fPower, setFPower] = useState("160");
  const [fDuration, setFDuration] = useState("0");
  const [fMode, setFMode] = useState<"tap" | "hold">("hold");

  useEffect(() => {
    if (!editOpen) return;
    if (editing) {
      setFTitle(editing.title);
      setFAction(editing.action);
      setFPower(String(editing.power));
      setFDuration(String(editing.durationMs));
      setFMode(editing.mode);
    } else {
      setFTitle("");
      setFAction(serverActions[0]?.name ?? "stop");
      setFPower("160");
      setFDuration("0");
      setFMode("hold");
    }
  }, [editOpen, editing, serverActions]);

  async function saveButton() {
    const title = fTitle.trim() || "Кнопка";
    const action = fAction;
    const power = clamp(parseInt(fPower || "0", 10) || 0, 0, 255);
    const durationMs = clamp(parseInt(fDuration || "0", 10) || 0, 0, 10_000);
    const mode = fMode;

    if (!action) {
      setSnack({ open: true, text: "Выбери action" });
      return;
    }

    const next: CustomButton[] = editing
      ? buttons.map((b) => (b.id === editing.id ? { ...b, title, action, power, durationMs, mode } : b))
      : [...buttons, { id: uid(), title, action, power, durationMs, mode }];

    await persist(next);
    setEditOpen(false);
    setEditingId(null);
  }

  async function deleteButton(id: string) {
    await persist(buttons.filter((b) => b.id !== id));
  }

  const actionsByName = useMemo(() => {
    const map = new Map<string, string>();
    for (const a of serverActions) map.set(a.name, a.title);
    return map;
  }, [serverActions]);

  const wsStatusLabel =
    wsStatus === "connected"
      ? "WS: connected"
      : wsStatus === "connecting"
        ? "WS: connecting…"
        : wsStatus === "reconnecting"
          ? "WS: reconnecting…"
          : "WS: disconnected";
  const heartRotate = heartRot.interpolate({
    inputRange: [-10, 10],
    outputRange: ["-10deg", "10deg"],
  });

  return (
    <View style={{ flex: 1, backgroundColor: theme.colors.background }}>
      <Appbar.Header>
        <Appbar.Content title="Motor Control" subtitle={baseUrl} />

        <Appbar.Action icon={mode === "dark" ? "weather-sunny" : "weather-night"} onPress={toggle} />
        <Animated.View
          style={{
            transform: [{ translateX: heartShake }, { scale: heartScale }, { rotate: heartRotate }],
          }}
        >
          <Appbar.Action
            icon="heart-pulse"
            onPress={refreshHealth}
            disabled={healthChecking}
            accessibilityLabel="Проверить связь"
          />
        </Animated.View>

        <Appbar.Action icon="swap-horizontal" onPress={onChangeHost} />
      </Appbar.Header>

      <FlatList
        contentContainerStyle={{ padding: 12, gap: 12, paddingBottom: 120 }}
        data={[{ key: "main" }]}
        renderItem={() => (
          <>
            <Card style={{ borderRadius: 18 }}>
              <Card.Content style={{ gap: 10 }}>
                <View style={{ flexDirection: "row", alignItems: "center", justifyContent: "space-between" }}>
                  <Text variant="titleMedium">Связь</Text>
                  <Text style={{ opacity: 0.7 }}>{healthText}</Text>
                </View>

                <Divider />
                <View style={{ gap: 8 }}>
                  <View style={{ flexDirection: "row", alignItems: "center", justifyContent: "space-between" }}>
                    <Text style={{ opacity: 0.8 }}>Транспорт джойстика</Text>
                    {transportMode === "ws" ? (
                      <View style={{ flexDirection: "row", alignItems: "center", gap: 6 }}>
                        <Text style={{ opacity: 0.7 }}>{wsStatusLabel}</Text>
                        <IconButton icon="wifi-refresh" size={18} onPress={() => wsRef.current?.reconnectNow()} />
                      </View>
                    ) : (
                      <Text style={{ opacity: 0.7 }}>HTTP: polling</Text>
                    )}
                  </View>

                  <RadioButton.Group value={transportMode} onValueChange={(v) => setTransportMode(v as TransportMode)}>
                    <View style={{ flexDirection: "row", alignItems: "center", gap: 14 }}>
                      <View style={{ flexDirection: "row", alignItems: "center" }}>
                        <RadioButton value="http" />
                        <Text>HTTP</Text>
                      </View>
                      <View style={{ flexDirection: "row", alignItems: "center" }}>
                        <RadioButton value="ws" />
                        <Text>WebSocket</Text>
                      </View>
                    </View>
                  </RadioButton.Group>

                  {transportMode === "ws" && wsErrText ? (
                    <Text style={{ opacity: 0.65, fontSize: 12 }}>WS error: {wsErrText}</Text>
                  ) : null}
                </View>

                <Divider />

                <View style={{ flexDirection: "row", gap: 10 }}>
                  <TextInput
                    label="Deadzone"
                    value={String(deadzone)}
                    onChangeText={(t) => setDeadzone(clamp(parseInt(t || "0", 10) || 0, 0, 80))}
                    keyboardType="number-pad"
                    style={{ flex: 1 }}
                  />
                  <TextInput
                    label="Мощность (1..100)"
                    value={String(scalePct)}
                    onChangeText={(t) => {
                      const cleaned = (t ?? "").replace(/[^\d]/g, "");
                      if (cleaned === "") {
                        setScalePct(100);
                        return;
                      }
                      const v = parseInt(cleaned, 10);
                      if (Number.isFinite(v)) setScalePct(clamp(v, 1, 100));
                    }}
                    keyboardType="number-pad"
                    style={{ flex: 1 }}
                  />
                </View>
              </Card.Content>
            </Card>

            <Card style={{ borderRadius: 18 }}>
              <Card.Content style={{ alignItems: "center", gap: 12 }}>
                <JoystickPad
                  deadzone={deadzone}
                  scale={scale}
                  showValues
                  onChange={handleJoystickChange}
                />
                <View style={{ flexDirection: "row", gap: 10, width: "100%" }}>
                  <Button mode="contained" onPress={stop} style={{ flex: 1 }}>
                    STOP
                  </Button>
                </View>
              </Card.Content>
            </Card>
            <Card style={{ borderRadius: 18 }}>
              <Card.Content style={{ gap: 12 }}>
                <View
                  style={{
                    flexDirection: "row",
                    alignItems: "center",
                    justifyContent: "space-between",
                    gap: 10,
                    flexWrap: "wrap",
                  }}
                >
                  <Text variant="titleMedium" style={{ flexShrink: 0 }}>
                    Сервоприводы (3 шт)
                  </Text>

                  <View
                    style={{
                      flexDirection: "row",
                      flexWrap: "wrap",
                      gap: 8,
                      justifyContent: "flex-start",
                      flex: 1,
                      minWidth: 180,
                    }}
                  >
                    <Button
                      mode="outlined"
                      compact
                      onPress={async () => {
                        const items = [
                          { id: 1, deg: servo1 },
                          { id: 2, deg: servo1 },
                          { id: 3, deg: servo1 },
                        ];
                        setServo2(servo1);
                        setServo3(servo1);
                        setServo2Text(String(servo1));
                        setServo3Text(String(servo1));
                        try {
                          await apiServoBatch(baseUrl, items);
                        } catch (e: any) {
                          setSnack({ open: true, text: e?.message ? String(e.message) : "Batch error" });
                        }
                      }}
                    >
                      Все = S1
                    </Button>

                    <Button mode="outlined" compact onPress={centerServos}>
                      Центр
                    </Button>
                  </View>
                </View>

                <Divider />

                {/* 3 сервы в ряд */}
                <View style={{ flexDirection: "row", gap: 12, flexWrap: "wrap" }}>
                  {/* SERVO 1 */}
                  <Card mode="outlined" style={{ flex: 1, minWidth: 140, borderRadius: 16 }}>
                    <Card.Content style={{ gap: 8 }}>
                      <View style={{ flexDirection: "row", alignItems: "center", justifyContent: "space-between" }}>
                        <Text variant="titleSmall">Servo 1</Text>
                        <Text style={{ opacity: 0.7 }}>{servo1}°</Text>
                      </View>

                      <Slider
                        style={{ width: "100%", height: 36 }}
                        minimumValue={0}
                        maximumValue={180}
                        step={1}
                        value={servo1}
                        onValueChange={(v) => {
                          const nv = Math.round(v);
                          setServo1(nv);
                          setServo1Text(String(nv));
                        }}
                        onSlidingComplete={(v) => sendServo(1, Math.round(v))}
                        minimumTrackTintColor={theme.colors.primary}
                        maximumTrackTintColor={theme.colors.outline}
                        thumbTintColor={theme.colors.primary}
                      />

                      <View style={{ flexDirection: "row", alignItems: "center", gap: 8 }}>
                        <TextInput
                          label="deg"
                          value={servo1Text}
                          onChangeText={(t) => setServo1Text(digitsOnly(t))}
                          keyboardType="number-pad"
                          style={{ flex: 1 }}
                          onBlur={applyServo1FromText}
                          onSubmitEditing={applyServo1FromText}
                        />
                        <IconButton icon="check" onPress={applyServo1FromText} />
                      </View>
                    </Card.Content>
                  </Card>

                  {/* SERVO 2 */}
                  <Card mode="outlined" style={{ flex: 1, minWidth: 140, borderRadius: 16 }}>
                    <Card.Content style={{ gap: 8 }}>
                      <View style={{ flexDirection: "row", alignItems: "center", justifyContent: "space-between" }}>
                        <Text variant="titleSmall">Servo 2</Text>
                        <Text style={{ opacity: 0.7 }}>{servo2}°</Text>
                      </View>

                      <Slider
                        style={{ width: "100%", height: 36 }}
                        minimumValue={0}
                        maximumValue={180}
                        step={1}
                        value={servo2}
                        onValueChange={(v) => {
                          const nv = Math.round(v);
                          setServo2(nv);
                          setServo2Text(String(nv));
                        }}
                        onSlidingComplete={(v) => sendServo(2, Math.round(v))}
                        minimumTrackTintColor={theme.colors.primary}
                        maximumTrackTintColor={theme.colors.outline}
                        thumbTintColor={theme.colors.primary}
                      />

                      <View style={{ flexDirection: "row", alignItems: "center", gap: 8 }}>
                        <TextInput
                          label="deg"
                          value={servo2Text}
                          onChangeText={(t) => setServo2Text(digitsOnly(t))}
                          keyboardType="number-pad"
                          style={{ flex: 1 }}
                          onBlur={applyServo2FromText}
                          onSubmitEditing={applyServo2FromText}
                        />
                        <IconButton icon="check" onPress={applyServo2FromText} />
                      </View>
                    </Card.Content>
                  </Card>

                  {/* SERVO 3 */}
                  <Card mode="outlined" style={{ flex: 1, minWidth: 140, borderRadius: 16 }}>
                    <Card.Content style={{ gap: 8 }}>
                      <View style={{ flexDirection: "row", alignItems: "center", justifyContent: "space-between" }}>
                        <Text variant="titleSmall">Servo 3</Text>
                        <Text style={{ opacity: 0.7 }}>{servo3}°</Text>
                      </View>

                      <Slider
                        style={{ width: "100%", height: 36 }}
                        minimumValue={0}
                        maximumValue={180}
                        step={1}
                        value={servo3}
                        onValueChange={(v) => {
                          const nv = Math.round(v);
                          setServo3(nv);
                          setServo3Text(String(nv));
                        }}
                        onSlidingComplete={(v) => sendServo(3, Math.round(v))}
                        minimumTrackTintColor={theme.colors.primary}
                        maximumTrackTintColor={theme.colors.outline}
                        thumbTintColor={theme.colors.primary}
                      />

                      <View style={{ flexDirection: "row", alignItems: "center", gap: 8 }}>
                        <TextInput
                          label="deg"
                          value={servo3Text}
                          onChangeText={(t) => setServo3Text(digitsOnly(t))}
                          keyboardType="number-pad"
                          style={{ flex: 1 }}
                          onBlur={applyServo3FromText}
                          onSubmitEditing={applyServo3FromText}
                        />
                        <IconButton icon="check" onPress={applyServo3FromText} />
                      </View>
                    </Card.Content>
                  </Card>
                </View>
              </Card.Content>
            </Card>
            <Card style={{ borderRadius: 18 }}>
              <Card.Content style={{ gap: 10 }}>
                <View style={{ flexDirection: "row", alignItems: "center", justifyContent: "space-between" }}>
                  <Text variant="titleMedium">Мои кнопки</Text>
                  <Text style={{ opacity: 0.7 }}>{loadingActions ? "loading..." : `${buttons.length} шт.`}</Text>
                </View>
                <Divider />

                {buttons.length === 0 ? (
                  <Text style={{ opacity: 0.7 }}>
                    Нажми “+” и добавь кнопку. Список actions берётся с сервера (/actions/list).
                  </Text>
                ) : null}

                <View style={{ flexDirection: "row", flexWrap: "wrap", gap: 10 }}>
                  {buttons.map((b) => (
                    <Card key={b.id} style={{ width: "48%", borderRadius: 16 }} mode="outlined">
                      <Card.Content style={{ gap: 8 }}>
                        <View style={{ flexDirection: "row", alignItems: "center", justifyContent: "space-between" }}>
                          <Text numberOfLines={1} style={{ flex: 1, marginRight: 6 }}>
                            {b.title}
                          </Text>
                          <IconButton
                            icon="pencil"
                            size={18}
                            onPress={() => {
                              setEditingId(b.id);
                              setEditOpen(true);
                            }}
                          />
                          <IconButton icon="delete" size={18} onPress={() => deleteButton(b.id)} />
                        </View>

                        <Text style={{ opacity: 0.7, fontSize: 12 }}>
                          {actionsByName.get(b.action) ?? b.action} • power {b.power}
                          {b.mode === "tap" ? ` • ${b.durationMs}ms` : " • hold"}
                        </Text>

                        <Button
                          mode="contained"
                          onPress={async () => {
                            if (b.mode === "tap") {
                              await runAction(b.action, b.power, b.durationMs);
                            } else {
                              await runAction(b.action, b.power, 0);
                            }
                          }}
                          onPressIn={async () => {
                            if (b.mode === "hold") await runAction(b.action, b.power, 0);
                          }}
                          onPressOut={async () => {
                            if (b.mode === "hold") await stop();
                          }}
                        >
                          {b.mode === "hold" ? "ДЕРЖАТЬ" : "НАЖАТЬ"}
                        </Button>
                      </Card.Content>
                    </Card>
                  ))}
                </View>
              </Card.Content>
            </Card>

            <Card style={{ borderRadius: 18 }}>
              <Card.Content style={{ gap: 10 }}>
                <Text variant="titleMedium">Все действия с сервера</Text>
                <Divider />
                <Text style={{ opacity: 0.7 }}>Это просто справочник. Добавлять в “Мои кнопки” можно через “+”.</Text>
                <View style={{ flexDirection: "row", flexWrap: "wrap", gap: 8 }}>
                  {serverActions.map((a) => (
                    <Button
                      key={a.name}
                      mode="outlined"
                      onPress={() => {
                        setEditingId(null);
                        setFTitle(a.title);
                        setFAction(a.name);
                        setEditOpen(true);
                      }}
                    >
                      {a.title}
                    </Button>
                  ))}
                </View>
              </Card.Content>
            </Card>
            <Card style={{ borderRadius: 18 }} onPress={() => setTelemetryOpen(true)}>
              <Card.Content style={{ gap: 8 }}>
                <View style={{ flexDirection: "row", alignItems: "center", justifyContent: "space-between" }}>
                  <Text variant="titleMedium">Телеметрия</Text>

                  <View style={{ flexDirection: "row", alignItems: "center", gap: 8 }}>
                    <Text style={{ opacity: 0.6, fontSize: 12 }}>
                      {telemetryTransport.toUpperCase()}
                      {telemetryTransport === "ws" ? (telemetryWsStatus === "connected" ? "" : ` (${telemetryWsStatus})`) : ""}
                    </Text>

                    <Text style={{ opacity: 0.6, fontSize: 12 }}>
                      {telemetryTs ? `${Math.max(0, Math.round((Date.now() - telemetryTs) / 1000))}с назад` : "—"}
                    </Text>

                    <IconButton icon="refresh" size={18} onPress={refreshTelemetryNow} />
                  </View>
                </View>

                <Divider />

                {telemetryErr ? (
                  <Text style={{ color: theme.colors.error, fontSize: 12 }}>
                    Нет телеметрии: {telemetryErr}
                  </Text>
                ) : (
                  <>
                    {(() => {
                      const host = telemetry?.host;
                      const ardOk = telemetry?.arduino?.ok;
                      const ard = telemetry?.arduino?.data;

                      const hostCpu = host?.cpu?.percent_total;
                      const hostRam = host?.memory?.ram?.percent;

                      const isRpi = Boolean(host?.platform?.is_raspberry_pi);
                      const cpuTemp = host?.rpi?.cpu_temp_c ?? null;

                      const uvNow = host?.rpi?.throttled_flags?.undervoltage_now;
                      const uvWas = host?.rpi?.throttled_flags?.undervoltage_occurred;

                      const hostname = host?.platform?.hostname ?? "host";
                      const osName = host?.platform?.system ?? "";
                      const osRel = host?.platform?.release ?? "";

                      const upSec = host?.uptime?.seconds;
                      const upStr =
                        typeof upSec === "number"
                          ? (() => {
                              const s = Math.max(0, upSec);
                              const h = Math.floor(s / 3600);
                              const m = Math.floor((s % 3600) / 60);
                              if (h > 0) return `${h}h${m}m`;
                              return `${m}m`;
                            })()
                          : null;

                      let ip: string | null = null;
                      const ipsObj = host?.network?.ips;
                      if (ipsObj && typeof ipsObj === "object") {
                        const entries = Object.entries(ipsObj) as [string, any][];
                        outer: for (const [, list] of entries) {
                          if (!Array.isArray(list)) continue;
                          for (const addr of list) {
                            if (typeof addr === "string" && addr.includes(".") && !addr.startsWith("127.")) {
                              ip = addr;
                              break outer;
                            }
                          }
                        }
                      }

                      const vccMv = typeof ard?.vcc_mv === "number" ? ard.vcc_mv : null;
                      const vccV = vccMv != null ? (vccMv / 1000).toFixed(2) : null;

                      const aRam = typeof ard?.free_ram === "number" ? ard.free_ram : null;
                      const aUp = typeof ard?.uptime_ms === "number" ? Math.round(ard.uptime_ms / 1000) : null;

                      const servoPwr = telemetry?.servo_pwr ?? ard?.servo_pwr ?? "—";
                      const mA = typeof ard?.motorA_cmd === "number" ? ard.motorA_cmd : null;
                      const mB = typeof ard?.motorB_cmd === "number" ? ard.motorB_cmd : null;

                      const warnParts: string[] = [];
                      if (isRpi && uvNow) warnParts.push("⚠️ UNDERVOLTAGE NOW");
                      else if (isRpi && uvWas) warnParts.push("⚠️ undervoltage было ранее");
                      if (typeof cpuTemp === "number" && cpuTemp >= 80) warnParts.push("⚠️ HOT CPU");

                      const hostLine1: string[] = [];
                      if (typeof hostCpu === "number") hostLine1.push(`CPU ${Math.round(hostCpu)}%`);
                      if (typeof hostRam === "number") hostLine1.push(`RAM ${Math.round(hostRam)}%`);
                      if (isRpi && typeof cpuTemp === "number") hostLine1.push(`T ${cpuTemp.toFixed(1)}°C`);

                      const hostLine2: string[] = [];
                      hostLine2.push(`${hostname}`);
                      if (osName) hostLine2.push(`${osName}${osRel ? ` ${osRel}` : ""}`);
                      if (ip) hostLine2.push(ip);
                      if (upStr) hostLine2.push(`UP ${upStr}`);

                      const ardLine1: string[] = [];
                      if (vccV != null) ardLine1.push(`VCC ${vccV}V`);
                      if (typeof aRam === "number") ardLine1.push(`RAM ${aRam}B`);

                      const ardLine2: string[] = [];
                      if (typeof aUp === "number") ardLine2.push(`UP ${aUp}s`);
                      if (servoPwr) ardLine2.push(`Servo ${String(servoPwr)}`);
                      if (mA != null && mB != null) ardLine2.push(`M ${mA}/${mB}`);

                      return (
                        <>
                          {warnParts.length ? (
                            <Text style={{ color: theme.colors.error, fontSize: 12 }}>
                              {warnParts.join(" • ")}
                            </Text>
                          ) : null}

                          <View style={{ flexDirection: "row", gap: 12 }}>
                            <View style={{ flex: 1 }}>
                              <Text style={{ opacity: 0.6, fontSize: 12 }}>HOST</Text>
                              <Text numberOfLines={3} style={{ opacity: 0.9, fontSize: 13 }}>
                                {hostLine1.length ? hostLine1.join(" • ") : "—"}
                              </Text>
                              <Text numberOfLines={3} style={{ opacity: 0.65, fontSize: 12 }}>
                                {hostLine2.length ? hostLine2.join(" • ") : "—"}
                              </Text>
                            </View>

                            <View style={{ flex: 1 }}>
                              <Text style={{ opacity: 0.6, fontSize: 12 }}>ARDUINO</Text>
                              {ardOk ? (
                                <>
                                  <Text numberOfLines={3} style={{ opacity: 0.9, fontSize: 13 }}>
                                    {ardLine1.length ? ardLine1.join(" • ") : "—"}
                                  </Text>
                                  <Text numberOfLines={3} style={{ opacity: 0.65, fontSize: 12 }}>
                                    {ardLine2.length ? ardLine2.join(" • ") : "—"}
                                  </Text>
                                </>
                              ) : (
                                <Text style={{ opacity: 0.75, fontSize: 12 }}>нет связи</Text>
                              )}
                            </View>
                          </View>
                        </>
                      );
                    })()}
                  </>
                )}
              </Card.Content>
            </Card>
          </>
        )}
        keyExtractor={(x) => x.key}
      />

      <FAB
        icon="plus"
        style={{ position: "absolute", right: 16, bottom: 16 }}
        onPress={() => {
          setEditingId(null);
          setEditOpen(true);
        }}
      />

      <Portal>
        <Dialog visible={editOpen} onDismiss={() => setEditOpen(false)}>
          <Dialog.Title>{editing ? "Редактировать кнопку" : "Добавить кнопку"}</Dialog.Title>
          <Dialog.Content style={{ gap: 10 }}>
            <TextInput label="Название" value={fTitle} onChangeText={setFTitle} />
            <Text variant="bodyMedium" style={{ opacity: 0.7 }}>
              Action (с сервера)
            </Text>

            <RadioButton.Group value={fAction} onValueChange={(v) => setFAction(v)}>
              {serverActions.map((a) => (
                <View
                  key={a.name}
                  style={{ flexDirection: "row", alignItems: "center", justifyContent: "space-between" }}
                >
                  <View style={{ flexDirection: "row", alignItems: "center", flex: 1 }}>
                    <RadioButton value={a.name} />
                    <Text>{a.title}</Text>
                  </View>
                  <Text style={{ opacity: 0.5, fontSize: 12 }}>{a.name}</Text>
                </View>
              ))}
            </RadioButton.Group>

            <View style={{ flexDirection: "row", gap: 10 }}>
              <TextInput
                label="Power (0..255)"
                value={fPower}
                onChangeText={setFPower}
                keyboardType="number-pad"
                style={{ flex: 1 }}
              />
              <TextInput
                label="Duration ms (tap)"
                value={fDuration}
                onChangeText={setFDuration}
                keyboardType="number-pad"
                style={{ flex: 1 }}
                disabled={fMode === "hold"}
              />
            </View>

            <View style={{ flexDirection: "row", alignItems: "center", gap: 10 }}>
              <Text style={{ opacity: 0.7 }}>Режим:</Text>
              <Button mode={fMode === "hold" ? "contained" : "outlined"} onPress={() => setFMode("hold")}>
                Hold
              </Button>
              <Button mode={fMode === "tap" ? "contained" : "outlined"} onPress={() => setFMode("tap")}>
                Tap
              </Button>
            </View>

            <Text style={{ opacity: 0.6, fontSize: 12 }}>
              Hold: запускаем action при нажатии и шлём STOP при отпускании. Tap: один запуск с duration.
            </Text>
          </Dialog.Content>
          <Dialog.Actions>
            <Button onPress={() => setEditOpen(false)}>Отмена</Button>
            <Button mode="contained" onPress={saveButton}>
              Сохранить
            </Button>
          </Dialog.Actions>
        </Dialog>
                <Dialog visible={telemetryOpen} onDismiss={() => setTelemetryOpen(false)}>
          <Dialog.Title>Полная телеметрия</Dialog.Title>

          <Dialog.Content>
            <ScrollView style={{ maxHeight: 420 }}>
              {(() => {
                const t = telemetry;
                const host = t?.host;
                const ardOk = t?.arduino?.ok;
                const ard = t?.arduino?.data;

                const cpu = host?.cpu;
                const mem = host?.memory;
                const rpi = host?.rpi;
                const plat = host?.platform;

                return (
                  <View style={{ gap: 10 }}>
                    <Text variant="titleSmall">HOST</Text>
                    <Text style={{ opacity: 0.8, fontSize: 12 }}>
                      {plat?.hostname ?? "—"} • {plat?.system ?? "—"} {plat?.release ?? ""}
                    </Text>

                    <Text style={{ opacity: 0.75, fontSize: 12 }}>
                      Uptime: {typeof host?.uptime?.seconds === "number" ? `${Math.round(host.uptime.seconds / 60)}m` : "—"}
                      {"  "}• CPU: {typeof cpu?.percent_total === "number" ? `${Math.round(cpu.percent_total)}%` : "—"}
                      {"  "}• RAM: {mem?.ram?.percent != null ? `${Math.round(mem.ram.percent)}% (${fmtBytesAny(mem?.ram?.used)} / ${fmtBytesAny(mem?.ram?.total)})` : "—"}
                    </Text>

                    {plat?.is_raspberry_pi ? (
                      <Text style={{ opacity: 0.75, fontSize: 12 }}>
                        RPI: temp {typeof rpi?.cpu_temp_c === "number" ? `${rpi.cpu_temp_c.toFixed(1)}°C` : "—"}
                        {"  "}• undervoltage_now: {String(Boolean(rpi?.throttled_flags?.undervoltage_now))}
                        {"  "}• throttling_now: {String(Boolean(rpi?.throttled_flags?.throttling_now))}
                      </Text>
                    ) : null}

                    <Divider />

                    <Text variant="titleSmall">ARDUINO</Text>

                    {!ardOk ? (
                      <Text style={{ opacity: 0.75, fontSize: 12 }}>Нет связи с Arduino</Text>
                    ) : (
                      <>
                        <Text style={{ opacity: 0.85, fontSize: 12 }}>
                          VCC: {typeof ard?.vcc_mv === "number" ? `${(ard.vcc_mv / 1000).toFixed(2)}V` : "—"}
                          {"  "}• Free RAM: {typeof ard?.free_ram === "number" ? `${ard.free_ram} B` : "—"}
                          {"  "}• Uptime: {typeof ard?.uptime_ms === "number" ? `${Math.round(ard.uptime_ms / 1000)}s` : "—"}
                        </Text>

                        <Text style={{ opacity: 0.75, fontSize: 12 }}>
                          ServoPwr: {String(t?.servo_pwr ?? ard?.servo_pwr ?? "—")}
                          {"  "}• ServoA: {ard?.servoA_deg ?? "—"}°
                          {"  "}• ServoB: {ard?.servoB_deg ?? "—"}°
                        </Text>

                        <Text style={{ opacity: 0.75, fontSize: 12 }}>
                          Motors: {ard?.motorA_cmd ?? "—"} / {ard?.motorB_cmd ?? "—"}
                          {"  "}• Reset raw: {ard?.reset?.raw ?? "—"}
                        </Text>
                      </>
                    )}

                    <Divider />

                    <Text variant="titleSmall">Расшифровка</Text>
                    <Text selectable style={{ fontSize: 11, opacity: 0.7 }}>
                      {(() => {
                        const t = telemetry;
                        const host = t?.host;
                        const ardOk = t?.arduino?.ok;
                        const ard = t?.arduino?.data;

                        const plat = host?.platform;
                        const upSec = host?.uptime?.seconds;

                        const cpu = host?.cpu;
                        const mem = host?.memory;
                        const net = host?.network;

                        const isRpi = Boolean(plat?.is_raspberry_pi);
                        const rpi = host?.rpi;

                        function fmtUptime(sec?: number) {
                          if (typeof sec !== "number") return "—";
                          const s = Math.max(0, sec);
                          const d = Math.floor(s / 86400);
                          const h = Math.floor((s % 86400) / 3600);
                          const m = Math.floor((s % 3600) / 60);
                          if (d > 0) return `${d}d ${h}h ${m}m`;
                          if (h > 0) return `${h}h ${m}m`;
                          return `${m}m`;
                        }

                        function fmtBytesAny(x: any) {
                          const b = typeof x === "number" ? x : typeof x?.bytes === "number" ? x.bytes : null;
                          if (b == null) return "—";

                          const kb = 1024;
                          const mb = kb * 1024;
                          const gb = mb * 1024;

                          if (b >= gb) return `${(b / gb).toFixed(2)} GB`;
                          if (b >= mb) return `${(b / mb).toFixed(0)} MB`;
                          if (b >= kb) return `${(b / kb).toFixed(0)} KB`;
                          return `${b} B`;
                        }

                        const hostTitle = [
                          plat?.hostname ? `Имя: ${plat.hostname}` : null,
                          plat?.system ? `OS: ${plat.system} ${plat.release ?? ""}`.trim() : null,
                          plat?.version ? `Build: ${plat.version}` : null,
                          plat?.architecture ? `Arch: ${plat.architecture}` : null,
                          plat?.machine ? `Machine: ${plat.machine}` : null,
                          plat?.python ? `Python: ${plat.python}` : null,
                        ].filter(Boolean);

                        const cpuLine = [
                          cpu?.physical_cores != null ? `Cores: ${cpu.physical_cores}P/${cpu.logical_cores ?? "?"}T` : null,
                          typeof cpu?.percent_total === "number" ? `CPU: ${Math.round(cpu.percent_total)}%` : null,
                          cpu?.freq_mhz?.current != null ? `Freq: ${Math.round(cpu.freq_mhz.current)} MHz` : null,
                        ].filter(Boolean);

                        const perCore =
                          Array.isArray(cpu?.percent_per_core) && cpu.percent_per_core.length
                            ? `Per-core: ${cpu.percent_per_core.map((x: number) => `${Math.round(x)}%`).join("  ")}`
                            : null;

                        const ramLine = mem?.ram
                          ? `RAM: ${Math.round(mem.ram.percent ?? 0)}%  (${fmtBytesAny(mem.ram.used)} / ${fmtBytesAny(mem.ram.total)})`
                          : "RAM: —";

                        const swapLine = mem?.swap
                          ? `SWAP: ${Math.round(mem.swap.percent ?? 0)}%  (${fmtBytesAny(mem.swap.used)} / ${fmtBytesAny(mem.swap.total)})`
                          : "SWAP: —";

                        const netIoLine = net?.io
                          ? `NET IO: ↑ ${fmtBytesAny(net.io.bytes_sent)}   ↓ ${fmtBytesAny(net.io.bytes_recv)}`
                          : "NET IO: —";

                        const ipsObj = net?.ips && typeof net.ips === "object" ? (net.ips as any) : null;

                        const vccMv = typeof ard?.vcc_mv === "number" ? ard.vcc_mv : null;
                        const vccStr = vccMv != null ? `${(vccMv / 1000).toFixed(2)} V` : "—";
                        const aUptime = typeof ard?.uptime_ms === "number" ? `${Math.round(ard.uptime_ms / 1000)} s` : "—";
                        const aRam = typeof ard?.free_ram === "number" ? `${ard.free_ram} B` : "—";

                        const reset = ard?.reset;
                        const resetFlags =
                          reset
                            ? [
                                reset.por ? "POR" : null,
                                reset.ext ? "EXT" : null,
                                reset.bor ? "BOR" : null,
                                reset.wdt ? "WDT" : null,
                              ].filter(Boolean).join(", ") || "none"
                            : "—";

                        return (
                          <View style={{ gap: 10 }}>
                            {/* HOST */}
                            <Text variant="titleSmall">HOST</Text>

                            {host?.ts_utc ? (
                              <Text style={{ fontSize: 12, opacity: 0.75 }}>TS (UTC): {String(host.ts_utc)}</Text>
                            ) : null}

                            {hostTitle.map((line, i) => (
                              <Text key={i} style={{ fontSize: 12, opacity: 0.85 }}>
                                {line}
                              </Text>
                            ))}

                            <Text style={{ fontSize: 12, opacity: 0.85 }}>
                              Uptime: {fmtUptime(upSec)} ({typeof upSec === "number" ? `${upSec}s` : "—"})
                            </Text>

                            <Divider />

                            {/* CPU */}
                            <Text variant="titleSmall">CPU</Text>
                            <Text style={{ fontSize: 12, opacity: 0.85 }}>{cpuLine.length ? cpuLine.join(" • ") : "—"}</Text>
                            {perCore ? <Text style={{ fontSize: 12, opacity: 0.75 }}>{perCore}</Text> : null}

                            <Divider />

                            {/* MEMORY */}
                            <Text variant="titleSmall">Память</Text>
                            <Text style={{ fontSize: 12, opacity: 0.85 }}>{ramLine}</Text>
                            <Text style={{ fontSize: 12, opacity: 0.75 }}>{swapLine}</Text>

                            <Divider />

                            {/* NETWORK */}
                            <Text variant="titleSmall">Сеть</Text>
                            <Text style={{ fontSize: 12, opacity: 0.85 }}>{netIoLine}</Text>

                            {ipsObj ? (
                              <View style={{ gap: 4, marginTop: 4 }}>
                                {Object.entries(ipsObj).map(([iface, addrs]: any) => (
                                  <Text key={iface} style={{ fontSize: 12, opacity: 0.75 }}>
                                    • {iface}: {Array.isArray(addrs) ? addrs.join(", ") : "—"}
                                  </Text>
                                ))}
                              </View>
                            ) : (
                              <Text style={{ fontSize: 12, opacity: 0.75 }}>IP: —</Text>
                            )}

                            <Divider />

                            {/* RPI EXTRAS */}
                            {isRpi ? (
                              <>
                                <Text variant="titleSmall">Raspberry Pi</Text>
                                <Text style={{ fontSize: 12, opacity: 0.85 }}>
                                  CPU temp: {typeof rpi?.cpu_temp_c === "number" ? `${rpi.cpu_temp_c.toFixed(1)}°C` : "—"}
                                </Text>
                                <Text style={{ fontSize: 12, opacity: 0.75 }}>
                                  Undervoltage now: {String(Boolean(rpi?.throttled_flags?.undervoltage_now))} •
                                  Throttling now: {String(Boolean(rpi?.throttled_flags?.throttling_now))}
                                </Text>
                                <Divider />
                              </>
                            ) : null}

                            {/* ARDUINO */}
                            <Text variant="titleSmall">ARDUINO</Text>

                            {!ardOk ? (
                              <Text style={{ fontSize: 12, opacity: 0.75 }}>Нет связи с Arduino</Text>
                            ) : (
                              <>
                                <Text style={{ fontSize: 12, opacity: 0.85 }}>
                                  VCC: {vccStr} • Free RAM: {aRam} • Uptime: {aUptime}
                                </Text>

                                <Text style={{ fontSize: 12, opacity: 0.75 }}>
                                  ServoPwr: {String(t?.servo_pwr ?? ard?.servo_pwr ?? "—")} •
                                  ServoA: {ard?.servoA_deg ?? "—"}° • ServoB: {ard?.servoB_deg ?? "—"}°
                                </Text>

                                <Text style={{ fontSize: 12, opacity: 0.75 }}>
                                  Motors: {ard?.motorA_cmd ?? "—"} / {ard?.motorB_cmd ?? "—"} • Reset flags: {resetFlags}
                                </Text>
                              </>
                            )}

                            <Text style={{ fontSize: 11, opacity: 0.55, marginTop: 6 }}>
                              Диск (disk) специально не показываем здесь, чтобы не грузить лишним.
                            </Text>
                          </View>
                        );
                      })()}
                    </Text>
                  </View>
                );
              })()}
            </ScrollView>
          </Dialog.Content>

          <Dialog.Actions>
            <Button onPress={refreshTelemetryNow}>Обновить</Button>
            <Button mode="contained" onPress={() => setTelemetryOpen(false)}>
              Закрыть
            </Button>
          </Dialog.Actions>
        </Dialog>

        <Snackbar visible={snack.open} onDismiss={() => setSnack({ open: false, text: "" })} duration={2500}>
          {snack.text}
        </Snackbar>
        <Snackbar
          visible={alertSnack.open}
          onDismiss={() => setAlertSnack({ open: false, text: "" })}
          duration={3000}
        >
          {alertSnack.text}
        </Snackbar>
      </Portal>
    </View>
  );
}