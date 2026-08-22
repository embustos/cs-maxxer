-- Login now refuses unverified accounts (routes/auth.js). Accounts that predate the
-- gate were created when verification didn't exist as a requirement — locking them out
-- retroactively would include the owner's own account. Grandfather them.
--
-- New rows are unaffected: the column has no default, so every account created after
-- this migration starts unverified and must click its link.
update users set email_verified_at = now() where email_verified_at is null;
