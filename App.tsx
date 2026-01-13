import * as React from "react";
import { PaperProvider } from "react-native-paper";
import { SafeAreaProvider } from "react-native-safe-area-context";
import Root from "./src/Root";

export default function App() {
  return (
    <SafeAreaProvider>
      <PaperProvider>
        <Root />
      </PaperProvider>
    </SafeAreaProvider>
  );
}
