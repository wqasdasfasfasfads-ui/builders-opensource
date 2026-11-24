# admins

`admins.json` decides who is an **admin** and who is a **forumadmin**.

```json
{
  "Vasya":  { "admin": true,  "forumadmin": true  },
  "Petro":  { "admin": false, "forumadmin": true  }
}
```

- The key is the player's **nickname** (not case sensitive) or their **user id**
  (the long id you see in the address of their profile page: `/profile/<id>`).
- `admin: true` - gets the **Admin** page in the top bar and can ban players
  for any time they choose (minutes / hours / days / forever) and unban them.
  Admins can't ban other admins.
- `forumadmin: true` - can delete forum posts and comments.
  (A role does not include the other one - set both to `true` for both.)
- Edit the file and save - it is re-read on every request, no restart needed.

Safety tip: use the **user id** as the key if you can. A nickname key works for
whoever owns that nickname, so register your own account first, and note that
if an admin renames themselves the nickname key stops matching.
