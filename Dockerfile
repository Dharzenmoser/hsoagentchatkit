# 1. Build stage
FROM node:22-alpine AS builder

WORKDIR /app
RUN apk add --no-cache git python3 make g++

COPY . .

WORKDIR /app/frontend
RUN npm ci
RUN npm run build

# 2. Runtime stage
FROM node:22-alpine AS runner

WORKDIR /app

RUN apk add --no-cache python3 make g++ bash sed libreoffice ttf-dejavu fontconfig

COPY package*.json ./
RUN npm ci --omit=dev

COPY backend ./backend
COPY --from=builder /app/frontend/dist ./frontend/dist
COPY --from=builder /app/frontend/package.json ./frontend/package.json

RUN sed -i 's/\r$//' ./backend/scripts/run.sh
RUN sed -i 's/127.0.0.1/0.0.0.0/g' ./backend/scripts/run.sh
RUN sed -i 's/localhost/0.0.0.0/g' ./backend/scripts/run.sh
RUN chmod +x ./backend/scripts/run.sh

ENV NODE_ENV=production
ENV HOST=0.0.0.0
ENV PORT=8000
ENV FRONTEND_DIST_DIR=/app/frontend/dist
EXPOSE 8000

CMD ["npm", "run", "start"]
