import React, { createContext, useContext, useEffect, useMemo, useState } from "react";
import AsyncStorage from "@react-native-async-storage/async-storage";
import { PaperProvider } from "react-native-paper";
import { darkTheme, lightTheme } from "./theme";

type ThemeMode = "light" | "dark";

type ThemeCtx = {
  mode: ThemeMode;
  toggle: () => void;
  setMode: (m: ThemeMode) => void;
};

const Ctx = createContext<ThemeCtx | null>(null);

const KEY = "app_theme_mode";

export function ThemeProvider({ children }: { children: React.ReactNode }) {
  const [mode, setMode] = useState<ThemeMode>("dark");

  useEffect(() => {
    (async () => {
      try {
        const saved = await AsyncStorage.getItem(KEY);
        if (saved === "light" || saved === "dark") setMode(saved);
      } catch {
      }
    })();
  }, []);

  useEffect(() => {
    AsyncStorage.setItem(KEY, mode).catch(() => {});
  }, [mode]);

  const value = useMemo<ThemeCtx>(
    () => ({
      mode,
      setMode,
      toggle: () => setMode((m) => (m === "dark" ? "light" : "dark")),
    }),
    [mode]
  );

  const theme = mode === "dark" ? darkTheme : lightTheme;

  return (
    <Ctx.Provider value={value}>
      <PaperProvider theme={theme}>{children}</PaperProvider>
    </Ctx.Provider>
  );
}

export function useThemeMode() {
  const v = useContext(Ctx);
  if (!v) throw new Error("useThemeMode must be used inside ThemeProvider");
  return v;
}