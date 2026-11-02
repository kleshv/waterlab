-- WaterLab финансы: структура базы и права доступа.
-- Одна таблица документов (как в нынешнем кабинете): коллекция + id + данные JSON.

create table if not exists public.docs (
  col        text        not null,
  id         text        not null,
  data       jsonb       not null,
  updated_at timestamptz not null default now(),
  updated_by text        default (auth.jwt() ->> 'email'),
  primary key (col, id)
);

-- Список тех, кому разрешён доступ. Даже если кто-то получит учётку в Supabase,
-- без email в этом списке он ничего не увидит.
create table if not exists public.allowed_users (
  email text primary key,
  name  text not null
);

-- Журнал изменений: кто, когда и что поменял (на случай ошибки можно восстановить).
create table if not exists public.docs_history (
  hid        bigserial   primary key,
  col        text        not null,
  id         text        not null,
  op         text        not null,
  old_data   jsonb,
  new_data   jsonb,
  changed_at timestamptz not null default now(),
  changed_by text        default (auth.jwt() ->> 'email')
);

create or replace function public.is_allowed() returns boolean
language sql stable security definer set search_path = public as $$
  select exists (select 1 from public.allowed_users where lower(email) = lower(auth.jwt() ->> 'email'));
$$;

create or replace function public.docs_audit() returns trigger
language plpgsql security definer set search_path = public as $$
begin
  if tg_op = 'UPDATE' then
    new.updated_at := now();
    new.updated_by := auth.jwt() ->> 'email';
  end if;
  insert into public.docs_history(col, id, op, old_data, new_data)
  values (coalesce(new.col, old.col), coalesce(new.id, old.id), tg_op,
          case when tg_op in ('UPDATE','DELETE') then old.data end,
          case when tg_op in ('INSERT','UPDATE') then new.data end);
  return coalesce(new, old);
end $$;

drop trigger if exists docs_audit_ins on public.docs;
drop trigger if exists docs_audit_upd on public.docs;
drop trigger if exists docs_audit_del on public.docs;
create trigger docs_audit_ins after insert on public.docs for each row execute function public.docs_audit();
create trigger docs_audit_upd before update on public.docs for each row execute function public.docs_audit();
create trigger docs_audit_del after delete on public.docs for each row execute function public.docs_audit();

-- Права: без входа — ничего; с входом — только пользователи из allowed_users.
alter table public.docs          enable row level security;
alter table public.allowed_users enable row level security;
alter table public.docs_history  enable row level security;

drop policy if exists docs_select on public.docs;
drop policy if exists docs_insert on public.docs;
drop policy if exists docs_update on public.docs;
drop policy if exists docs_delete on public.docs;
create policy docs_select on public.docs for select to authenticated using (public.is_allowed());
create policy docs_insert on public.docs for insert to authenticated with check (public.is_allowed());
create policy docs_update on public.docs for update to authenticated using (public.is_allowed()) with check (public.is_allowed());
create policy docs_delete on public.docs for delete to authenticated using (public.is_allowed());

drop policy if exists allowed_select on public.allowed_users;
create policy allowed_select on public.allowed_users for select to authenticated using (public.is_allowed());

drop policy if exists history_select on public.docs_history;
create policy history_select on public.docs_history for select to authenticated using (public.is_allowed());

revoke all on public.docs, public.allowed_users, public.docs_history from anon;
grant select, insert, update, delete on public.docs to authenticated;
grant select on public.allowed_users, public.docs_history to authenticated;

-- Живые обновления: изменения одного пользователя сразу видны остальным.
do $$ begin
  alter publication supabase_realtime add table public.docs;
exception when duplicate_object then null; end $$;
