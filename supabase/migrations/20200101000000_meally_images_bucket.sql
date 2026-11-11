-- Private bucket for recipe images. The function reads/writes it with the service-role key and hands the
-- browser short-lived signed URLs, so no storage policies are needed (RLS stays closed).
insert into storage.buckets (id, name, public)
values ('meally-images', 'meally-images', false)
on conflict (id) do nothing;
