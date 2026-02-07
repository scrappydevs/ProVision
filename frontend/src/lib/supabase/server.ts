import { createServerClient, type CookieOptions } from '@supabase/ssr'
import { cookies } from 'next/headers'

const API_URL = process.env.NEXT_PUBLIC_API_URL || 'http://localhost:8000'

let serverConfig: { supabase_url: string; supabase_anon_key: string } | null = null

async function getConfig() {
  if (!serverConfig) {
    const res = await fetch(`${API_URL}/api/config`, { cache: 'force-cache' })
    serverConfig = await res.json()
  }
  return serverConfig!
}

export async function supabaseServer() {
  const config = await getConfig()
  const cookieStore = await cookies()

  return createServerClient(
    config.supabase_url,
    config.supabase_anon_key,
    {
      cookies: {
        get(name: string) {
          return cookieStore.get(name)?.value
        },
        set(name: string, value: string, options: CookieOptions) {
          cookieStore.set({ name, value, ...options })
        },
        remove(name: string, options: CookieOptions) {
          cookieStore.set({ name, value: '', ...options })
        },
      },
    }
  )
}
