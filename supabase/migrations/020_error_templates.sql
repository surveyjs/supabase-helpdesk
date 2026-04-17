-- Phase 22: Error page templates
-- Insert configurable error page templates into app_settings

INSERT INTO app_settings (key, value) VALUES
  ('error_template_404', '# {{statusCode}} — Page Not Found

The page you were looking for doesn''t exist.

[Go to home page]({{homeUrl}})'),
  ('error_template_403', '# {{statusCode}} — Access Denied

{{message}}

You don''t have permission to access this page.

[Go to home page]({{homeUrl}})'),
  ('error_template_500', '# {{statusCode}} — Something Went Wrong

{{message}}

An unexpected error occurred. Please try again later.

[Go to home page]({{homeUrl}})'),
  ('error_template_csat_token_error', '# Survey Unavailable

{{message}}

This survey link has expired or has already been used.

[Go to login]({{homeUrl}}/login)')
ON CONFLICT (key) DO NOTHING;
