-- ============================================================
-- Phase 2 — Auth enhancements
-- ============================================================

-- Update handle_new_user to reject reserved display names
CREATE OR REPLACE FUNCTION handle_new_user()
RETURNS TRIGGER AS $$
DECLARE
  _display_name TEXT;
BEGIN
  _display_name := COALESCE(
    NEW.raw_user_meta_data->>'display_name',
    NEW.raw_user_meta_data->>'name',
    split_part(NEW.email, '@', 1)
  );

  IF _display_name LIKE 'Deleted User #%' THEN
    RAISE EXCEPTION 'Display names starting with "Deleted User #" are reserved';
  END IF;

  INSERT INTO public.profiles (id, email, display_name)
  VALUES (NEW.id, NEW.email, _display_name);

  RETURN NEW;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

-- Add CHECK constraint on profiles table
ALTER TABLE profiles ADD CONSTRAINT chk_display_name_not_reserved
  CHECK (display_name NOT LIKE 'Deleted User #%');
