-- Run only in a dedicated Design Drift Supabase project. Do not apply to the user's existing portfolio or Desk OS projects.
create extension if not exists pgcrypto;
create table if not exists public.dd_workspaces (
 id uuid primary key default gen_random_uuid(), owner_github_id bigint not null,
 repo text not null, branch text not null default 'main', token_path text not null,
 figma_file_key text not null, figma_collection text not null,
 auto_safe boolean not null default false, auto_tokens text[] not null default '{}',
 github_installation_id bigint,
 plugin_key_hash text,
 created_at timestamptz not null default now(), updated_at timestamptz not null default now(),
 unique(owner_github_id, repo, branch, figma_file_key)
);
create table if not exists public.dd_snapshots (
 id uuid primary key default gen_random_uuid(), workspace_id uuid not null references public.dd_workspaces(id) on delete cascade,
 figma_file_key text not null, collection text not null, captured_at timestamptz not null default now(),
 actor jsonb not null default '{}', tokens jsonb not null, source text not null default 'plugin',
 unique(workspace_id, captured_at)
);
create table if not exists public.dd_changes (
 id uuid primary key default gen_random_uuid(), workspace_id uuid not null references public.dd_workspaces(id) on delete cascade,
 source_sha text not null, name text not null, kind text not null default 'variable', token_type text not null,
 expected jsonb not null, proposed jsonb not null, status text not null default 'pending_review'
 check (status in ('pending_review','queued_auto','queued_approved','applying','applied','conflict','failed','dismissed')),
 classification text not null, source_actor text, source_url text, approved_by bigint,
 updated_at timestamptz not null default now(), created_at timestamptz not null default now(),
 unique(workspace_id,source_sha,name)
);
create table if not exists public.dd_audit (
 id uuid primary key default gen_random_uuid(), workspace_id uuid not null references public.dd_workspaces(id) on delete cascade,
 change_id uuid references public.dd_changes(id) on delete set null,
 event text not null, actor_kind text not null, actor text not null, source_sha text,
 detail jsonb not null default '{}', at timestamptz not null default now()
);
create table if not exists public.dd_deliveries (
 delivery_id text primary key, received_at timestamptz not null default now()
);
create index if not exists dd_change_workspace on public.dd_changes(workspace_id,created_at desc);
create index if not exists dd_audit_workspace on public.dd_audit(workspace_id,at desc);
create index if not exists dd_snapshot_workspace on public.dd_snapshots(workspace_id,captured_at desc);
alter table public.dd_workspaces enable row level security;
alter table public.dd_snapshots enable row level security;
alter table public.dd_changes enable row level security;
alter table public.dd_audit enable row level security;
alter table public.dd_deliveries enable row level security;
-- No anon/authenticated policies: backend uses service key after verifying GitHub identity or plugin pairing key.
revoke all on public.dd_workspaces, public.dd_snapshots, public.dd_changes, public.dd_audit, public.dd_deliveries from anon, authenticated;
