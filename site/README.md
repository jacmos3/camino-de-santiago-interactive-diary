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

La cartella `deploy-runtime/` va rigenerata ogni volta prima di pubblicare.

### Comando da usare

```bash
cd /Volumes/HardDisk/Cammino\ di\ Santiago/site
node scripts/build-deploy-runtime.js
```

Questo comando:
- cancella la vecchia `deploy-runtime/`
- la ricrea da zero
- copia dentro i file pubblici aggiornati
- copia `api/`, `data/` e `assets/`
- include `.htaccess`, `robots.txt` e `sitemap.xml`

### Procedura corretta passo passo

1. Aggiorna il codice locale:

```bash
cd /Volumes/HardDisk/Cammino\ di\ Santiago/site
git checkout main
git pull origin main
```

2. Assicurati di avere anche gli asset pesanti in locale.
   Se ti servono immagini, thumb, poster e video, sincronizza prima i contenuti dal branch `codex/assets-media`.

3. Rigenera il pacchetto di deploy:

```bash
node scripts/build-deploy-runtime.js
```

4. Controlla che la cartella `deploy-runtime/` contenga almeno:
- file pubblici: `index.html`, `map.html`, `app.js`, `map.js`, `people.js`, `styles.css`
- pagine pubbliche: `contatti.html`, `crea-il-tuo-diario.html`, `privacy-policy.html`, `cookie-policy.html`, `termini-e-condizioni.html`
- runtime PHP: `api/`, `day.php`, `.htaccess`
- dati: `data/`
- media: `assets/`

5. Verifica il file `.env` dentro `deploy-runtime/`.
   Se esiste, controlla che sia adatto all'hosting reale e non solo al tuo ambiente locale.

6. Carica sul server il contenuto di `deploy-runtime/`.
   Se la root pubblica del dominio e la document root del sito, carica direttamente il contenuto interno di `deploy-runtime/` li dentro.

7. Dopo il deploy, controlla almeno questi URL:
- `https://mycamino.it/it/`
- `https://mycamino.it/it/day/2019-06-04/`
- `https://mycamino.it/sitemap.xml`
- `https://mycamino.it/robots.txt`

### Nota importante

La sitemap non crea redirect.
I redirect del vecchio dominio verso `mycamino.it` vanno gestiti a livello HTTP:
- lato server
- oppure in Cloudflare

Nel setup attuale il server deve vedere davvero l'host richiesto dal browser:
- `mycamino.it` deve arrivare al backend come `Host: mycamino.it`
- `mycamino.semproxlab.it` deve arrivare al backend come `Host: mycamino.semproxlab.it`

Se Cloudflare o un proxy fa host override verso il sottodominio tecnico, il backend non puo distinguere i due casi e il redirect SEO del legacy host smette di essere affidabile.

Se mantieni `mycamino.semproxlab.it` come origine tecnica dietro Cloudflare, usa il Worker in:
- `cloudflare/mycamino-worker.js`

Il Worker aggiunge `X-Canonical-Host: mycamino.it`, che il backend usa per:
- servire normalmente le richieste del dominio pubblico
- fare redirect `301` solo sugli accessi diretti al sottodominio tecnico

Elementi essenziali del deploy:
- static: `index.html`, `map.html`, `app.js`, `map.js`, `styles.css`, favicon, sitemap, robots
- data: `entries.*.json`, `tracks/*`, `comments.json`, `day_og_overrides.json`
- media: `assets/img`, `assets/thumb`, `assets/poster`, `assets/video_resized`, eventuale `assets/audio`
- API: `api/index.php` (+ eventuale `.env` lato server)
- rewrite: `.htaccess`

## Configurazione

Variabili comuni in `.env`:
- `ADMIN_PASSWORD`
- `CONTACT_TO_EMAIL`
- `CONTACT_FROM_EMAIL`
- `ANALYTICS_ENABLED`
- `SITE_PRIMARY_HOST` (esempio: `mycamino.it`)
- `LEGACY_SITE_HOSTS` (opzionale, lista separata da virgole dei vecchi host da redirigere)
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
