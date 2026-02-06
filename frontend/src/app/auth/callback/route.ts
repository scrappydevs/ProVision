import { NextResponse } from 'next/server'
import { createServerClient, type CookieOptions } from '@supabase/ssr'
import { cookies } from 'next/headers'

const API_URL = process.env.NEXT_PUBLIC_API_URL || 'http://localhost:8000'

type CookieToSet = { name: string; value: string; options: CookieOptions }

export async function GET(request: Request) {
  const requestUrl = new URL(request.url)
  const code = requestUrl.searchParams.get('code')

  if (code) {
    const cookieStore = await cookies()

    const configRes = await fetch(`${API_URL}/api/config`)
    const config = await configRes.json()
    
    const cookiesToSetOnResponse: CookieToSet[] = []
    let setAllResolver: (() => void) | null = null
    const setAllPromise = new Promise<void>((resolve) => {
      setAllResolver = resolve
      setTimeout(() => resolve(), 5000)
    })

    const supabase = createServerClient(
      config.supabase_url,
      config.supabase_anon_key,
      {
        cookies: {
          getAll() {
            return cookieStore.getAll()
          },
          setAll(cookiesToSet: CookieToSet[]) {
            cookiesToSet.forEach(({ name, value, options }: CookieToSet) => {
              cookiesToSetOnResponse.push({ name, value, options })
              try {
                cookieStore.set(name, value, options)
              } catch {
                // Ignore errors when setting on cookieStore in route handlers
              }
            })
            
            // Resolve the promise so we know cookies are ready
            if (setAllResolver) setAllResolver()
          },
        },
      }
    )

    const { error } = await supabase.auth.exchangeCodeForSession(code)

    if (error) {
      console.error('[AUTH CALLBACK] Exchange error:', error)
      return NextResponse.redirect(new URL('/?error=' + encodeURIComponent(error.message), request.url))
    }

    // Wait for setAll to be called (with timeout)
    await setAllPromise

    // Create response AFTER we have all cookies
    const response = NextResponse.redirect(new URL('/dashboard', request.url))

    // Apply all collected cookies to the response
    cookiesToSetOnResponse.forEach(({ name, value, options }) => {
      response.cookies.set({
        name,
        value,
        ...options,
        httpOnly: false,
        secure: process.env.NODE_ENV === 'production',
        sameSite: 'lax',
        path: '/',
      })
    })

    return response
  }

  return NextResponse.redirect(new URL('/', request.url))
}
