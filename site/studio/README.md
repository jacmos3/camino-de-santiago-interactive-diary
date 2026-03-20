# Diary Studio

Studio separato dal diario pubblico per gestire progetti, giorni, testi e media.

## Obiettivo

Questa cartella contiene un MVP editoriale isolato:

- login semplice via password di admin
- progetti diario
- giorni con campi strutturati
- upload media con persistenza separata
- coda job minima per processing/publish futuro

Il diario pubblico non legge ancora questi dati direttamente: questo Studio e la base authoring.

## Avvio locale

Usa un server PHP dedicato sulla sola cartella `studio`:

```bash
cd /Volumes/HardDisk/Cammino\ di\ Santiago/site
php -S 127.0.0.1:4184 -t studio
```

Apri:

- `http://127.0.0.1:4184/`

## Login

Password letta in questo ordine:

1. `STUDIO_ADMIN_PASSWORD`
2. `ADMIN_PASSWORD`
3. `COMMENTS_ADMIN_TOKEN`
4. `CAMMINO_ADMIN_TOKEN`
5. `ADMIN_TOKEN`

Le variabili vengono cercate nel file `.env` del progetto root oppure nell'ambiente del processo PHP.

## Storage

I dati dello Studio stanno in:

- `studio/storage/studio.sqlite`
- `studio/storage/uploads/`

La cartella `studio/storage/` e protetta via `.htaccess` e non dovrebbe essere esposta pubblicamente.

## Limiti attuali

- nessun publish runtime verso `data/entries.*.json`
- nessun worker reale per metadata, poster, thumb o reverse geocode
- nessuna integrazione Strava OAuth

Lo Studio salva i dati corretti e mette in coda job placeholder, ma il processing automatico e il publish restano il prossimo step.
