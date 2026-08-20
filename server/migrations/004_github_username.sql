-- Which GitHub account to check commit activity for. Nullable: the feature is optional.
alter table users add column if not exists github_username text;
