# --- Stage 1: build admin UI -------------------------------------------------
FROM node:20-alpine AS ui-build
WORKDIR /app/admin-ui
COPY admin-ui/package*.json ./
RUN npm install
COPY admin-ui/ ./
RUN npm run build

# --- Stage 2: install server deps -------------------------------------------
FROM node:20-alpine AS server-deps
WORKDIR /app
COPY package*.json ./
RUN npm install --omit=dev --ignore-scripts

# --- Stage 3: runtime -------------------------------------------------------
FROM node:20-alpine
WORKDIR /app
ENV NODE_ENV=production
ENV PORT=3000

COPY --from=server-deps /app/node_modules ./node_modules
COPY package*.json ./
COPY src ./src
COPY sql ./sql
COPY --from=ui-build /app/admin-ui/dist ./admin-ui/dist

EXPOSE 3000
USER node
CMD ["node", "src/index.js"]
