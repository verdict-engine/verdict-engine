FROM node:20-alpine AS build
WORKDIR /app
COPY package*.json ./
RUN npm ci
COPY tsconfig.json tsconfig.build.json nest-cli.json ./
COPY src ./src
COPY rules ./rules
RUN npm run build && npm prune --omit=dev

FROM node:20-alpine AS run
WORKDIR /app
ENV NODE_ENV=production
ENV PORT=4000
# No AUTH_SECRET / DATABASE_URL baked in — supply them at deploy time. The engine validates them
# at startup and refuses to boot on a missing or placeholder secret (see config/env.ts).
COPY --from=build --chown=node:node /app/node_modules ./node_modules
COPY --from=build --chown=node:node /app/dist ./dist
COPY --from=build --chown=node:node /app/rules ./rules
# Drop root — run as the image's built-in unprivileged `node` user.
USER node
EXPOSE 4000
CMD ["node", "dist/main.js"]
