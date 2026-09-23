-- LOVEYUE 车队战绩库. 只需对 Vercel Postgres 跑一次:
--   Vercel 控制台 -> Storage -> 你的 Postgres -> Query, 整段粘贴执行;
--   或有网络可达时 psql "$POSTGRES_URL" -f db/schema.sql
-- 全部 IF NOT EXISTS, 重复执行无副作用.

CREATE TABLE IF NOT EXISTS matches (
  game_id           TEXT PRIMARY KEY,
  game_creation_ms  BIGINT NOT NULL,
  duration_min      NUMERIC,
  queue_id          INTEGER,
  queue_name        TEXT,
  game_mode         TEXT,
  roster_count      INTEGER,
  -- 每队目标物 (小龙/大龙/塔/...) 与 ban 位, JSON, 见 sgp.ts 的 TeamStats
  team_stats        TEXT,
  synced_at         TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS match_players (
  game_id               TEXT NOT NULL REFERENCES matches(game_id) ON DELETE CASCADE,
  puuid                 TEXT NOT NULL,
  member                TEXT,
  player_name           TEXT,
  team_id               INTEGER,
  position              TEXT,
  champion              TEXT,
  champion_id           INTEGER,
  spell1_id             INTEGER,
  spell2_id             INTEGER,
  win                   BOOLEAN,
  score                 NUMERIC,
  award                 TEXT,
  kills                 INTEGER,
  deaths                INTEGER,
  assists               INTEGER,
  kda                   NUMERIC,
  multi_kill            TEXT,
  first_blood           BOOLEAN,
  gold                  INTEGER,
  damage_to_champions   INTEGER,
  physical_damage       INTEGER,
  magic_damage          INTEGER,
  true_damage           INTEGER,
  damage_taken          INTEGER,
  heal                  INTEGER,
  turret_damage         INTEGER,
  cc_time               INTEGER,
  cs                    INTEGER,
  vision_score          INTEGER,
  wards_placed          INTEGER,
  wards_killed          INTEGER,
  champ_level           INTEGER,
  items                 TEXT,
  damage_self_mitigated BIGINT,
  killing_sprees        INTEGER,
  largest_killing_spree INTEGER,
  objectives_stolen     INTEGER,
  heals_on_teammates    BIGINT,
  gold_spent            BIGINT,
  time_spent_dead       INTEGER,
  PRIMARY KEY (game_id, puuid)
);

CREATE INDEX IF NOT EXISTS idx_match_players_member ON match_players(member);
CREATE INDEX IF NOT EXISTS idx_matches_creation ON matches(game_creation_ms DESC);
