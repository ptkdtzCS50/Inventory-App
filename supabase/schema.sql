-- =====================================================================
-- Gerätefuhrpark – Supabase-Schema für den gemeinsamen Datenbestand
--
-- Ein-Dokument-Modell (Prototyp): Der komplette Datenbestand liegt als
-- JSON in einer Zeile. Das hält die App einfach und reicht für ein
-- Institut mit überschaubarer Gerätezahl völlig aus. Bei gleichzeitigen
-- Änderungen gewinnt der zuletzt Speichernde (die App gleicht sich alle
-- 30 Sekunden mit der Cloud ab).
--
-- Ausführen: Supabase-Dashboard → SQL Editor → Inhalt einfügen → Run
--
-- © Dietz-Engineering · Alle Rechte vorbehalten
-- Designed by Dietz-Engineering · Initiiert von Christoph Lüttgens
-- =====================================================================

create table if not exists public.fuhrpark_state (
  id integer primary key,
  daten jsonb not null,
  updated_at timestamptz not null default now()
);

alter table public.fuhrpark_state enable row level security;

-- Prototyp-Policies: Jeder mit dem anon-Key darf lesen und schreiben.
-- Der anon-Key sollte daher nur im Institut weitergegeben werden.
-- Für echten Schutz später Supabase-Auth ergänzen und diese Policies
-- auf authentifizierte Nutzer einschränken.
create policy "fuhrpark lesen"          on public.fuhrpark_state for select using (true);
create policy "fuhrpark anlegen"        on public.fuhrpark_state for insert with check (true);
create policy "fuhrpark aktualisieren"  on public.fuhrpark_state for update using (true);
