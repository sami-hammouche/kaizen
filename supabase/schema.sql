-- Kaizen web relay — run once in Supabase: Dashboard → SQL Editor → New query → paste → Run.
-- Stores, per user: the latest state sent by their Kaizen extension, and the orders
-- sent from the website. No Vinted password or session is ever stored here.

-- Latest state of the user's Kaizen extension (one row per user).
create table if not exists public.snapshots (
  user_id     uuid primary key references auth.users (id) on delete cascade,
  data        jsonb       not null default '{}'::jsonb, -- listings, stats, sales, settings, history…
  vinted_login text,
  updated_at  timestamptz not null default now(),       -- last full state
  seen_at     timestamptz not null default now()        -- heartbeat: extension alive (every minute)
);

-- Orders sent from the website, executed by the extension.
create table if not exists public.commands (
  id         bigint generated always as identity primary key,
  user_id    uuid not null default auth.uid() references auth.users (id) on delete cascade,
  action     text not null check (char_length(action) <= 40),
  args       jsonb not null default '{}'::jsonb,
  status     text not null default 'pending' check (status in ('pending', 'running', 'done', 'error')),
  result     jsonb,
  error      text,
  created_at timestamptz not null default now(),
  done_at    timestamptz
);
create index if not exists commands_user_pending on public.commands (user_id, status, id);

-- Row Level Security: everyone only ever sees and changes their own rows.
alter table public.snapshots enable row level security;
alter table public.commands  enable row level security;

drop policy if exists "own snapshot" on public.snapshots;
create policy "own snapshot" on public.snapshots
  for all using (user_id = auth.uid()) with check (user_id = auth.uid());

drop policy if exists "own commands" on public.commands;
create policy "own commands" on public.commands
  for all using (user_id = auth.uid()) with check (user_id = auth.uid());

-- Keep the commands table small: drop finished orders older than 7 days.
create or replace function public.prune_commands() returns void
language sql security definer set search_path = public as $$
  delete from public.commands
  where user_id = auth.uid() and status in ('done', 'error') and created_at < now() - interval '7 days';
$$;
grant execute on function public.prune_commands() to authenticated;

-- "Delete my account" button on the website (removes the user and, by cascade, all their data).
create or replace function public.delete_my_account() returns void
language sql security definer set search_path = public as $$
  delete from auth.users where id = auth.uid();
$$;
grant execute on function public.delete_my_account() to authenticated;

-- Live updates on the website (phone sees changes without reloading).
do $$ begin
  alter publication supabase_realtime add table public.snapshots, public.commands;
exception when duplicate_object then null; end $$;
