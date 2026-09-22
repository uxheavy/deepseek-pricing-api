-- Corrects the pinned holiday set seeded by 0001.
--
-- 0001 claims the pinned `holiday-cn` 2026 manifest by its SHA-256 but seeds
-- only 33 of the manifest's 39 non-workday dates, omitting six days the
-- manifest lists as holidays. Every omitted date is a weekday that the service
-- would therefore price as peak when it is published as off-peak, which is the
-- exact error the manifest exists to prevent.
--
-- The omitted dates are restatements of the surrounding festival windows:
-- 2026-01-04 (New Year), 2026-02-14 and 2026-02-28 (Spring Festival),
-- 2026-05-09 (Labour Day), 2026-09-20 and 2026-10-10 (National Day). They are
-- recovered from the same pinned manifest 0001 already names, not from a new
-- source, so the manifest hash, coverage, and notice URL are unchanged.
--
-- 0001 is left untouched because it is already applied to deployed databases
-- and its content hash is recorded; editing it in place would make the source
-- disagree with every environment that has run it.

INSERT OR IGNORE INTO holiday_date (holiday_date) VALUES
  ('2026-01-04'),
  ('2026-02-14'),
  ('2026-02-28'),
  ('2026-05-09'),
  ('2026-09-20'),
  ('2026-10-10');
