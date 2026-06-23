# Umgebungen: Produktion (1.0) & Entwicklung — Workflow

ToDo Maki läuft in **zwei komplett getrennten Umgebungen**. Beide sind als App aufs iPhone/Mac installierbar.

| | **Produktion (stabil)** | **Entwicklung (Test)** |
|---|---|---|
| URL | https://marckill78.github.io/todo-maki/ | https://marckill78.github.io/todo-maki-dev/ |
| Repo | `marckill78/todo-maki` | `marckill78/todo-maki-dev` |
| Branch (lokal) | `main` | `dev` |
| App-Name (installiert) | ToDo Maki | **Maki DEV** (oranges „DEV"-Badge) |
| Stand | **v1.0** (für deinen Alltag) | v32+ (neue Features) |
| Lokale Daten (IndexedDB) | `todo-maki` | `todo-maki-dev` |
| Cloud-Sync (Firebase) | **an** | **aus** |

## Warum die Daten sicher getrennt sind

Beide Apps liegen auf derselben Domain `marckill78.github.io`. Damit sie sich nicht ins Gehege kommen, erkennt der Code automatisch an der URL (`…/todo-maki-dev/`):

- **Eigene lokale Datenbank** (`todo-maki-dev`) → Dev sieht/ändert die echten 1.0-Daten nie.
- **Cloud-Sync in Dev abgeschaltet** → Dev kann nichts in dein echtes Firebase schreiben.
- **Eigener Cache-Namespace** (`maki-dev-*`) → kein geteilter App-Shell-Cache.

→ Du kannst in der Dev-App alles ausprobieren (löschen, Chaos machen), deine echte 1.0-Sammlung bleibt unberührt.

> Realistische Testdaten in Dev bekommst du per **Backup-Export in 1.0 → Backup-Import in Dev** (Einstellungen).

## Täglicher Workflow

### Neue Features entwickeln/testen
```bash
git checkout dev
# … Code ändern, lokal testen (Start-ToDo-Maki.command) …
# Version hochzählen (APP_VERSION, ?v=N, maki-…-vN in sw.js, version.json)
git add -A && git commit -m "feat: …"
git push dev-origin dev:main        # → deployt nach …/todo-maki-dev/
```
Auf iPhone/Mac in der **Maki-DEV**-App testen.

### Ein Feature für 1.0 freigeben (Release)
Wenn ein Dev-Stand reif für die Produktion ist:
```bash
git checkout main
git checkout dev -- js styles.css sw.js   # Funktionscode aus dev übernehmen
# NICHT übernehmen: index.html-/manifest-Branding („Maki DEV") bleibt Prod-Branding
# Versionen in main bumpen (APP_VERSION, ?v=N, maki-vN, version.json)
git add -A && git commit -m "release: … (v1.x)"
git push origin main                # → deployt nach …/todo-maki/ (deine echten Geräte updaten automatisch)
git tag -a v1.x -m "…" && git push origin v1.x
```

## Wichtig

- **Prod-Branding nie mit Dev-Branding überschreiben:** `manifest.webmanifest` (Name) und das `apple-mobile-web-app-title`-Meta unterscheiden sich bewusst je Repo. Der restliche Code ist identisch (URL-basierte Erkennung).
- Bei jedem Deploy **alle Versionsstellen** mitziehen: `APP_VERSION` (app.js), `?v=N` (index.html + sw.js), Cache-Name in sw.js, `version.json`.
- `dev`-Branch wird zusätzlich auf `origin` (Prod-Repo) gesichert — Verlustschutz.
