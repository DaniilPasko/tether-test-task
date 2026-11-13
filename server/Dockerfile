FROM node:24-alpine AS build
WORKDIR /srv
COPY package.json package-lock.json ./
RUN npm ci
COPY tsconfig.json ./
COPY src ./src
RUN npm run build

FROM node:24-alpine
WORKDIR /srv
ENV NODE_ENV=production
COPY package.json package-lock.json ./
RUN npm ci --omit=dev && npm cache clean --force
COPY --from=build /srv/dist ./dist
RUN mkdir -p /data/uploads && chown -R node:node /srv /data/uploads
USER node
EXPOSE 3000
CMD ["node", "dist/index.js"]
