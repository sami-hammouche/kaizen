// Public settings of the Kaizen website.
// SUPABASE_URL / SUPABASE_KEY: the Supabase project (the "anon public" key is meant
// to be public; every row is protected by row level security, see supabase/schema.sql).
export const SUPABASE_URL = '';
export const SUPABASE_KEY = '';

// Where people download the Kaizen extension (ZIP, installed in developer mode).
export const EXTENSION_ZIP = 'downloads/kaizen.zip';

// The extension sends a heartbeat every minute: older than this = PC off.
export const ONLINE_MS = 2.5 * 60 * 1000;
