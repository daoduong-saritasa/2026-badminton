import { createClient, type SupabaseClient } from '@supabase/supabase-js'

import type { Database } from './database.types'

let client: SupabaseClient<Database> | null = null

function requirePublicConfig(name: 'VITE_SUPABASE_URL' | 'VITE_SUPABASE_ANON_KEY'): string {
  const value = import.meta.env[name]

  if (typeof value !== 'string' || value.trim() === '') {
    throw new Error(`Missing ${name}. Copy .env.example to .env.local and set the public Supabase configuration.`)
  }

  return value
}

export function getSupabaseClient(): SupabaseClient<Database> {
  if (client === null) {
    client = createClient<Database>(
      requirePublicConfig('VITE_SUPABASE_URL'),
      requirePublicConfig('VITE_SUPABASE_ANON_KEY'),
      {
        auth: {
          autoRefreshToken: true,
          detectSessionInUrl: false,
          persistSession: true,
        },
      },
    )
  }

  return client
}
