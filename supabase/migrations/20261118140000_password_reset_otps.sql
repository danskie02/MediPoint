create table if not exists public.password_reset_otps (
  id uuid primary key default gen_random_uuid(),
  profile_id uuid not null references public.profiles (id) on delete cascade,
  code_hash text not null,
  expires_at timestamptz not null,
  attempts integer not null default 0,
  consumed_at timestamptz,
  created_at timestamptz not null default now()
);

create index if not exists password_reset_otps_profile_id_idx
  on public.password_reset_otps (profile_id, created_at desc);

comment on table public.password_reset_otps is
  'One-time email codes used to verify forgot-password requests before a password can be changed.';
