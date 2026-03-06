# Assets

Questa cartella contiene i media runtime del sito:

- `img/`
- `thumb/`
- `poster/`
- `video_resized/`

## Fonte ufficiale

Gli asset pesanti non sono mantenuti su `main`.
La fonte ufficiale e il branch:

- `codex/assets-media`

Se stai lavorando su `main`, i file dentro `assets/` vanno sincronizzati da quel branch prima di fare controlli finali o deploy.

## Struttura attesa

I file devono essere organizzati in sottocartelle giornaliere:

- `assets/img/YYYY-MM-DD/...`
- `assets/thumb/YYYY-MM-DD/...`
- `assets/poster/YYYY-MM-DD/...`
- `assets/video_resized/YYYY-MM-DD/...`

Non lasciare file media sparsi nella root di queste cartelle, a meno che non facciano parte intenzionalmente del branch `codex/assets-media`.

## Come riallineare `assets/` da `main`

Dalla root del progetto:

```bash
git archive codex/assets-media assets | tar -x -C /Volumes/HardDisk/Cammino\ di\ Santiago/site
```

Questo copia gli asset dal branch media nella working copy attuale, ma non elimina eventuali file locali extra.

Per riallineare `assets/` in modo esatto al branch media, inclusa la rimozione dei file extra:

```bash
rm -rf /tmp/cammino-assets-sync
mkdir -p /tmp/cammino-assets-sync
git archive codex/assets-media assets | tar -x -C /tmp/cammino-assets-sync
rsync -a --delete /tmp/cammino-assets-sync/assets/ assets/
```

## Controlli consigliati prima del deploy

- verifica che i path usati in `data/entries.*.json` puntino a file realmente presenti
- verifica che le sottocartelle `YYYY-MM-DD` siano popolate
- se ricrei `deploy-runtime/`, assicurati che `deploy-runtime/assets/` contenga la stessa struttura di `assets/`

## Nota pratica

Se modifichi file media reali, il commit va fatto nel branch `codex/assets-media`, non su `main`.
