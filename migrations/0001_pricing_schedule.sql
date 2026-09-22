CREATE TABLE pricing_snapshot (
  singleton INTEGER PRIMARY KEY CHECK (singleton = 1),
  snapshot_json TEXT,
  snapshot_hash TEXT,
  checked_at TEXT NOT NULL,
  verified_at TEXT,
  last_failure_at TEXT,
  last_failure_kind TEXT,
  CHECK (
    (snapshot_json IS NULL AND snapshot_hash IS NULL AND verified_at IS NULL)
    OR
    (snapshot_json IS NOT NULL AND snapshot_hash IS NOT NULL AND verified_at IS NOT NULL)
  )
);

CREATE TABLE holiday_manifest (
  singleton INTEGER PRIMARY KEY CHECK (singleton = 1),
  time_zone TEXT NOT NULL CHECK (time_zone = 'Asia/Shanghai'),
  starts_on TEXT NOT NULL,
  ends_on TEXT NOT NULL,
  source_url TEXT NOT NULL,
  source_sha256 TEXT NOT NULL,
  retrieved_at TEXT NOT NULL,
  notice_url TEXT NOT NULL
);

CREATE TABLE holiday_date (
  holiday_date TEXT PRIMARY KEY
);

INSERT INTO holiday_manifest (
  singleton,
  time_zone,
  starts_on,
  ends_on,
  source_url,
  source_sha256,
  retrieved_at,
  notice_url
) VALUES (
  1,
  'Asia/Shanghai',
  '2026-01-01',
  '2026-12-31',
  'https://raw.githubusercontent.com/NateScarlet/holiday-cn/18c8f140cd8574faf72c8bb5cd0a9bdf9d1c1b6c/2026.json',
  '0dcfd8004351e132ce15e8444de4df123265b3f490f7e2f8346631122cb5b709',
  '2026-09-21T22:54:44.000Z',
  'https://www.gov.cn/zhengce/zhengceku/202511/content_7047091.htm'
);

INSERT INTO holiday_date (holiday_date) VALUES
  ('2026-01-01'),
  ('2026-01-02'),
  ('2026-01-03'),
  ('2026-02-15'),
  ('2026-02-16'),
  ('2026-02-17'),
  ('2026-02-18'),
  ('2026-02-19'),
  ('2026-02-20'),
  ('2026-02-21'),
  ('2026-02-22'),
  ('2026-02-23'),
  ('2026-04-04'),
  ('2026-04-05'),
  ('2026-04-06'),
  ('2026-05-01'),
  ('2026-05-02'),
  ('2026-05-03'),
  ('2026-05-04'),
  ('2026-05-05'),
  ('2026-06-19'),
  ('2026-06-20'),
  ('2026-06-21'),
  ('2026-09-25'),
  ('2026-09-26'),
  ('2026-09-27'),
  ('2026-10-01'),
  ('2026-10-02'),
  ('2026-10-03'),
  ('2026-10-04'),
  ('2026-10-05'),
  ('2026-10-06'),
  ('2026-10-07');
