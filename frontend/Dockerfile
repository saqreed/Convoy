FROM node:20-alpine AS build

WORKDIR /app

ARG VITE_API_URL=http://localhost:3000
ARG VITE_WS_URL=ws://localhost:3000/ws
ENV VITE_API_URL=$VITE_API_URL
ENV VITE_WS_URL=$VITE_WS_URL

COPY package*.json ./
RUN npm ci

COPY index.html ./
COPY postcss.config.js tailwind.config.js vite.config.ts ./
COPY tsconfig*.json ./
COPY public ./public
COPY src ./src

RUN npm run build

FROM nginx:1.27-alpine

COPY nginx.conf /etc/nginx/conf.d/default.conf
COPY --from=build /app/dist /usr/share/nginx/html

EXPOSE 80
