-- Set admin role for a user (Legion FlyFF)
-- Replace 'your-admin@gmail.com' with the actual admin email.
-- Run this in SQL Server Management Studio or your SQL client.

UPDATE WEBSITE_DBF.dbo.REGISTERED_USERS
SET role = 'super'
WHERE email = 'your-admin@gmail.com';

-- To revoke admin, run:
-- UPDATE WEBSITE_DBF.dbo.REGISTERED_USERS SET role = 'user' WHERE email = 'your-admin@gmail.com';
