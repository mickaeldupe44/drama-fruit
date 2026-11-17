-- Drama Fruit : la base de données du mode payant (Supabase).
-- À coller une seule fois dans Supabase → SQL Editor → Run. On peut le relancer sans rien casser.
-- Le site ne parle jamais à ces tables directement : seul le serveur (clé « service_role ») y accède.

create table if not exists public.profiles (
  id uuid primary key references auth.users (id) on delete cascade,
  email text,
  plan text not null default 'free',
  credits integer not null default 0 check (credits >= 0),
  admin boolean not null default false,
  stripe_customer text,
  stripe_subscription text,
  created_at timestamptz not null default now()
);

-- Chaque mouvement de crédits, une ligne. « ref » est unique par compte : un même paiement, un même épisode
-- ou un même remboursement ne peut pas être compté deux fois.
create table if not exists public.ledger (
  id bigserial primary key,
  user_id uuid not null references public.profiles (id) on delete cascade,
  ref text not null,
  delta integer not null,
  reason text,
  created_at timestamptz not null default now(),
  unique (user_id, ref)
);
create index if not exists ledger_user_day on public.ledger (user_id, created_at desc);

create table if not exists public.episodes (
  id text primary key,
  user_id uuid not null references public.profiles (id) on delete cascade,
  job text,
  title text,
  model text,
  duration integer,
  cost integer not null default 0,
  resolution text,
  segments jsonb,
  plan jsonb,
  verdict jsonb,
  stored_path text,
  created_at timestamptz not null default now()
);
create index if not exists episodes_user on public.episodes (user_id, created_at desc);

create table if not exists public.characters (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references public.profiles (id) on delete cascade,
  name text not null,
  image text not null,
  created_at timestamptz not null default now()
);
create index if not exists characters_user on public.characters (user_id, created_at desc);

-- Tout est fermé aux visiteurs : aucune règle d'accès, donc seule la clé « service_role » du serveur passe.
alter table public.profiles enable row level security;
alter table public.ledger enable row level security;
alter table public.episodes enable row level security;
alter table public.characters enable row level security;

-- Crée le profil à la première visite, avec les crédits de bienvenue. Renvoie le profil.
create or replace function public.ensure_profile(p_id uuid, p_email text, p_welcome integer)
returns public.profiles language plpgsql security definer set search_path = public as $$
declare r public.profiles;
begin
  insert into public.profiles (id, email, credits) values (p_id, p_email, greatest(p_welcome, 0))
    on conflict (id) do nothing;
  if found and p_welcome > 0 then
    insert into public.ledger (user_id, ref, delta, reason) values (p_id, 'bienvenue', p_welcome, 'Crédits de bienvenue')
      on conflict do nothing;
  end if;
  select * into r from public.profiles where id = p_id;
  return r;
end $$;

-- Débite une seule fois par référence. Renvoie le solde, ou -1 s'il n'y a pas assez de crédits (rien n'est alors débité).
create or replace function public.spend_once(p_id uuid, p_ref text, p_amount integer, p_reason text)
returns integer language plpgsql security definer set search_path = public as $$
declare bal integer;
begin
  if p_amount <= 0 then
    select credits into bal from public.profiles where id = p_id; return coalesce(bal, 0);
  end if;
  insert into public.ledger (user_id, ref, delta, reason) values (p_id, p_ref, -p_amount, p_reason)
    on conflict (user_id, ref) do nothing;
  if not found then
    select credits into bal from public.profiles where id = p_id; return coalesce(bal, 0);
  end if;
  update public.profiles set credits = credits - p_amount where id = p_id and credits >= p_amount returning credits into bal;
  if bal is null then
    delete from public.ledger where user_id = p_id and ref = p_ref;
    return -1;
  end if;
  return bal;
end $$;

-- Crédite une seule fois par référence (achat, renouvellement, remboursement). Renvoie le solde.
create or replace function public.grant_once(p_id uuid, p_ref text, p_amount integer, p_reason text)
returns integer language plpgsql security definer set search_path = public as $$
declare bal integer;
begin
  insert into public.ledger (user_id, ref, delta, reason) values (p_id, p_ref, p_amount, p_reason)
    on conflict (user_id, ref) do nothing;
  if found then
    update public.profiles set credits = credits + p_amount where id = p_id returning credits into bal;
  else
    select credits into bal from public.profiles where id = p_id;
  end if;
  return coalesce(bal, 0);
end $$;

-- Ces fonctions ne sont appelables que par le serveur.
revoke all on function public.ensure_profile(uuid, text, integer) from public, anon, authenticated;
revoke all on function public.spend_once(uuid, text, integer, text) from public, anon, authenticated;
revoke all on function public.grant_once(uuid, text, integer, text) from public, anon, authenticated;
grant execute on function public.ensure_profile(uuid, text, integer) to service_role;
grant execute on function public.spend_once(uuid, text, integer, text) to service_role;
grant execute on function public.grant_once(uuid, text, integer, text) to service_role;

-- Le dossier privé où sont gardées les vidéos montées.
insert into storage.buckets (id, name, public) values ('videos', 'videos', false) on conflict (id) do nothing;

-- Pour te donner les crédits illimités d'administrateur, une fois ton compte créé sur le site :
--   update public.profiles set admin = true where email = 'ton@email';
