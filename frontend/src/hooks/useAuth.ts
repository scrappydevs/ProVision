"use client";

import { useEffect, useState, useCallback } from "react";
import { User } from "@supabase/supabase-js";
import { getSupabaseClient, supabaseBrowser } from "@/lib/supabase/client";

export function useAuth() {
  const [user, setUser] = useState<User | null>(null);
  const [isLoading, setIsLoading] = useState(true);

  useEffect(() => {
    let subscription: { unsubscribe: () => void } | null = null;

    getSupabaseClient().then((supabase) => {
      if (!supabase) {
        console.error('Supabase not configured.');
        setIsLoading(false);
        return;
      }

      supabase.auth.getUser().then((result: { data: { user: User | null }; error: Error | null }) => {
        if (result.error) {
          supabase.auth.signOut().catch(() => {});
          setUser(null);
        } else {
          setUser(result.data.user ?? null);
        }
        setIsLoading(false);
      }).catch(() => {
        supabase.auth.signOut().catch(() => {});
        setUser(null);
        setIsLoading(false);
      });

      const { data } = supabase.auth.onAuthStateChange((_event: string, session: { user: User | null } | null) => {
        setUser(session?.user ?? null);
        setIsLoading(false);
      });
      subscription = data.subscription;
    });

    return () => subscription?.unsubscribe();
  }, []);

  const signInWithGoogle = useCallback(async () => {
    const supabase = await getSupabaseClient();
    if (!supabase) return;
    const { error } = await supabase.auth.signInWithOAuth({
      provider: "google",
      options: {
        redirectTo: `${window.location.origin}/auth/callback`,
      },
    });
    if (error) console.error("Error signing in:", error);
  }, []);

  const signOut = useCallback(async () => {
    const supabase = await getSupabaseClient();
    if (!supabase) {
      setUser(null);
      return;
    }
    const { error } = await supabase.auth.signOut();
    if (error) console.error("Error signing out:", error);
  }, []);

  return { user, isLoading, signInWithGoogle, signOut };
}
