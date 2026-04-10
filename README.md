# Convoy

Convoy — прототип приложения для совместных поездок: создание конвоя, маршрут на карте, трекинг участников в реальном времени, чат, а также MVP-фичи: голосования, случайные события и настройки приватности.

Репозиторий содержит два проекта:

- `backend/` — Fastify + Prisma + PostgreSQL
- `frontend/` — React + Vite + Leaflet

## Возможности (MVP)

- Конвои
  - создание, обновление, присоединение по коду
  - просмотр открытых конвоев поблизости
  - прямое вступление в `open`-конвой без invite code
  - лидер и передача лидерства
  - приватность конвоя: `invite | open`
  - управление участниками (лидер): добавить по телефону, кик
- Маршруты
  - точки маршрута, редактирование, reorder, close-loop
  - построение геометрии маршрута через OSRM
- Геокодинг
  - поиск адресов
  - reverse geocoding для точек, поставленных вручную
- Реалтайм
  - WebSocket-подключение для обновления участников
- Чат
  - сообщения внутри конвоя
- Голосования (polls)
  - создать, проголосовать, закрыть
- Случайные события
  - список событий
  - генерация случайного события (лидер)

## Требования

- Node.js 20+
- PostgreSQL 14+

## Быстрый старт (Dev)

### 1) Backend

1. Установи зависимости:

```bash
npm install
```

2. Создай файл `backend/.env` по примеру `backend/.env.example`.

3. Прогони миграции Prisma и сгенерируй клиент:

```bash
npm run prisma:migrate
npm run prisma:generate
```

4. Запусти dev-сервер:

```bash
npm run dev
```

Backend по умолчанию стартует на `http://localhost:3000`.

Swagger UI: `http://localhost:3000/docs`

### 2) Frontend

1. Установи зависимости:

```bash
npm install
```

2. (Опционально) создай `frontend/.env` и переопредели адреса API:

- `VITE_API_URL` (по умолчанию `http://localhost:3000`)
- `VITE_WS_URL` (по умолчанию `ws://localhost:3000/ws`)

3. Запусти dev-сервер:

```bash
npm run dev
```

## Переменные окружения

### Backend (`backend/.env`)

Смотри `backend/.env.example`.

- `DATABASE_URL` — строка подключения к PostgreSQL
- `JWT_SECRET` — секрет для JWT (минимум 32 символа)
- `PORT` — порт backend (по умолчанию 3000)
- `WS_TTL_SECONDS` — TTL для websocket-сессий
- `WS_MIN_PING_INTERVAL_MS` — минимальный интервал пингов
- `OSRM_BASE_URL` — базовый URL OSRM (routing)
- `NOMINATIM_BASE_URL` — базовый URL Nominatim (geocoding)

### Frontend (`frontend/.env`)

- `VITE_API_URL` — base URL REST API
- `VITE_WS_URL` — base URL WebSocket

## Структура репозитория

```text
/backend
  /prisma
  /src
    /modules
      /auth
      /chat
      /convoys
      /events
      /geocoding
      /polls
      /routing
      /users
      /ws
/frontend
  /src
    /lib
    /pages
    /store
```

## Основные API эндпоинты (коротко)

Полный список и схемы смотри в Swagger: `GET /docs`.

- Auth
  - `POST /auth/send-otp`
  - `POST /auth/verify-otp`
- Convoys
  - `POST /convoys`
  - `GET /convoys`
  - `GET /convoys/:id`
  - `PATCH /convoys/:id`
  - `POST /convoys/:id/join`
  - `POST /convoys/:id/transfer-leader`
  - `POST /convoys/:id/members/add-by-phone`
  - `DELETE /convoys/:id/members/:userId`
- Routing
  - `POST /routing/route`
- Geocoding
  - `GET /geocoding/search`
  - `GET /geocoding/reverse`
- Polls
  - `GET /convoys/:id/polls`
  - `POST /convoys/:id/polls`
  - `POST /convoys/:id/polls/:pollId/vote`
  - `POST /convoys/:id/polls/:pollId/close`
- Events
  - `GET /convoys/:id/events`
  - `POST /convoys/:id/events/random`

## Примечания

- Для продакшена рекомендуется настроить собственный OSRM/Nominatim или использовать более надежные провайдеры.
- Если меняешь Prisma schema, после этого обязательно запускать:

```bash
npm run prisma:migrate
npm run prisma:generate
```
