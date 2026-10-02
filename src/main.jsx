import React from "react";
import ReactDOM from "react-dom/client";
import "./styles/tokens.css";
import App, { ErrorBoundary, THEME_VARS as APP_COLOR_TOKENS } from "./App";
import AppVersionPrompt from "./components/shell/AppVersionPrompt.jsx";

ReactDOM.createRoot(document.getElementById("root")).render(
  <React.StrictMode>
    <ErrorBoundary>
      <App />
    </ErrorBoundary>
    <ErrorBoundary>
      <AppVersionPrompt C={APP_COLOR_TOKENS} />
    </ErrorBoundary>
  </React.StrictMode>,
);
