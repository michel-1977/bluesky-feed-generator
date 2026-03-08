FROM node:20

WORKDIR /app

COPY . .

RUN npm ci

EXPOSE 3000

ENV NODE_ENV production

# Use npm to start the application
CMD ["npm", "run", "start"]
