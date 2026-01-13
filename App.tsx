import * as React from "react";
import { ThemeProvider } from "./src/app/themeContext";
import Root from "./src/Root";


export default function App() {
  return (
    <ThemeProvider>
      <Root />
    </ThemeProvider>
  );
}
