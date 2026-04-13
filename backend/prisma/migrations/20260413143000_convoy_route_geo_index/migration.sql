-- Denormalize route geometry for indexed nearby discovery.
ALTER TABLE "Convoy"
  ADD COLUMN "routeStartLat" DOUBLE PRECISION,
  ADD COLUMN "routeStartLon" DOUBLE PRECISION,
  ADD COLUMN "routeEndLat" DOUBLE PRECISION,
  ADD COLUMN "routeEndLon" DOUBLE PRECISION,
  ADD COLUMN "routeMinLat" DOUBLE PRECISION,
  ADD COLUMN "routeMaxLat" DOUBLE PRECISION,
  ADD COLUMN "routeMinLon" DOUBLE PRECISION,
  ADD COLUMN "routeMaxLon" DOUBLE PRECISION,
  ADD COLUMN "routeLengthKm" DOUBLE PRECISION NOT NULL DEFAULT 0,
  ADD COLUMN "routePointCount" INTEGER NOT NULL DEFAULT 0,
  ADD COLUMN "leaderLastPingLat" DOUBLE PRECISION,
  ADD COLUMN "leaderLastPingLon" DOUBLE PRECISION,
  ADD COLUMN "leaderLastPingAt" TIMESTAMP(3);

WITH route_points AS (
  SELECT
    c."id",
    point."ordinality",
    (point."value"->>'lat')::double precision AS "lat",
    (point."value"->>'lon')::double precision AS "lon"
  FROM "Convoy" c
  CROSS JOIN LATERAL jsonb_array_elements(c."route") WITH ORDINALITY AS point("value", "ordinality")
  WHERE jsonb_typeof(c."route") = 'array'
    AND jsonb_typeof(point."value") = 'object'
    AND jsonb_typeof(point."value"->'lat') = 'number'
    AND jsonb_typeof(point."value"->'lon') = 'number'
),
segments AS (
  SELECT
    "id",
    "lat",
    "lon",
    "ordinality",
    lag("lat") OVER (PARTITION BY "id" ORDER BY "ordinality") AS "prevLat",
    lag("lon") OVER (PARTITION BY "id" ORDER BY "ordinality") AS "prevLon"
  FROM route_points
),
stats AS (
  SELECT
    "id",
    (array_agg("lat" ORDER BY "ordinality"))[1] AS "routeStartLat",
    (array_agg("lon" ORDER BY "ordinality"))[1] AS "routeStartLon",
    (array_agg("lat" ORDER BY "ordinality" DESC))[1] AS "routeEndLat",
    (array_agg("lon" ORDER BY "ordinality" DESC))[1] AS "routeEndLon",
    min("lat") AS "routeMinLat",
    max("lat") AS "routeMaxLat",
    min("lon") AS "routeMinLon",
    max("lon") AS "routeMaxLon",
    count(*)::integer AS "routePointCount",
    coalesce(
      sum(
        CASE
          WHEN "prevLat" IS NULL OR "prevLon" IS NULL THEN 0
          ELSE 6371 * 2 * atan2(
            sqrt(
              power(sin(radians("lat" - "prevLat") / 2), 2) +
              cos(radians("prevLat")) * cos(radians("lat")) *
              power(sin(radians("lon" - "prevLon") / 2), 2)
            ),
            sqrt(
              1 - (
                power(sin(radians("lat" - "prevLat") / 2), 2) +
                cos(radians("prevLat")) * cos(radians("lat")) *
                power(sin(radians("lon" - "prevLon") / 2), 2)
              )
            )
          )
        END
      ),
      0
    ) AS "routeLengthKm"
  FROM segments
  GROUP BY "id"
)
UPDATE "Convoy" c
SET
  "routeStartLat" = stats."routeStartLat",
  "routeStartLon" = stats."routeStartLon",
  "routeEndLat" = stats."routeEndLat",
  "routeEndLon" = stats."routeEndLon",
  "routeMinLat" = stats."routeMinLat",
  "routeMaxLat" = stats."routeMaxLat",
  "routeMinLon" = stats."routeMinLon",
  "routeMaxLon" = stats."routeMaxLon",
  "routePointCount" = stats."routePointCount",
  "routeLengthKm" = round((stats."routeLengthKm")::numeric, 1)::double precision
FROM stats
WHERE c."id" = stats."id";

UPDATE "Convoy" c
SET
  "leaderLastPingLat" = (m."lastPing"->>'lat')::double precision,
  "leaderLastPingLon" = (m."lastPing"->>'lon')::double precision,
  "leaderLastPingAt" = CASE
    WHEN jsonb_typeof(m."lastPing"->'timestamp') = 'number'
      THEN to_timestamp(((m."lastPing"->>'timestamp')::double precision) / 1000)
    ELSE NULL
  END
FROM "ConvoyMember" m
WHERE m."convoyId" = c."id"
  AND m."userId" = c."leaderId"
  AND jsonb_typeof(m."lastPing") = 'object'
  AND jsonb_typeof(m."lastPing"->'lat') = 'number'
  AND jsonb_typeof(m."lastPing"->'lon') = 'number';

CREATE INDEX "Convoy_open_route_bbox_idx" ON "Convoy"("privacy", "status", "routeMinLat", "routeMaxLat", "routeMinLon", "routeMaxLon");
CREATE INDEX "Convoy_open_leader_ping_idx" ON "Convoy"("privacy", "status", "leaderLastPingLat", "leaderLastPingLon");
CREATE INDEX "Convoy_open_start_time_idx" ON "Convoy"("privacy", "status", "startTime");
CREATE INDEX "Convoy_route_length_idx" ON "Convoy"("routeLengthKm");
