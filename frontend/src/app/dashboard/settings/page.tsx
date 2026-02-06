"use client";

import { useState } from "react";
import { useAuth } from "@/hooks/useAuth";
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { User, Bell, Shield, Palette, LogOut } from "lucide-react";

export default function SettingsPage() {
  const { user, signOut } = useAuth();
  const [notifications, setNotifications] = useState(true);

  return (
    <div>
      <div className="mb-4">
        <h1 className="text-xl font-light text-foreground">Settings</h1>
        <p className="text-sm text-muted-foreground">Manage your account and preferences</p>
      </div>

      <div className="space-y-4 max-w-2xl">
        {/* Profile Section */}
        <Card>
          <CardHeader>
            <div className="flex items-center gap-3">
              <div className="w-10 h-10 rounded-full bg-muted flex items-center justify-center">
                <User className="w-5 h-5 text-[#9B7B5B]" />
              </div>
              <div>
                <CardTitle className="text-base">Profile</CardTitle>
                <CardDescription>Your account information</CardDescription>
              </div>
            </div>
          </CardHeader>
          <CardContent className="space-y-4">
            <div>
              <label className="block text-xs text-muted-foreground mb-1">Email</label>
              <p className="text-sm text-foreground">{user?.email || "Not signed in"}</p>
            </div>
            <div>
              <label className="block text-xs text-muted-foreground mb-1">User ID</label>
              <p className="text-xs text-muted-foreground font-mono">{user?.id || "—"}</p>
            </div>
          </CardContent>
        </Card>

        {/* Notifications Section */}
        <Card>
          <CardHeader>
            <div className="flex items-center gap-3">
              <div className="w-10 h-10 rounded-full bg-muted flex items-center justify-center">
                <Bell className="w-5 h-5 text-[#9B7B5B]" />
              </div>
              <div>
                <CardTitle className="text-base">Notifications</CardTitle>
                <CardDescription>Manage notification preferences</CardDescription>
              </div>
            </div>
          </CardHeader>
          <CardContent>
            <div className="flex items-center justify-between">
              <div>
                <p className="text-sm text-foreground">Processing alerts</p>
                <p className="text-xs text-muted-foreground">Get notified when analysis completes</p>
              </div>
              <button
                onClick={() => setNotifications(!notifications)}
                className={`w-11 h-6 rounded-full transition-colors ${
                  notifications ? "bg-[#9B7B5B]" : "bg-border"
                }`}
              >
                <div
                  className={`w-5 h-5 rounded-full bg-white transition-transform ${
                    notifications ? "translate-x-5" : "translate-x-0.5"
                  }`}
                />
              </button>
            </div>
          </CardContent>
        </Card>

        {/* Theme Section */}
        <Card>
          <CardHeader>
            <div className="flex items-center gap-3">
              <div className="w-10 h-10 rounded-full bg-muted flex items-center justify-center">
                <Palette className="w-5 h-5 text-[#9B7B5B]" />
              </div>
              <div>
                <CardTitle className="text-base">Appearance</CardTitle>
                <CardDescription>Customize the app appearance</CardDescription>
              </div>
            </div>
          </CardHeader>
          <CardContent>
            <div className="flex items-center gap-3">
              <div className="flex-1 p-3 rounded-lg border border-primary bg-background">
                <div className="flex items-center gap-2">
                  <div className="w-4 h-4 rounded bg-background border border-border" />
                  <span className="text-sm text-foreground">Dark</span>
                </div>
              </div>
              <div className="flex-1 p-3 rounded-lg border border-border bg-muted opacity-50 cursor-not-allowed">
                <div className="flex items-center gap-2">
                  <div className="w-4 h-4 rounded bg-white border border-[#E0E0E0]" />
                  <span className="text-sm text-muted-foreground">Light</span>
                </div>
              </div>
            </div>
            <p className="text-xs text-muted-foreground mt-2">Light theme coming soon</p>
          </CardContent>
        </Card>

        {/* Security Section */}
        <Card>
          <CardHeader>
            <div className="flex items-center gap-3">
              <div className="w-10 h-10 rounded-full bg-muted flex items-center justify-center">
                <Shield className="w-5 h-5 text-[#9B7B5B]" />
              </div>
              <div>
                <CardTitle className="text-base">Security</CardTitle>
                <CardDescription>Account security settings</CardDescription>
              </div>
            </div>
          </CardHeader>
          <CardContent className="space-y-4">
            <div className="flex items-center justify-between">
              <div>
                <p className="text-sm text-foreground">Sign out</p>
                <p className="text-xs text-muted-foreground">Sign out of your account</p>
              </div>
              <Button
                variant="outline"
                size="sm"
                onClick={signOut}
                className="gap-2 text-[#C45C5C] hover:text-[#C45C5C] hover:bg-[#C45C5C]/10 border-[#C45C5C]/30"
              >
                <LogOut className="w-4 h-4" />
                Sign Out
              </Button>
            </div>
          </CardContent>
        </Card>
      </div>
    </div>
  );
}
