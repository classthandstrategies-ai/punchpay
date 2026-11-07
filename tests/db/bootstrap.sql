-- Minimal stand-ins for objects Supabase provides, so the real migration runs on plain Postgres.
create role anon nologin;
create role authenticated nologin;
create role service_role nologin bypassrls;
create schema storage;
create table storage.buckets (
  id text primary key, name text not null, public boolean default false,
  file_size_limit bigint, allowed_mime_types text[]
);
-- Supabase gives service_role full table privileges through default privileges; mirror that so the
-- migration's revokes and the guards are tested against the role the app server really uses.
alter default privileges in schema public grant all on tables to service_role;
alter default privileges in schema public grant all on functions to service_role;
grant usage on schema public to service_role, anon, authenticated;
