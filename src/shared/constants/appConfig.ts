import pkg from "../../../package.json" with { type: "json" };

export const APP_CONFIG = {
  name: "Astra AI Gate",
  description: "AI Gateway for Multi-Provider LLMs",
  version: pkg.version,
};

export const THEME_CONFIG = {
  storageKey: "theme",
  defaultTheme: "system",
};
