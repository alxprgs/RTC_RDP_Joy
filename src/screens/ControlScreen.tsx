import React, { useEffect, useMemo, useRef, useState } from "react";
import { Animated, Easing, FlatList, View } from "react-native";
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
  apiServoA,
  apiServoB,
  apiServoAll,
  apiServoCenter,
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

    const [servoA, setServoA] = useState(90);
  const [servoB, setServoB] = useState(90);

  const [servoAText, setServoAText] = useState("90");
  const [servoBText, setServoBText] = useState("90");

  const servoInFlightRef = useRef(false);

  function digitsOnly(t: string) {
    return (t ?? "").replace(/[^\d]/g, "");
  }

  async function sendServo(which: "a" | "b" | "all", deg: number) {
    if (!baseUrl) return;
    if (servoInFlightRef.current) return;

    const v = clamp(Math.round(deg), 0, 180);

    servoInFlightRef.current = true;
    try {
      if (which === "a") await apiServoA(baseUrl, v);
      if (which === "b") await apiServoB(baseUrl, v);
      if (which === "all") await apiServoAll(baseUrl, v);
    } catch (e: any) {
      setSnack({ open: true, text: e?.message ? String(e.message) : "Servo error" });
    } finally {
      servoInFlightRef.current = false;
    }
  }

  async function centerServos() {
    try {
      setServoA(90);
      setServoB(90);
      setServoAText("90");
      setServoBText("90");
      await apiServoCenter(baseUrl);
    } catch (e: any) {
      setSnack({ open: true, text: e?.message ? String(e.message) : "Servo center error" });
    }
  }

  function applyServoAFromText() {
    const cleaned = digitsOnly(servoAText);
    const v = clamp(parseInt(cleaned || "0", 10) || 0, 0, 180);
    setServoA(v);
    setServoAText(String(v));
    sendServo("a", v);
  }

  function applyServoBFromText() {
    const cleaned = digitsOnly(servoBText);
    const v = clamp(parseInt(cleaned || "0", 10) || 0, 0, 180);
    setServoB(v);
    setServoBText(String(v));
    sendServo("b", v);
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

  const joyPendingRef = useRef({ x: 0, y: 0, active: false });
  const joyLastSentRef = useRef({ x: 0, y: 0, active: false });
  const joyInFlightRef = useRef(false);

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
        contentContainerStyle={{ padding: 12, gap: 12 }}
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
                  onChange={(x, y, active) => {
                    joyPendingRef.current = { x, y, active };
                  }}
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
                  Сервоприводы
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
                    onPress={() => {
                      setServoB(servoA);
                      setServoBText(String(servoA));
                      sendServo("b", servoA);
                    }}
                  >
                    B = A
                  </Button>

                  <Button
                    mode="outlined"
                    compact
                    onPress={() => {
                      setServoA(servoB);
                      setServoAText(String(servoB));
                      sendServo("a", servoB);
                    }}
                  >
                    A = B
                  </Button>

                  <Button mode="outlined" compact onPress={centerServos}>
                    Центр
                  </Button>
                </View>
              </View>

                <Divider />

                {/* 2 сервы в ряд */}
                <View style={{ flexDirection: "row", gap: 12 }}>
                  {/* SERVO A */}
                  <Card mode="outlined" style={{ flex: 1, borderRadius: 16 }}>
                    <Card.Content style={{ gap: 8 }}>
                      <View style={{ flexDirection: "row", alignItems: "center", justifyContent: "space-between" }}>
                        <Text variant="titleSmall">Servo A</Text>
                        <Text style={{ opacity: 0.7 }}>{servoA}°</Text>
                      </View>

                      <Slider
                        style={{ width: "100%", height: 36 }}
                        minimumValue={0}
                        maximumValue={180}
                        step={1}
                        value={servoA}
                        onValueChange={(v) => {
                          const nv = Math.round(v);
                          setServoA(nv);
                          setServoAText(String(nv));
                        }}
                        onSlidingComplete={(v) => sendServo("a", Math.round(v))}
                        minimumTrackTintColor={theme.colors.primary}
                        maximumTrackTintColor={theme.colors.outline}
                        thumbTintColor={theme.colors.primary}
                      />

                      <View style={{ flexDirection: "row", alignItems: "center", gap: 8 }}>
                        <TextInput
                          label="deg"
                          value={servoAText}
                          onChangeText={(t) => setServoAText(digitsOnly(t))}
                          keyboardType="number-pad"
                          style={{ flex: 1 }}
                          onBlur={applyServoAFromText}
                          onSubmitEditing={applyServoAFromText}
                        />
                        <IconButton icon="check" onPress={applyServoAFromText} />
                      </View>
                    </Card.Content>
                  </Card>

                  {/* SERVO B */}
                  <Card mode="outlined" style={{ flex: 1, borderRadius: 16 }}>
                    <Card.Content style={{ gap: 8 }}>
                      <View style={{ flexDirection: "row", alignItems: "center", justifyContent: "space-between" }}>
                        <Text variant="titleSmall">Servo B</Text>
                        <Text style={{ opacity: 0.7 }}>{servoB}°</Text>
                      </View>

                      <Slider
                        style={{ width: "100%", height: 36 }}
                        minimumValue={0}
                        maximumValue={180}
                        step={1}
                        value={servoB}
                        onValueChange={(v) => {
                          const nv = Math.round(v);
                          setServoB(nv);
                          setServoBText(String(nv));
                        }}
                        onSlidingComplete={(v) => sendServo("b", Math.round(v))}
                        minimumTrackTintColor={theme.colors.primary}
                        maximumTrackTintColor={theme.colors.outline}
                        thumbTintColor={theme.colors.primary}
                      />

                      <View style={{ flexDirection: "row", alignItems: "center", gap: 8 }}>
                        <TextInput
                          label="deg"
                          value={servoBText}
                          onChangeText={(t) => setServoBText(digitsOnly(t))}
                          keyboardType="number-pad"
                          style={{ flex: 1 }}
                          onBlur={applyServoBFromText}
                          onSubmitEditing={applyServoBFromText}
                        />
                        <IconButton icon="check" onPress={applyServoBFromText} />
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

        <Snackbar visible={snack.open} onDismiss={() => setSnack({ open: false, text: "" })} duration={2500}>
          {snack.text}
        </Snackbar>
      </Portal>
    </View>
  );
}