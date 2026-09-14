# =============================================================
# Ein Abbild, drei Rollen: api, ingest und migrate unterscheiden sich nur im
# Startbefehl. Das hält Aufbau und Aktualisierung einfach und stellt sicher, dass
# alle drei denselben Code ausführen.
# =============================================================

# ── Abhängigkeiten ──────────────────────────────────────────────
FROM node:22-alpine AS deps

WORKDIR /app
COPY package.json package-lock.json ./
# npm ci statt install: reproduzierbar aus der Lockdatei.
# --omit=dev: Entwicklungswerkzeuge gehören nicht in ein Betriebsabbild.
RUN npm ci --omit=dev

# ── Laufzeit ────────────────────────────────────────────────────
FROM node:22-alpine AS runtime

ENV NODE_ENV=production
WORKDIR /app

# Nicht als root laufen. node:alpine bringt den Benutzer "node" bereits mit.
COPY --chown=node:node --from=deps /app/node_modules ./node_modules
COPY --chown=node:node package.json ./
COPY --chown=node:node src ./src
COPY --chown=node:node migrations ./migrations
COPY --chown=node:node scripts ./scripts

USER node

EXPOSE 3001 3002

# Exec-Form: Der Prozess läuft als PID 1 und empfängt SIGTERM direkt — Voraussetzung
# für das geordnete Beenden (lib/shutdown.js).
CMD ["node", "src/server.js"]
