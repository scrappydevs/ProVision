"use client";

import { useEffect, useState, useRef } from "react";
import { useRouter } from "next/navigation";
import dynamic from "next/dynamic";
import { Button } from "@/components/ui/button";
import { motion } from "framer-motion";
import { Play, Users, Camera, Eye, BarChart3 } from "lucide-react";
import { useAuth } from "@/hooks/useAuth";

const AnalyticsOverlay = dynamic(
  () => import("@/components/analytics-overlay").then((mod) => mod.AnalyticsOverlay),
  { ssr: false }
);

export default function LandingPage() {
  const { user, isLoading, signInWithGoogle } = useAuth();
  const router = useRouter();
  const [mounted, setMounted] = useState(false);
  const videoRef = useRef<HTMLVideoElement>(null);

  useEffect(() => setMounted(true), []);

  useEffect(() => {
    if (videoRef.current) {
      videoRef.current.play().catch(() => {});
    }
  }, [mounted]);

  const handleTimeUpdate = () => {
    const video = videoRef.current;
    if (!video || !isFinite(video.duration)) return;
    if (video.duration - video.currentTime <= 0.1) {
      video.currentTime = 3;
      video.play().catch(() => {});
    }
  };

  if (!mounted) {
    return (
      <main className="min-h-screen bg-background text-foreground dark">
        <div className="min-h-screen" />
      </main>
    );
  }

  return (
    <main className="min-h-screen bg-background text-foreground dark">
      {/* Navigation */}
      <motion.nav 
        initial={{ opacity: 0 }}
        animate={{ opacity: 1 }}
        transition={{ duration: 1, delay: 0.5 }}
        className="fixed top-0 left-0 right-0 z-50 px-8 py-6"
      >
        <div className="max-w-7xl mx-auto flex items-center justify-between">
          <span className="text-sm font-medium tracking-wide">ProVision</span>
          <div className="flex items-center gap-8">
            <a href="#how" className="text-sm text-muted-foreground hover:text-foreground transition-colors">How it works</a>
            <a href="#features" className="text-sm text-muted-foreground hover:text-foreground transition-colors">Features</a>
            <Button 
              onClick={() => user ? router.push("/dashboard") : signInWithGoogle()} 
              disabled={isLoading}
              variant="ghost"
              className="text-sm text-primary hover:text-foreground hover:bg-transparent"
            >
              {isLoading ? "..." : user ? "Dashboard" : "Sign in"}
            </Button>
          </div>
        </div>
      </motion.nav>

      {/* Hero */}
      <section className="relative min-h-screen flex flex-col overflow-hidden">
        {/* Video Background */}
        <div className="absolute inset-0">
          <video
            ref={videoRef}
            autoPlay
            muted
            playsInline
            onTimeUpdate={handleTimeUpdate}
            className="absolute inset-0 w-full h-full object-cover"
          >
            <source src="/hero-video.mp4" type="video/mp4" />
          </video>
          <div className="absolute inset-0 bg-gradient-to-b from-background via-background/40 to-transparent" />
        </div>

        {/* AI Analytics Overlay */}
        <AnalyticsOverlay />

        {/* Content - Fixed at top like original */}
        <div className="relative z-10 px-8 pt-28 md:pt-32">
          <div className="max-w-5xl mx-auto">
            <motion.div
              initial={{ opacity: 0, y: 20 }}
              animate={{ opacity: 1, y: 0 }}
              transition={{ duration: 1, delay: 0.8 }}
            >
              <h1 className="text-4xl md:text-5xl lg:text-6xl font-light leading-[1.1] tracking-tight mb-3">
                Turn <span className="text-[#9B7B5B]">Spectator</span> into <span className="text-[#9B7B5B]">Player</span>
              </h1>
            </motion.div>
          </div>
        </div>
      </section>

      {/* How it works */}
      <section id="how" className="py-32 px-8 border-t border-border">
        <div className="max-w-5xl mx-auto">
          <motion.p
            initial={{ opacity: 0 }}
            whileInView={{ opacity: 1 }}
            viewport={{ once: true }}
            className="text-sm text-muted-foreground mb-16"
          >
            Process
          </motion.p>
          
          <div className="space-y-16">
            {[
              { 
                num: "01", 
                title: "Upload", 
                desc: "Drop any sports clip from spectator view.",
                icon: Play
              },
              { 
                num: "02", 
                title: "Track", 
                desc: "Click on players or the ball to track with SAM2.",
                icon: Users
              },
              { 
                num: "03", 
                title: "Transform", 
                desc: "EgoX converts spectator view to first-person POV.",
                icon: Eye
              },
              { 
                num: "04", 
                title: "Analyze", 
                desc: "Dual-view pose analysis with performance metrics.",
                icon: BarChart3
              },
            ].map((step, i) => (
              <motion.div
                key={step.num}
                initial={{ opacity: 0, y: 20 }}
                whileInView={{ opacity: 1, y: 0 }}
                viewport={{ once: true }}
                transition={{ delay: i * 0.1 }}
                className="grid grid-cols-12 gap-8 items-baseline"
              >
                <span className="col-span-1 text-sm text-[#9B7B5B] font-mono">{step.num}</span>
                <div className="col-span-3 flex items-center gap-3">
                  <step.icon className="w-5 h-5 text-muted-foreground" />
                  <h3 className="text-2xl font-light">{step.title}</h3>
                </div>
                <p className="col-span-8 text-muted-foreground text-lg">{step.desc}</p>
              </motion.div>
            ))}
          </div>
        </div>
      </section>

      {/* Features */}
      <section id="features" className="py-24 px-8 border-t border-border">
        <div className="max-w-5xl mx-auto">
          <motion.p
            initial={{ opacity: 0 }}
            whileInView={{ opacity: 1 }}
            viewport={{ once: true }}
            className="text-sm text-muted-foreground mb-12"
          >
            Features
          </motion.p>

          <div className="grid grid-cols-2 md:grid-cols-4 gap-8">
            {[
              { label: "EgoX View", desc: "Spectator to player POV", icon: Eye },
              { label: "SAM2 Tracking", desc: "Click-to-track objects", icon: Users },
              { label: "Pose Analysis", desc: "MediaPipe skeleton overlay", icon: BarChart3 },
              { label: "Dual Viewer", desc: "Side-by-side comparison", icon: Camera },
            ].map((item, i) => (
              <motion.div
                key={item.label}
                initial={{ opacity: 0, y: 20 }}
                whileInView={{ opacity: 1, y: 0 }}
                viewport={{ once: true }}
                transition={{ delay: i * 0.1 }}
                className="text-center"
              >
                <div className="w-12 h-12 rounded-xl bg-muted flex items-center justify-center mx-auto mb-4">
                  <item.icon className="w-5 h-5 text-[#9B7B5B]" />
                </div>
                <div className="text-sm font-medium mb-1">{item.label}</div>
                <div className="text-xs text-muted-foreground">{item.desc}</div>
              </motion.div>
            ))}
          </div>
        </div>
      </section>

      {/* CTA */}
      <section className="py-32 px-8 border-t border-border">
        <div className="max-w-5xl mx-auto text-center">
          <motion.h2
            initial={{ opacity: 0 }}
            whileInView={{ opacity: 1 }}
            viewport={{ once: true }}
            className="text-3xl font-light mb-4"
          >
            Ready to get started?
          </motion.h2>
          <motion.p
            initial={{ opacity: 0 }}
            whileInView={{ opacity: 1 }}
            viewport={{ once: true }}
            transition={{ delay: 0.1 }}
            className="text-muted-foreground mb-8 max-w-md mx-auto"
          >
            Upload your sports clips and experience AI-powered exo-to-ego transformation with dual-view pose analysis.
          </motion.p>
          <motion.div
            initial={{ opacity: 0 }}
            whileInView={{ opacity: 1 }}
            viewport={{ once: true }}
            transition={{ delay: 0.2 }}
            className="flex items-center justify-center gap-4"
          >
            <Button 
              onClick={() => user ? router.push("/dashboard") : signInWithGoogle()}
              className="bg-primary hover:bg-primary/90 text-primary-foreground h-12 px-8 text-sm font-medium"
            >
              Get Started
            </Button>
          </motion.div>
        </div>
      </section>

      {/* Footer */}
      <footer className="py-8 px-8 border-t border-border">
        <div className="max-w-5xl mx-auto flex items-center justify-between text-sm text-muted-foreground">
          <span>ProVision</span>
          <div className="flex items-center gap-6 text-xs">
            <span>EgoX</span>
            <span>SAM2</span>
            <span>MediaPipe</span>
          </div>
        </div>
      </footer>
    </main>
  );
}
