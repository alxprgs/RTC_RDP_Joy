import React, { useEffect, useMemo, useRef, useState } from "react";
import { KeyboardAvoidingView, Platform, View } from "react-native";
import { Button, Card, HelperText, Text, TextInput, useTheme } from "react-native-paper";
import { apiHealth, normalizeBaseUrl } from "../lib/api";

type Props = {
  initialValue: string;
  onConnected: (baseUrl: string) => void;
};

export default function HostScreen({ initialValue, onConnected }: Props) {
  const theme = useTheme();

  const [input, setInput] = useState(initialValue || "");
  const [checking, setChecking] = useState(false);
  const [status, setStatus] = useState<{ ok: boolean; text: string } | null>(null);

  const baseUrl = useMemo(() => normalizeBaseUrl(input), [input]);

  const debounceRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  async function checkNow(url: string) {
    if (!url) {
      setStatus(null);
      return;
    }
    setChecking(true);
    try {
      const r = await apiHealth(url);
      if (r?.ok) {
        setStatus({ ok: true, text: `OK: ${String(r.arduino ?? "arduino")}` });
      } else {
        setStatus({ ok: false, text: `Нет: ${String(r?.error ?? "unknown")}` });
      }
    } catch (e: any) {
      setStatus({ ok: false, text: e?.message ? String(e.message) : "Ошибка" });
    } finally {
      setChecking(false);
    }
  }

  useEffect(() => {
    if (debounceRef.current) clearTimeout(debounceRef.current);
    debounceRef.current = setTimeout(() => {
      checkNow(baseUrl);
    }, 450);

    return () => {
      if (debounceRef.current) clearTimeout(debounceRef.current);
    };
  }, [baseUrl]);

  const canStart = Boolean(baseUrl) && Boolean(status?.ok) && !checking;

  return (
    <KeyboardAvoidingView
      behavior={Platform.select({ ios: "padding", android: undefined })}
      style={{
        flex: 1,
        padding: 16,
        justifyContent: "center",
        backgroundColor: theme.colors.background, // ✅ вот оно
      }}
    >
      <Card
        style={{
          borderRadius: 18,
          overflow: "hidden",
          backgroundColor: theme.colors.surface, // чтобы карточка красиво менялась
        }}
      >
        <Card.Content style={{ gap: 12 }}>
          <Text variant="headlineSmall">Arduino Motor Bridge</Text>
          <Text style={{ opacity: 0.7 }}>
            Введи адрес сервера. Примеры:{"\n"}• 192.168.0.10:8000{"\n"}• http://192.168.0.10:8000
          </Text>

          <TextInput
            label="Host / Base URL"
            value={input}
            onChangeText={setInput}
            autoCapitalize="none"
            autoCorrect={false}
            placeholder="192.168.0.10:8000"
            right={
              <TextInput.Icon
                icon={checking ? "progress-clock" : "refresh"}
                onPress={() => checkNow(baseUrl)}
              />
            }
          />

          <HelperText type={status?.ok ? "info" : "error"} visible={Boolean(status)}>
            {status?.text ?? ""}
          </HelperText>

          <View style={{ flexDirection: "row", gap: 10 }}>
            <Button
              mode="outlined"
              onPress={() => checkNow(baseUrl)}
              loading={checking}
              disabled={!baseUrl || checking}
              style={{ flex: 1 }}
            >
              Проверить
            </Button>
            <Button mode="contained" onPress={() => onConnected(baseUrl)} disabled={!canStart} style={{ flex: 1 }}>
              Старт
            </Button>
          </View>

          <Text style={{ opacity: 0.6, fontSize: 12 }}>
            Если ты в эмуляторе/телефоне — “localhost” это сам телефон. Используй IP ПК в локалке.
          </Text>
        </Card.Content>
      </Card>
    </KeyboardAvoidingView>
  );
}
