-- Phase C: add Lot.is_structure boolean for multi-level parking structures.
-- PVN/PVS/PYR at CSULB are the three structures; populated by seed.
ALTER TABLE "lots" ADD COLUMN "is_structure" BOOLEAN NOT NULL DEFAULT false;
