Понял — тебе нужно **чисто технарское ТЗ**, в стиле:

* архитектурные требования,
* структура каталогов,
* модули,
* интерфейсы,
* типы,
* протоколы,
* контракты,
* пайплайн разработки,
* правила написания кода,
* use cases,
* схемы данных,
* детали API,
* детали WebSocket,
* детали кеширования,
* детали фоновых задач,
* требования к тестированию,
* требования к CI/CD,
* требования к логированию,
* требования к мониторингу,
* требования к публикации RN-приложения.

Не фича-лист, не описание продукта, а реальное **developer-oriented specification** — чтобы тимлид открыл и понял: «ага, вот что надо писать».

Ниже — полностью в этом формате. **Это максимально детальный, жёсткий и технический документ, без воды.**

---

# **Техническое задание (Technical Specification) для разработки системы «Convoy»**

Документ предназначен для программистов, архитекторов и девопсов.
Основная цель — описать полностью техническую сторону продукта, включая структуру проекта, стандарты кода, API-контракты, протоколы обмена, требования к безопасности и инфраструктуре.

---

# **1. Технологический стек**

## **1.1 Mobile (React Native)**

* React Native 0.74+
* TypeScript 5+
* State management: Zustand или Redux Toolkit
* Navigation: React Navigation
* Maps: **MapLibre RN SDK** (предпочтительно), fallback — Mapbox RN SDK
* Permissions: react-native-permissions
* Background location: react-native-background-geolocation или свой сервис (Android foreground service + iOS background location)
* WebSocket client: ws или socket.io-client
* Push: Firebase Cloud Messaging
* Build: EAS (Expo) или React Native CLI (ближе к нативу)

## **1.2 Backend (Node.js)**

* Node.js 20+
* Fastify или Express
* WebSocket сервер: ws
* DB: PostgreSQL 14+ (рекомендуется Supabase PostgreSQL free-tier)
* ORM: Prisma ORM
* Auth: JWT (HS256)
* Geo: turf.js
* File storage: Supabase Storage / S3-compatible
* Deployment: Fly.io / Render
* CI/CD: GitHub Actions
* Monitoring: простое логирование + Sentry (опционально)

---

# **2. Архитектура**

## **2.1 Общая архитектура**

Клиент ↔ WebSocket ↔ Backend ↔ PostgreSQL
Клиент ↔ REST ↔ Backend
Backend ↔ Storage (аватары, GPX)

Backend stateless.
WebSocket шарит состояние в Redis при многосерверной конфигурации.
Для MVP — 1 инстанс без Redis.

## **2.2 Структура каталогов (Backend)**

```
/src
  /config
  /modules
    /auth
      controller.ts
      service.ts
      schema.ts
      routes.ts
    /convoys
      controller.ts
      service.ts
      repository.ts
      schema.ts
    /ws
      gateway.ts
      handlers/
         convoyHandler.ts
         authHandler.ts
         pingHandler.ts
    /users
      controller.ts
      service.ts
      repository.ts
  /common
    errors.ts
    logger.ts
    types.ts
  /db
    prisma.schema
  /server.ts
/tests
  /integration
  /unit
```

## **2.3 Структура каталогов (React Native)**

```
/src
  /components
  /screens
  /navigation
  /store
  /api
  /services
    locationService.ts
    websocketService.ts
    permissionsService.ts
  /utils
  /types
/assets
```

---

# **3. Протоколы и контракты**

# **3.1 WebSocket протокол**

**URI:** `wss://host/ws?token=JWT`

Входящее сообщение от клиента:

```ts
interface ClientMessage<T = any> {
  type: string;
  convoyId?: string;
  payload?: T;
}
```

Исходящее сообщение от сервера:

```ts
interface ServerMessage<T = any> {
  type: string;
  userId?: string;
  convoyId?: string;
  timestamp: number;
  payload?: T;
}
```

## **3.1.1 Типы сообщений**

### **1. auth:init**

Клиент → сервер:

```json
{ "type": "auth:init", "payload": { "token": "jwt_token" } }
```

Ответ сервера:

```json
{ "type": "auth:ok" }
```

### **2. convoy:join**

```json
{
  "type": "convoy:join",
  "convoyId": "uuid"
}
```

### **3. ping (главный тип)**

Клиент → сервер:

```json
{
  "type": "ping",
  "convoyId": "uuid",
  "payload": {
    "lat": 51.1,
    "lon": 45.0,
    "speed": 45.3,
    "heading": 120,
    "accuracy": 10,
    "battery": 82,
    "timestamp": 171000111222
  }
}
```

Сервер → всем в комнате:

```json
{
  "type": "member:update",
  "userId": "uuid",
  "payload": {
    "lat": 51.1,
    "lon": 45.0,
    "speed": 45.3,
    "heading": 120,
    "timestamp": 171000111222
  }
}
```

### **4. member:status**

```json
{
  "type": "member:status",
  "convoyId": "uuid",
  "payload": { "status": "delayed" }
}
```

### **5. sos**

```json
{
  "type": "sos",
  "convoyId": "uuid",
  "payload": { "lat": 51.1, "lon": 45.0, "message": "Проблема" }
}
```

---

# **3.2 REST API контракты (Fastify + JSON Schema)**

## **3.2.1 POST /auth/send-otp**

Request:

```json
{ "phone": "+79999999999" }
```

Response:

```json
{ "sessionId": "uuid" }
```

## **3.2.2 POST /auth/verify-otp**

Request:

```json
{ "sessionId": "uuid", "code": "1234" }
```

Response:

```json
{ "token": "jwt-hs256-token" }
```

## **3.2.3 POST /convoys**

Request:

```json
{
  "title": "Поездка",
  "startTime": "2025-01-22T10:00:00Z",
  "route": [{ "lat": 51.1, "lon": 45.1, "name": "Start" }],
  "privacy": "invite"
}
```

Response: объект конвоя.

## **3.2.4 POST /convoys/{id}/join**

Request:

```json
{ "code": "AB125C" }
```

---

# **4. Модели данных (Prisma)**

```prisma
model User {
  id          String   @id @default(uuid())
  phone       String?  @unique
  email       String?  @unique
  name        String
  avatarUrl   String?
  createdAt   DateTime @default(now())
  members     ConvoyMember[]
}

model Convoy {
  id         String   @id @default(uuid())
  title      String
  leaderId   String
  leader     User     @relation(fields: [leaderId], references: [id])
  startTime  DateTime?
  status     String   @default("planned")
  route      Json
  createdAt  DateTime @default(now())
  members    ConvoyMember[]
  invites    Invite[]
}

model ConvoyMember {
  convoyId  String
  userId    String
  role      String @default("member")
  lastPing  Json?
  joinedAt  DateTime @default(now())

  convoy    Convoy @relation(fields: [convoyId], references: [id])
  user      User   @relation(fields: [userId], references: [id])

  @@id([convoyId, userId])
}

model Invite {
  id        String   @id @default(uuid())
  convoyId  String
  code      String
  expiresAt DateTime

  convoy    Convoy @relation(fields: [convoyId], references: [id])
}

model LocationPing {
  id        String   @id @default(uuid())
  userId    String
  convoyId  String
  lat       Float
  lon       Float
  speed     Float?
  heading   Float?
  accuracy  Float?
  battery   Int?
  ts        DateTime @default(now())
}
```

---

# **5. Логика на стороне клиента (React Native)**

## **5.1 Location Service**

* Обновление каждые 5–10 сек при движении (speed > 2 км/ч).
* Обновление каждые 30–60 сек при стоянии.
* Отправка пингов только в WebSocket.
* Если WebSocket недоступен → буферизация в память → отправка при восстановлении.

## **5.2 WebSocket Service**

* Автопереподключение: 1s → 2s → 5s → 15s → 30s
* Очередь исходящих сообщений.
* Heartbeat: каждые 20 сек.
* Обработка reconnection event: повторная авторизация + join конвоев.

## **5.3 Store (Zustand)**

Стейты:

* user
* convoys
* activeConvoy
* members
* wsConnectionState
* locationState

---

# **6. Backend логика подробно**

## **6.1 WebSocket обработка**

Algoritm обработки ping:

```
if (!isAuthenticated(ws)) reject
validate payload
saveLastPing(userId, convoyId, payload)
broadcast to convoy room: member:update
```

## **6.2 Авторизация**

JWT (HS256), payload:

```json
{
  "userId": "uuid",
  "iat": 1710000000,
  "exp": 1710600000
}
```

Проверяется на каждом REST-запросе и при WebSocket handshake.

## **6.3 Маршруты**

Сервер не рассчитывает сложные маршруты.
Если нужно — Mapbox Directions или OSRM.

---

# **7. CI/CD**

## **7.1 Git flow**

* main — stable
* dev — development
* feature/* — фичи
* release — релизы

## **7.2 Pipelines (GitHub Actions)**

### **Backend**

* install
* lint
* test
* build
* deploy (flyctl / render deploy)

### **Mobile**

* build Android APK
* build iOS IPA (через EAS)
* тесты E2E (Detox)

---

# **8. Логирование и мониторинг**

## **Backend**

* Логи в stdout JSON: {level, ts, msg, meta}
* Отдельный лог для WebSocket
* При ошибках — 5 строк stack trace

## **Mobile**

* Логирование только при дебаге
* Краши — через Sentry (опц)

---

# **9. Требования к производительности**

* WebSocket сервер выдерживает 3000 одновременных подключений на одном инстансе.
* Максимальный размер одного сообщения ≤ 2 KB.
* Частота ping’ов ≤ 1 в 3 секунд на клиента.

---

# **10. Требования к безопасности**

* JWT-секрет длиной 32+ символа
* HTTPS обязательно
* Rate-limit REST — 20 rps/User
* Верификация входящих WebSocket сообщений схемами JSON Schema
* Защита от replay-атак (timestamp + TTL)

---

# **11. Чеклист для MVP**

### Backend

* [ ] JWT Auth
* [ ] CRUD конвоев
* [ ] Приглашения
* [ ] WebSocket
* [ ] Ping handler
* [ ] Member update broadcast
* [ ] Сохранение lastPing в ConvoyMember
* [ ] История треков (простая)

### Client

* [ ] Авторизация
* [ ] Карта
* [ ] Отправка ping
* [ ] Отображение участников
* [ ] Присоединение через код
* [ ] SOS
* [ ] Статусы

---

Если хочешь — я могу:

### 1) Сделать **ещё глубже** технические детали:

* детали алгоритма маршрутизации;
* FSM (машины состояний) клиента;
* sequence diagram для каждого действия;
* UML / ERD диаграммы;
* OpenAPI 3.0 полный файл;
* JSON-Schema для каждого WS сообщения.

### 2) Могу собрать всё в **один огромный PDF/Word документ**.

### 3) Могу написать **полный boilerplate репозиториев**:

* /backend skeleton
* /mobile skeleton

Скажи, что нужно.
