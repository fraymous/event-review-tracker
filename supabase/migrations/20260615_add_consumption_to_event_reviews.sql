alter table event_reviews
add column if not exists consumption jsonb not null default '{}'::jsonb;
