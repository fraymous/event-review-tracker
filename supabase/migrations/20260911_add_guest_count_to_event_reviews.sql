alter table event_reviews
add column if not exists guest_count integer check (guest_count is null or guest_count >= 0);
