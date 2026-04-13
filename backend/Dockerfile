FROM node:20-alpine

WORKDIR /app

RUN apk add --no-cache openssl

COPY package*.json ./
RUN npm ci

COPY prisma ./prisma
COPY tsconfig.json ./
COPY src ./src

RUN npm run prisma:generate && npm run build

ENV NODE_ENV=production
ENV PORT=3000

EXPOSE 3000

CMD ["sh", "-c", "npx prisma migrate deploy && node dist/server.js"]
