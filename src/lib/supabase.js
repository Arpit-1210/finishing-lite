import { createClient } from '@supabase/supabase-js';

export const HAS_KEYS = !!(import.meta.env.VITE_SUPABASE_URL && import.meta.env.VITE_SUPABASE_ANON_KEY);

// Falls back to a dummy address so the page still loads and can show a clear message if the keys are missing.
export const supabase = createClient(
  import.meta.env.VITE_SUPABASE_URL || 'https://missing.supabase.co',
  import.meta.env.VITE_SUPABASE_ANON_KEY || 'missing'
);
