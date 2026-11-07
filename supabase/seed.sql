-- The two-item PunchPay demo story. Idempotent.
insert into public.projects (id, title, homeowner_name, contractor_name, location)
values ('5ab5943f-3c10-498e-82a0-029c3837684a', 'The Oak Street renovation', 'Alex Morgan', 'Mason & Co.', 'Austin, TX')
on conflict (id) do nothing;

insert into public.punch_items (id, project_id, slug, title, location, description, acceptance_criteria, amount_cents)
values
  ('d28cf4a1-2c7a-49c5-9821-115cbe6c1d11', '5ab5943f-3c10-498e-82a0-029c3837684a', 'paint', 'Paint touch-up', 'Living room · North wall',
   'Repair the scuffed paint beside the window.',
   'Scuff no longer visibly apparent; finish looks uniform with the surrounding wall; after photo shows the same wall area as the before photo.', 3000),
  ('d28cf4a1-2c7a-49c5-9821-115cbe6c1d22', '5ab5943f-3c10-498e-82a0-029c3837684a', 'tile', 'Tile repair', 'Kitchen · Backsplash',
   'Replace the cracked tile near the sink.',
   'Replaced tile appears uncracked; tile sits flush and aligned with adjacent tiles; grout lines look continuous around the tile.', 2000)
on conflict (id) do nothing;
