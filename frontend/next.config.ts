import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  images: {
    remotePatterns: [
      {
        protocol: "https",
        hostname: "**.supabase.co",
      },
    ],
  },
  
  // Bundle size optimization - tree-shake these packages
  experimental: {
    optimizePackageImports: [
      "lucide-react",
      "@radix-ui/react-dialog",
      "@radix-ui/react-dropdown-menu",
      "@radix-ui/react-slot",
      "@react-three/fiber",
      "@react-three/drei",
      "framer-motion",
    ],
  },
  
  // Remove console logs in production (except errors and warnings)
  compiler: {
    removeConsole:
      process.env.NODE_ENV === "production"
        ? { exclude: ["error", "warn"] }
        : false,
  },
  
  // Disable source maps in production for smaller bundles
  productionBrowserSourceMaps: false,
};

export default nextConfig;
