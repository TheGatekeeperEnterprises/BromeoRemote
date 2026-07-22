# BromeoRemote website op Coolify

`website/` is de publieke website voor `bromeoremote.com`. De website bevat downloadknoppen, contactformulier, release-aanmelding, downloadstatistiek, PostgreSQL-opslag en SMTP-mail.

## 1. GitHub Desktop

Open de map `D:\BromeoRemote` in GitHub Desktop en publiceer de repository naar GitHub. Let op:

- Commit geen `.env`-bestanden.
- Zet echte wachtwoorden alleen in Coolify environment variables.
- De huidige `.git`-map lijkt leeg; als GitHub Desktop dit niet als repository ziet, kies dan `Create a new repository from existing files`.

## 2. Coolify project

Maak in Coolify een nieuw project aan:

1. Voeg een PostgreSQL 17 database toe.
2. Voeg een nieuwe app toe vanuit je GitHub repository.
3. Kies `Dockerfile`.
4. Zet `Base Directory` op `website`.
5. Zet de interne poort op `3000`.
6. Zet de healthcheck op `/health`.
7. Koppel domein `bromeoremote.com` en laat Coolify HTTPS regelen.

## 3. Environment variables

Gebruik deze waarden als basis. Het SMTP-wachtwoord hoort alleen in Coolify te staan.

```env
NODE_ENV=production
PORT=3000
PUBLIC_BASE_URL=https://bromeoremote.com
DATABASE_URL=<de PostgreSQL connection string van Coolify>

SMTP_HOST=mail.thegatekeeperenterprises.com
SMTP_PORT=465
SMTP_SECURE=true
SMTP_USER=info@bromeoremote.com
SMTP_PASS=<coolify secret>
SMTP_FROM=info@bromeoremote.com
SMTP_TO=info@bromeoremote.com

DOWNLOAD_WINDOWS_URL=https://updates.bromeoremote.com/BromeoRemote-Installer.exe
DOWNLOAD_WINDOWS_PORTABLE_URL=https://updates.bromeoremote.com/BromeoRemote-Setup.exe
DOWNLOAD_ANDROID_URL=https://downloads.bromeoremote.com/BromeoRemote-Android.apk
SIGNALING_STATUS_URL=https://remote.bromeoremote.com/health
```

## 4. Downloads hosten

Voor de Windows installer kun je de bestaande updateflow gebruiken:

- `client/release/BromeoRemote-Installer.exe`
- `client/release/BromeoRemote-Installer.exe.blockmap`
- `client/release/latest.yml`

Zet deze bijvoorbeeld op `updates.bromeoremote.com`.

Voor Android kun je tijdelijk de debug/release APK hosten op `downloads.bromeoremote.com`, maar voor publiek gebruik is een release build met eigen signing key beter.

## 5. Controle na deploy

Controleer na deployment:

```bash
curl https://bromeoremote.com/health
```

Verwacht: `status: "ok"`. Als de database niet bereikbaar is, wordt de healthcheck `degraded`.
