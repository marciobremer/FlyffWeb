# legionflyff
Legion FlyFF - Ultimate Private Server Experience

## Admin role

Admin access uses the **`super`** role. The role is stored in the database and put into the session at login.

### How it works

- **Table:** `WEBSITE_DBF.dbo.REGISTERED_USERS`
- **Column:** `role` (e.g. `'user'` or `'super'`)
- **Login** (`/api/login`) reads `role` and stores it in the session cookie.
- **Navbar** and **Admin Panel** (`/admin`) allow access when `role === 'super'`.

### Set an admin user

1. Have a registered, verified user (e.g. `admin@gmail.com`).
2. In SQL Server, run:

```sql
UPDATE WEBSITE_DBF.dbo.REGISTERED_USERS
SET role = 'super'
WHERE email = 'your-admin@gmail.com';
```

3. That user logs in again; they will see the Admin dropdown and can open `/admin`.

To revoke admin, set the role back to `'user'`:

```sql
UPDATE WEBSITE_DBF.dbo.REGISTERED_USERS
SET role = 'user'
WHERE email = 'your-admin@gmail.com';
```
