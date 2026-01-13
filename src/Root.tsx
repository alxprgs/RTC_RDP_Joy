import React, { useEffect, useMemo, useState } from "react";
import { View } from "react-native";
import { ActivityIndicator } from "react-native-paper";
import HostScreen from "./screens/HostScreen";
import ControlScreen from "./screens/ControlScreen";
import { loadBaseUrl, saveBaseUrl } from "./lib/storage";

export default function Root() {
  const [booting, setBooting] = useState(true);
  const [baseUrl, setBaseUrl] = useState<string>("");

  useEffect(() => {
    (async () => {
      const saved = await loadBaseUrl();
      if (saved) setBaseUrl(saved);
      setBooting(false);
    })();
  }, []);

  const [connectedUrl, setConnectedUrl] = useState<string | null>(null);

  const currentUrl = useMemo(() => connectedUrl ?? "", [connectedUrl]);

  if (booting) {
    return (
      <View style={{ flex: 1, alignItems: "center", justifyContent: "center" }}>
        <ActivityIndicator />
      </View>
    );
  }

  if (!connectedUrl) {
    return (
      <HostScreen
        initialValue={baseUrl}
        onConnected={async (url) => {
          setBaseUrl(url);
          await saveBaseUrl(url);
          setConnectedUrl(url);
        }}
      />
    );
  }

  return (
    <ControlScreen
      baseUrl={currentUrl}
      onChangeHost={() => setConnectedUrl(null)}
    />
  );
}
