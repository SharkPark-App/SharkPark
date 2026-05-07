DROP INDEX "idx_pred_short";
DROP INDEX "idx_pred_long";

CREATE INDEX "idx_pred_short"
  ON "predictions_short_term" ("lot_id", "target_time", "predicted_at" DESC);

CREATE INDEX "idx_pred_long"
  ON "predictions_long_term" ("lot_id", "target_date", "target_hour", "predicted_at" DESC);
