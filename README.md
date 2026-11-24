# Builders

A small community gaming platform: accounts, a blocky 3D avatar, a marketplace
(one hat, one shirt, one pair of pants), a forum and games.

## 1. Requirements

- **Node.js LTS** (includes `npm`) - download it from https://nodejs.org
  - Install it with the default options ("Add to PATH" must stay checked).
  - Close and re-open your terminal afterwards.
  - Check it works: `node -v` and `npm -v` should print version numbers.

## 2. Run the site

### Windows (easiest)
Double-click **`start.bat`**. It installs what is missing and starts the site.

### Any system (terminal)
Open a terminal **inside the `builders` folder**, then run:

```
npm install
npm start
```

Open the site: **http://localhost:3000**

> The "plain" zip already contains `node_modules`, so `npm install` is optional there.
> The GitHub zip does not contain `node_modules`, so you must run `npm install`.

## 3. Settings (optional)

Copy `.env.example` to a new file named `.env` and edit it:

| Setting | What it is |
| --- | --- |
| `SESSION_SECRET` | Any long random text. Keep it private. |
| `BASE_URL` | Public address of your site, no slash at the end. Leave empty for local testing. |
| `SMTP_*`, `REPORT_TO` | E-mail sending for the Help/report form. |
| `PAYPAL_*` | PayPal keys for buying coins and Pluse. |

Never share or upload your `.env` file.

You can also run the setup wizard: `npm run setup`.

## 4. Make yourself admin

1. Open the site and create an account (Sign up).
2. Open `admins/admins.json` and replace `YourNickname` with your nickname.
3. Reload the site - the **Admin** button appears in the top bar.

## 5. Useful commands

| Command | What it does |
| --- | --- |
| `npm start` | Start the site |
| `npm run setup` | Setup wizard for `.env` |
| `npm run reset` | Delete ALL accounts and account data (stop the server first!) |
| `npm run test-mail` | Send a test e-mail |

On Windows you can double-click `reset_accounts.bat` instead of `npm run reset`.

## 6. Folders

| Folder | Contents |
| --- | --- |
| `costumes/` | Marketplace items (hat, shirt, pants). See `costumes/README.md` to add more. |
| `animations/` | Animations (Wave) |
| `codes/` | Redeem codes |
| `admins/` | Admin list |
| `places/`, `events/`, `emojis/`, `ads/` | Optional content (see the README inside each) |
| `data/` | Accounts, forum and avatars - created and filled by the site |
| `public/`, `views/` | Website files (CSS, 3D avatar, pages) |

## 7. Troubleshooting

- **`'npm' is not recognized`** - Node.js is not installed, or the terminal was not
  re-opened after installing it.
- **`Cannot find module ...`** - run `npm install` inside the `builders` folder.
- **Port 3000 is busy** - close the other program, or start with another port:
  `set PORT=3001 && npm start` (Windows cmd) or `PORT=3001 npm start` (Linux/macOS).
- **Old design after an update** - press Ctrl+F5 in the browser.
- **Old accounts still there** - stop the server and run `npm run reset`.

## 8. Putting it on GitHub

Use `builders-github.zip`. It has no accounts, no `.env` and no `node_modules`,
and a `.gitignore` that keeps them out of the repository.
