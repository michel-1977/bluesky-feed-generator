FROM node:20

WORKDIR /app

COPY package.json package-lock.json ./
RUN npm ci

COPY tsconfig.json ./
COPY src ./src

RUN npm run build && npm prune --omit=dev

EXPOSE 3000

ENV NODE_ENV=production

CMD ["node", "dist/index.js"]
