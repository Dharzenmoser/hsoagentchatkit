# 1. Bau-Phase (Builder)
FROM node:18-alpine AS builder

WORKDIR /app
RUN apk add --no-cache git python3 make g++

COPY . .

WORKDIR /app/frontend
RUN npm install

# --- WICHTIG: Die Platzhalter für den Build ---
# Vite "brennt" diese Texte in die Javascript-Dateien ein.
ENV VITE_CHATKIT_WORKFLOW_ID=REPLACE_ME_WORKFLOW_ID
ENV VITE_CHATKIT_PUBLIC_KEY=REPLACE_ME_PUBLIC_KEY
ENV VITE_API_URL=REPLACE_ME_API_URL

RUN npm run build
WORKDIR /app

# 2. Laufzeit-Phase (Runner)
FROM node:18-alpine AS runner

WORKDIR /app

# Wir installieren Bash, um Skripte sauber auszuführen
RUN apk add --no-cache python3 make g++ bash sed

COPY package*.json ./
RUN npm install --omit=dev

COPY backend ./backend
COPY --from=builder /app/frontend/dist ./frontend/dist
COPY --from=builder /app/frontend/package.json ./frontend/package.json

# --- Backend Skript fixen ---
RUN sed -i 's/\r$//' ./backend/scripts/run.sh
RUN sed -i 's/127.0.0.1/0.0.0.0/g' ./backend/scripts/run.sh
RUN sed -i 's/localhost/0.0.0.0/g' ./backend/scripts/run.sh
RUN chmod +x ./backend/scripts/run.sh

# --- NEU: Das Start-Skript erstellen (Der Fix) ---
# Wir erstellen eine Datei 'entrypoint.sh' direkt im Container.
# Diese Datei kümmert sich um das Ersetzen der Variablen beim Start.
RUN echo '#!/bin/bash' > ./entrypoint.sh
RUN echo 'echo "Starte Deployment Skript..."' >> ./entrypoint.sh

# 1. Workflow ID ersetzen
RUN echo 'find /app/frontend/dist -type f -name "*.js" -exec sed -i "s|REPLACE_ME_WORKFLOW_ID|$VITE_CHATKIT_WORKFLOW_ID|g" {} \;' >> ./entrypoint.sh

# 2. Public Key ersetzen
RUN echo 'find /app/frontend/dist -type f -name "*.js" -exec sed -i "s|REPLACE_ME_PUBLIC_KEY|$VITE_CHATKIT_PUBLIC_KEY|g" {} \;' >> ./entrypoint.sh

# 3. API URL ersetzen
RUN echo 'find /app/frontend/dist -type f -name "*.js" -exec sed -i "s|REPLACE_ME_API_URL|$VITE_API_URL|g" {} \;' >> ./entrypoint.sh

# 4. Server starten
RUN echo 'echo "Variablen ersetzt. Starte Server..."' >> ./entrypoint.sh
RUN echo 'npm run start' >> ./entrypoint.sh

# Skript ausführbar machen
RUN chmod +x ./entrypoint.sh

ENV NODE_ENV=production
ENV HOST=0.0.0.0
ENV PORT=8000
EXPOSE 8000

# Wir starten jetzt das Skript statt direkt npm
CMD ["/bin/bash", "./entrypoint.sh"]
