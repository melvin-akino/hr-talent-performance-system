-- 0031_computed_scores.sql
-- The computed score, stored with the inputs that produced it.
--
-- Until now `review_instance.overall_rating` was a number the reviewer typed.
-- The client's evaluation is arithmetic — points per line, summed, against a
-- declared maximum — so the number has to be computed and, more importantly,
-- has to stay explicable a year later when somebody disputes it.
--
-- ---------------------------------------------------------------------------
-- WHY STORE IT RATHER THAN COMPUTE ON READ
-- ---------------------------------------------------------------------------
-- The point map itself is already safe: an instance pins `form_version_id`, and
-- published versions are immutable (0012). Recomputing from that version would
-- give the same answer.
--
-- What recomputing would NOT preserve is everything else the arithmetic touched:
-- which classification column was used, and what the rating scale's maximum was
-- at the time. Both are outside the form version. A tenant that moves from a
-- 1-5 scale to a 1-6 scale would silently rescore every historical review on
-- read — the answers unchanged, the numbers different.
--
-- So the score is written once, at submission, alongside the inputs. This is
-- the same principle the schema already applies to definitions and instances:
-- a review does not change because something upstream did.

BEGIN;

ALTER TABLE review_instance
  -- Points earned and points available. Both, because "82" means nothing
  -- without knowing whether the form was out of 100 or out of 90 — and a form
  -- whose lines were left blank has a lower available than its template's
  -- declared maximum.
  ADD COLUMN computed_score     NUMERIC(7,2),
  ADD COLUMN computed_available NUMERIC(7,2),
  -- Which point column was used. Null for a single-column form.
  ADD COLUMN scored_classification TEXT,
  -- The scale maximum the ratings were read against.
  ADD COLUMN scored_scale_max   NUMERIC(6,3),
  ADD COLUMN scored_at          TIMESTAMPTZ,

  -- All of it or none of it. A score with no record of what produced it is the
  -- thing this migration exists to prevent.
  ADD CONSTRAINT review_instance_score_complete CHECK (
    (computed_score IS NULL AND computed_available IS NULL
      AND scored_scale_max IS NULL AND scored_at IS NULL)
    OR
    (computed_score IS NOT NULL AND computed_available IS NOT NULL
      AND scored_scale_max IS NOT NULL AND scored_at IS NOT NULL)
  ),

  -- Earning more than was available means the arithmetic is wrong, not that
  -- somebody excelled. Over-achievement in the client's model is expressed by
  -- the conversion band ("100 up"), not by a line scoring above its points.
  ADD CONSTRAINT review_instance_score_within_available CHECK (
    computed_score IS NULL OR computed_score <= computed_available
  );

COMMENT ON COLUMN review_instance.computed_score IS
  'Points earned, computed at submission from the answers and the pinned form '
  'version. Never recomputed: see 0031.';
COMMENT ON COLUMN review_instance.scored_scale_max IS
  'The rating scale maximum used. Stored because the scale can change, and a '
  'historical review must not silently rescore when it does.';

COMMIT;
