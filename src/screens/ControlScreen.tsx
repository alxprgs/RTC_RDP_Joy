import React, { useEffect, useMemo, useRef, useState } from "react";
import { FlatList, View } from "react-native";
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
} from "react-native-paper";
import { useThemeMode } from "../app/themeContext";
import JoystickPad from "../components/JoystickPad";
import { apiJoystick, apiListActions, apiRunAction, apiStop, apiHealth } from "../lib/api";
import { loadButtons, saveButtons } from "../lib/storage";
import type { CustomButton, ServerAction } from "../types/buttons";
import { useTheme } from "react-native-paper";

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
  const [serverActions, setServerActions] = useState<ServerAction[]>([]);
  const [buttons, setButtons] = useState<CustomButton[]>([]);
  const [loadingActions, setLoadingActions] = useState(false);

  const [deadzone, setDeadzone] = useState(20);
  const [scale, setScale] = useState(1.0);

  const [snack, setSnack] = useState<{ open: boolean; text: string }>({ open: false, text: "" });
  const [healthText, setHealthText] = useState<string>("");

  const { mode, toggle } = useThemeMode();
  const [transportMode, setTransportMode] = useState<TransportMode>("http");
  const [wsStatus, setWsStatus] = useState<WsStatus>("disconnected");
  const [wsErrText, setWsErrText] = useState<string>("");

  const theme = useTheme();

  const wsRef = useRef<JoystickWsClient | null>(null);

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

  // persist mode
  useEffect(() => {
    if (!baseUrl) return;
    saveTransportMode(baseUrl, transportMode);
  }, [baseUrl, transportMode]);

  // manage WS client lifecycle
  useEffect(() => {
    // cleanup old
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
    try {
      const r = await apiHealth(baseUrl);
      setHealthText(r?.ok ? `OK: ${String(r.arduino ?? "")}` : `Нет: ${String(r?.error ?? "")}`);
    } catch (e: any) {
      setHealthText(e?.message ? String(e.message) : "health error");
    }
  }

  useEffect(() => {
    refreshHealth();
  }, [baseUrl]);

  async function persist(next: CustomButton[]) {
    setButtons(next);
    await saveButtons(baseUrl, next);
  }

  // ---- Joystick sending (HTTP polling / WS push) ----
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

      // HTTP
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

      // WS
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

  return (
    <View style={{ flex: 1, backgroundColor: theme.colors.background }}>
      <Appbar.Header>
        <Appbar.Content title="Motor Control" subtitle={baseUrl} />
          <Appbar.Action
          icon={mode === "dark" ? "weather-sunny" : "weather-night"}
          onPress={toggle}
        />
        <Appbar.Action icon="heart-pulse" onPress={refreshHealth} />
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

                {/* Transport toggle */}
                <View style={{ gap: 8 }}>
                  <View style={{ flexDirection: "row", alignItems: "center", justifyContent: "space-between" }}>
                    <Text style={{ opacity: 0.8 }}>Транспорт джойстика</Text>
                    {transportMode === "ws" ? (
                      <View style={{ flexDirection: "row", alignItems: "center", gap: 6 }}>
                        <Text style={{ opacity: 0.7 }}>{wsStatusLabel}</Text>
                        <IconButton
                          icon="wifi-refresh"
                          size={18}
                          onPress={() => wsRef.current?.reconnectNow()}
                        />
                      </View>
                    ) : (
                      <Text style={{ opacity: 0.7 }}>HTTP: polling</Text>
                    )}
                  </View>

                  <RadioButton.Group
                    value={transportMode}
                    onValueChange={(v) => setTransportMode(v as TransportMode)}
                  >
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
                    label="Scale (0..1)"
                    value={String(scale)}
                    onChangeText={(t) => {
                      const v = parseFloat(t.replace(",", "."));
                      if (Number.isFinite(v)) setScale(clamp(v, 0, 1));
                    }}
                    keyboardType="decimal-pad"
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
