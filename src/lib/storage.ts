import AsyncStorage from "@react-native-async-storage/async-storage";
import type { CustomButton } from "../types/buttons";

const KEY_BASE_URL = "motorbridge.baseUrl";

function keyButtons(baseUrl: string) {
  return `motorbridge.customButtons:${baseUrl}`;
}

export async function loadBaseUrl() {
  try {
    return (await AsyncStorage.getItem(KEY_BASE_URL)) ?? "";
  } catch {
    return "";
  }
}

export async function saveBaseUrl(url: string) {
  try {
    await AsyncStorage.setItem(KEY_BASE_URL, url);
  } catch {}
}

export async function loadButtons(baseUrl: string): Promise<CustomButton[]> {
  try {
    const raw = await AsyncStorage.getItem(keyButtons(baseUrl));
    if (!raw) return [];
    const parsed = JSON.parse(raw);
    return Array.isArray(parsed) ? (parsed as CustomButton[]) : [];
  } catch {
    return [];
  }
}

export async function saveButtons(baseUrl: string, buttons: CustomButton[]) {
  try {
    await AsyncStorage.setItem(keyButtons(baseUrl), JSON.stringify(buttons));
  } catch {}
}
