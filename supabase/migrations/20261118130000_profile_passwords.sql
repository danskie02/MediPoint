alter table public.profiles
  add column if not exists password_hash text,
  add column if not exists must_change_password boolean not null default true;

comment on column public.profiles.password_hash is
  'SHA-256 hex digest of the account password. Null means the ID number is still the temporary password.';

comment on column public.profiles.must_change_password is
  'When true, password login must replace the temporary password before the account can continue.';
