# Contexte de build : racine du monorepo (voir infra/cloudbuild-worker.yaml)
FROM node:22-slim AS build
WORKDIR /app
COPY package.json package-lock.json tsconfig.json tsconfig.base.json ./
COPY packages/core/package.json packages/core/
COPY apps/worker/package.json apps/worker/
COPY apps/api/package.json apps/api/
RUN npm ci
COPY packages ./packages
COPY apps ./apps
RUN npm run build && npm prune --omit=dev

FROM node:22-slim
WORKDIR /app
ENV NODE_ENV=production
# poppler-utils : découpage des PDF en pages (pdftoppm), nombre de pages
# (pdfinfo) et détection d'une couche texte (pdftotext)
RUN apt-get update \
  && apt-get install -y --no-install-recommends poppler-utils \
  && rm -rf /var/lib/apt/lists/*
COPY --from=build /app/package.json ./
COPY --from=build /app/node_modules ./node_modules
COPY --from=build /app/packages/core/package.json ./packages/core/
COPY --from=build /app/packages/core/dist ./packages/core/dist
COPY --from=build /app/apps/worker/package.json ./apps/worker/
COPY --from=build /app/apps/worker/dist ./apps/worker/dist
EXPOSE 8080
CMD ["node", "apps/worker/dist/server.js"]
