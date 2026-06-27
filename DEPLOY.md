# Ord Bombe – Deployment

## Spil lokalt (samme netværk)
```bash
cd dansk-ord-bombe
npm start
```
Åbn http://localhost:3000 – del din lokale IP (f.eks. http://192.168.1.x:3000) med venner på samme WiFi.

## Del med venner over internet – gratis optioner

### Option 1: Render.com (anbefalet, gratis)
1. Push koden til GitHub
2. Gå til render.com → New → Web Service
3. Forbind dit GitHub repo
4. Build command: `npm install`
5. Start command: `node server.js`
6. Render giver dig en URL du kan dele

### Option 2: Railway.app
1. Push til GitHub
2. railway.app → New Project → Deploy from GitHub
3. Sæt PORT env variable til `3000`
4. Del URL'en

### Option 3: ngrok (hurtig test, lokalt kørende server)
1. Download ngrok fra ngrok.com
2. Kør serveren: `npm start`
3. I en ny terminal: `ngrok http 3000`
4. Del den https-URL ngrok giver dig
