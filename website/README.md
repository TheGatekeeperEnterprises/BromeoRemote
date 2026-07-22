# BromeoRemote website

Publieke website voor `bromeoremote.com`. Deze app draait als losse Node/Express service en is bedoeld voor Coolify met PostgreSQL 17 en SMTP.

## Lokaal starten

```bash
cd website
npm install
copy .env.example .env
npm run dev
```

Open daarna `http://localhost:3000`.

## Coolify

Gebruik in Coolify deze instellingen:

- Build type: Dockerfile
- Base directory: `website`
- Dockerfile: `Dockerfile`
- Port: `3000`
- Healthcheck path: `/health`
- Database: PostgreSQL 17

Zet de echte environment variables in Coolify. Commit geen `.env` en zet het SMTP-wachtwoord nooit in GitHub.

Minimaal nodig:

```env
NODE_ENV=production
PORT=3000
PUBLIC_BASE_URL=https://bromeoremote.com
DATABASE_URL=postgresql://...
SMTP_HOST=mail.thegatekeeperenterprises.com
SMTP_PORT=465
SMTP_SECURE=true
SMTP_USER=info@bromeoremote.com
SMTP_PASS=<coolify-secret>
SMTP_FROM=info@bromeoremote.com
SMTP_TO=info@bromeoremote.com
DOWNLOAD_WINDOWS_URL=https://updates.bromeoremote.com/BromeoRemote-Installer.exe
DOWNLOAD_ANDROID_URL=https://downloads.bromeoremote.com/BromeoRemote-Android.apk
```

De database-tabellen worden bij het opstarten automatisch aangemaakt. Het SQL-schema staat ook in `sql/schema.sql` voor handmatige controle.
