import AsyncStorage from "@react-native-async-storage/async-storage";

export type TransportMode = "http" | "ws";

function key(baseUrl: string) {
  return `motor-bridge:${baseUrl}:transport`;
}

export async function loadTransportMode(baseUrl: string): Promise<TransportMode> {
  try {
    const v = await AsyncStorage.getItem(key(baseUrl));
    return v === "ws" ? "ws" : "http";
  } catch {
    return "http";
  }
}

export async function saveTransportMode(baseUrl: string, mode: TransportMode) {
  try {
    await AsyncStorage.setItem(key(baseUrl), mode);
  } catch {
  }
}
