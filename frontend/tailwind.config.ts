import type { Config } from "tailwindcss";
import { heroui } from "@heroui/react";

const config: Config = {
  content: [
    "./src/pages/**/*.{js,ts,jsx,tsx,mdx}",
    "./src/components/**/*.{js,ts,jsx,tsx,mdx}",
    "./src/app/**/*.{js,ts,jsx,tsx,mdx}",
    "./node_modules/@heroui/theme/dist/**/*.{js,ts,jsx,tsx}",
  ],
  theme: {
    extend: {
      fontFamily: {
        mono: ['var(--font-ibm-plex-mono)', 'monospace'],
      },
    },
  },
  darkMode: "class",
  plugins: [
    heroui({
      defaultTheme: "dark",
      themes: {
        dark: {
          colors: {
            background: "#1E1D1F",
            foreground: "#E8E6E3",
            primary: {
              DEFAULT: "#9B7B5B",
              foreground: "#1E1D1F",
            },
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
            background: "#F5F2EE",
            foreground: "#2C2A28",
            primary: {
              DEFAULT: "#8A6B4B",
              foreground: "#FFFFFF",
            },
            content1: "#FAF7F2",
            content2: "#EDE9E4",
            content3: "#DDD8D2",
            content4: "#EFEFEC",
            focus: "#8A6B4B",
            success: "#5A7D5A",
            danger: "#C45C5C",
          },
        },
      },
    }),
  ],
};

export default config;
