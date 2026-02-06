import { heroui } from "@heroui/react";

export const plugins = [
  heroui({
    defaultTheme: "dark",
    themes: {
      dark: {
        colors: {
          background: "#1E1D1F",
          foreground: "#E8E6E3",
          primary: { DEFAULT: "#9B7B5B", foreground: "#1E1D1F" },
          content1: "#282729",
          content2: "#2D2C2E",
          content3: "#363436",
          content4: "#1A191B",
          focus: "#9B7B5B",
          success: "#6B8E6B",
          danger: "#C45C5C",
        },
      },
      light: {
        colors: {
          background: "#FAFAF8",
          foreground: "#1C1917",
          primary: { DEFAULT: "#9B7B5B", foreground: "#FAFAF8" },
          content1: "#FFFFFF",
          content2: "#F5F5F0",
          content3: "#E7E5E4",
          content4: "#F0EFEB",
          focus: "#9B7B5B",
          success: "#5B8A5B",
          danger: "#C45C5C",
        },
      },
    },
  }),
];
