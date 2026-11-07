-- The two-item PunchPay demo story. Idempotent.
insert into public.projects (id, title, homeowner_name, contractor_name, location)
values ('5ab5943f-3c10-498e-82a0-029c3837684a', 'The Oak Street renovation', 'Alex Morgan', 'Mason & Co.', 'Austin, TX')
on conflict (id) do nothing;

insert into public.punch_items (id, project_id, slug, title, location, description, acceptance_criteria, amount_cents)
values
  ('d28cf4a1-2c7a-49c5-9821-115cbe6c1d11', '5ab5943f-3c10-498e-82a0-029c3837684a', 'paint', 'Paint touch-up', 'Living room · North wall',
   'Repair the scuffed paint beside the window.',
   'Scuff no longer visibly apparent; finish is reasonably uniform in submitted after-photo; include a wide context shot and a close-up.', 3000),
  ('d28cf4a1-2c7a-49c5-9821-115cbe6c1d22', '5ab5943f-3c10-498e-82a0-029c3837684a', 'tile', 'Tile repair', 'Kitchen · Backsplash',
   'Replace the cracked tile near the sink.',
   'Tile appears uncracked and aligned with adjacent tiles; grout line visually continuous; include before photo and clear close-up of repair.', 2000)
on conflict (id) do nothing;
