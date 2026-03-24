## mycamino.it via Cloudflare Worker

Questa soluzione serve a evitare il loop SEO quando:

- il dominio pubblico e `mycamino.it`
- l'origine reale resta `mycamino.semproxlab.it`
- il backend PHP deve capire se la richiesta e arrivata dal dominio pubblico o dal sottodominio tecnico

### Cosa fa il Worker

Il Worker:

- riceve le richieste su `mycamino.it`
- le inoltra a `https://mycamino.semproxlab.it`
- forza `Host: mycamino.semproxlab.it` verso l'origine
- aggiunge `X-Canonical-Host: mycamino.it`
- aggiunge `X-Forwarded-Proto: https`

In questo modo il backend puo:

- servire il sito normalmente quando la richiesta arriva dal Worker
- fare `301` verso `mycamino.it` solo quando qualcuno apre direttamente `mycamino.semproxlab.it`

### File coinvolti nel backend

- `/.htaccess`
- `/day.php`
- `/api/index.php`

La regola critica e questa:

```apache
RewriteCond %{HTTP_HOST} ^(www\.)?mycamino\.semproxlab\.it$ [NC]
RewriteCond %{HTTP:X-Canonical-Host} !^mycamino\.it$ [NC]
RewriteRule ^ https://mycamino.it%{REQUEST_URI} [R=301,L,NE]
```

Quindi:

- accesso diretto a `mycamino.semproxlab.it` -> redirect 301
- accesso a `mycamino.it` tramite Worker -> nessun redirect

### Come configurarlo in Cloudflare

1. Crea un Worker e incolla `cloudflare/mycamino-worker.js`
2. Associa il Worker alla route:
   - `mycamino.it/*`
3. Lascia `mycamino.semproxlab.it` fuori da quel Worker
4. Verifica che il dominio pubblico continui a rispondere via Cloudflare
5. Verifica che il sottodominio tecnico risponda direttamente all'origine

### Nota importante

Questa e una toppa architetturale sensata, non la soluzione piu pulita.
La soluzione piu pulita resta:

- far puntare `mycamino.it` direttamente all'origine vera
- far vedere al backend `Host: mycamino.it`
- e usare il sottodominio tecnico solo come legacy redirect
