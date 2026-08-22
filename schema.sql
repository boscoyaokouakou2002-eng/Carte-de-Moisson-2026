-- ============================================================
-- Carte de la Moisson — schéma Supabase
-- À exécuter dans Supabase > SQL Editor > New query > Run
-- ============================================================

-- Table des chambres (une ligne par chambre, créée seulement
-- quand elle est modifiée pour la première fois)
create table if not exists rooms (
  id text primary key,              -- ex. 'B-27' (Centre) ou '1-12' (Sud)
  campus text not null default 'centre', -- 'centre' ou 'sud'
  building text not null,
  number int not null,
  occupants int not null default 2, -- 1 ou 2 étudiants dans cette chambre
  student1_reached boolean not null default false,
  student1_by text,
  student1_at timestamptz,
  student2_reached boolean not null default false,
  student2_by text,
  student2_at timestamptz,
  updated_at timestamptz not null default now()
);

-- Si la table "rooms" existe déjà depuis une version précédente de
-- l'application, exécute ces lignes pour ajouter les nouvelles colonnes :
-- alter table rooms add column if not exists occupants int not null default 2;
-- alter table rooms add column if not exists campus text not null default 'centre';

create index if not exists idx_rooms_campus on rooms(campus);

-- Historique des visites (append-only, jamais modifié)
create table if not exists visits (
  id uuid primary key default gen_random_uuid(),
  room_id text not null references rooms(id) on delete cascade,
  student int not null check (student in (1,2)),
  action text not null,             -- 'atteint' ou 'annulé'
  by_name text not null,
  at timestamptz not null default now()
);

create index if not exists idx_visits_room on visits(room_id);
create index if not exists idx_rooms_updated on rooms(updated_at);

-- Active la réplication temps réel (pour que les autres frères
-- voient les changements instantanément quand ils sont en ligne)
alter publication supabase_realtime add table rooms;
alter publication supabase_realtime add table visits;

-- ============================================================
-- Sécurité (RLS)
-- ============================================================
-- Ce projet est pensé pour une petite équipe de confiance qui
-- partage un même lien d'application. On active RLS mais on
-- autorise toute lecture/écriture avec la clé "anon" publique,
-- car il n'y a pas de système de comptes/mots de passe ici.
-- Si tu veux restreindre l'accès plus tard, remplace ces
-- politiques par une vérification d'authentification Supabase.
-- ============================================================

alter table rooms enable row level security;
alter table visits enable row level security;

create policy "Lecture publique des chambres" on rooms
  for select using (true);

create policy "Écriture publique des chambres" on rooms
  for insert with check (true);

create policy "Mise à jour publique des chambres" on rooms
  for update using (true);

create policy "Lecture publique de l'historique" on visits
  for select using (true);

create policy "Écriture publique de l'historique" on visits
  for insert with check (true);
