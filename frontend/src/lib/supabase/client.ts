import { createBrowserClient } from '@supabase/ssr'
import type { SupabaseClient } from '@supabase/supabase-js'

const API_URL = process.env.NEXT_PUBLIC_API_URL || 'http://localhost:8000'

let cachedClient: SupabaseClient | null = null
let configPromise: Promise<{ supabase_url: string; supabase_anon_key: string }> | null = null

async function fetchConfig() {
  if (!configPromise) {
    configPromise = fetch(`${API_URL}/api/config`, {
      cache: 'no-store',
      headers: {
        'Content-Type': 'application/json',
      }
    })
      .then(res => {
        if (!res.ok) {
          throw new Error(`Failed to fetch config: ${res.status}`)
        }
        return res.json()
      })
      .catch((err) => {
        console.error('Failed to fetch backend config:', err)
        return { supabase_url: '', supabase_anon_key: '' }
      })
  }
  return configPromise
}

export async function getSupabaseClient(): Promise<SupabaseClient | null> {
  if (cachedClient) return cachedClient

  const config = await fetchConfig()
  if (!config.supabase_url || !config.supabase_anon_key) {
    console.error('Supabase not configured — backend /api/config returned empty values', config)
    // Reset promise to allow retry
    configPromise = null
    return null
  }

  cachedClient = createBrowserClient(config.supabase_url, config.supabase_anon_key, {
    isSingleton: false,
  })
  return cachedClient
}

// Sync getter for backward compat — returns cached client or null
export function supabaseBrowser(): SupabaseClient | null {
  return cachedClient
}
