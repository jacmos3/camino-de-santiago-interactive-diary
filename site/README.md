# MyCamino - Diario interattivo del Cammino Francese

Questo progetto racconta un viaggio reale, giorno per giorno, combinando:
- tracce GPS
- foto e video geolocalizzati
- note narrative multilingua
- mappa interattiva e pagine canoniche per ogni giorno

L'obiettivo non e solo mostrare media, ma ricostruire il cammino in modo leggibile e verificabile: ogni contenuto punta a un contesto (luogo, ora, tappa, nota del giorno).

## Cosa c'e dentro

- `index.html`: diario interattivo principale
- `map.html`: mappa completa del percorso
- `app.js`, `map.js`, `styles.css`: logica UI e rendering
- `data/entries.{it,en,es,fr}.json`: note e media per lingua
- `data/tracks/index.json` + `data/tracks/day/*.json`: punti GPS per giorno
- `data/comments.json`: storage commenti (fallback file)
- `api/index.php`: API PHP (commenti, contatti, admin, analytics)
- `conchiglia-nera.html`: pannello admin
- `contatti.html`: pagina contatti/template

## Filosofia del progetto

Il diario e stato ricostruito molto tempo dopo il viaggio, ma usando fonti concrete:
- tracking registrato sul momento
- metadata estratti da foto/video
- appunti, chat, audio e ricordi

Non e una trascrizione totale: e una ricostruzione fedele ma editoriale. Alcuni dettagli restano volutamente fuori per mantenere leggibilita.

## Avvio locale

Serve Node solo in locale per il server statico/API dev:

```bash
cd /Volumes/HardDisk/Cammino\ di\ Santiago/site
HOST=127.0.0.1 PORT=4173 node server.js
```

Apri:
- `http://127.0.0.1:4173/it/`
- `http://127.0.0.1:4173/en/`
- `http://127.0.0.1:4173/es/`
- `http://127.0.0.1:4173/fr/`

## Deploy su hosting PHP (senza Node)

Pubblica la cartella `deploy-runtime/` sul server.

Elementi essenziali:
- static: `index.html`, `map.html`, `app.js`, `map.js`, `styles.css`, favicon, sitemap, robots
- data: `entries.*.json`, `tracks/*`, `comments.json`, `ui_flags.json`
- media: `assets/img`, `assets/thumb`, `assets/poster`, `assets/video_resized`
- API: `api/index.php` (+ eventuale `.env` lato server)
- rewrite: `.htaccess`

## Configurazione

Variabili comuni in `.env`:
- `ADMIN_PASSWORD`
- `CONTACT_TO_EMAIL`
- `CONTACT_FROM_EMAIL`
- `ANALYTICS_ENABLED`
- `ANALYTICS_MYSQL_HOST`, `ANALYTICS_MYSQL_PORT`
- `ANALYTICS_MYSQL_DB`, `ANALYTICS_MYSQL_USER`, `ANALYTICS_MYSQL_PASSWORD`

Se analytics e abilitato ma il DB non e raggiungibile, il sito resta operativo: fallisce solo la parte analytics.

## Dati non runtime

Materiale di lavoro/editoriale e script storici sono stati spostati in:
- `metadata_only/`

Quella cartella non e necessaria al funzionamento del sito pubblico.

## Branch media (asset separati)

Gli asset pesanti non stanno su `main`: sono mantenuti nel branch `codex/assets-media`.

Workflow consigliato per avere tutto in locale:

```bash
cd /Volumes/HardDisk/Cammino\ di\ Santiago/site
git fetch origin

# 1) aggiorna codice applicativo
git checkout main
git pull origin main

# 2) aggiorna branch asset
git checkout codex/assets-media
git pull origin codex/assets-media

# 3) torna su main per lavorare
git checkout main
```

Se ti servono i media mentre sei su `main`, copia/sincronizza le cartelle `assets/*` dal branch `codex/assets-media` nella tua working copy locale prima del deploy.

## Troubleshooting rapido

- Media bianchi o 404: verifica che le sottocartelle `assets/*/YYYY-MM-DD/` siano state caricate.
- API 404 su hosting: controlla rewrite `.htaccess` e path `api/index.php`.
- Commenti non visibili: verifica permessi scrittura su `data/comments.json` (o DB se usi backend SQL).
- Mappa giorno vuota: verifica `data/tracks/index.json` e i file in `data/tracks/day/`.

## TODO

- Refactor URL pubblici del diario per non esporre l'anno/data del viaggio:
  mantenere la `date` come chiave interna stabile nei dati e nel mapping media/GPS,
  ma introdurre URL pubblici basati sul numero giorno (`/day/1/`, `/day/2/`) e `/day/prologo/`.
- Gestire redirect `301` dagli URL attuali basati sulla data verso i nuovi URL pubblici numerici.
- Valutare alias anche per la mappa (`?day=4`, `?day=prologo`) risolti internamente alla data reale.
- Sostituire i placeholder legali/fiscali nelle pagine `privacy-policy`, `cookie-policy` e `termini-e-condizioni` con i dati reali:
  nome o ragione sociale, Partita IVA, indirizzo/domicilio professionale, email, PEC, eventuale REA e regime prezzi/IVA.

## Licenza contenuti

Codice e struttura sono riusabili secondo le tue policy di progetto.
Foto, video e testi del diario restano protetti e non riutilizzabili senza autorizzazione dell'autore.
