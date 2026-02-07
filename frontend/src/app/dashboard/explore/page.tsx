"use client";

import { Compass } from "lucide-react";
import Link from "next/link";

export default function ExplorePage() {
  return (
    <div className="space-y-4">
      <div>
        <h1 className="text-xl font-light text-foreground">Explore</h1>
        <p className="text-xs text-muted-foreground mt-0.5">
          Demos and tools
        </p>
      </div>

      <div className="rounded-xl bg-card border border-border p-4">
        <Link
          href="/demo/hawkeye"
          className="flex items-center gap-3 p-3 rounded-lg hover:bg-muted/50 transition-colors"
        >
          <div className="w-10 h-10 rounded-lg bg-muted flex items-center justify-center shrink-0">
            <Compass className="w-5 h-5 text-primary" />
          </div>
          <div>
            <p className="text-sm font-medium text-foreground">HawkEye demo</p>
            <p className="text-xs text-muted-foreground">Ball trajectory visualization</p>
          </div>
        </Link>
      </div>
    </div>
  );
}
