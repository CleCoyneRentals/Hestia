/*
  Warnings:

  - The `home_type` column on the `homes` table would be dropped and recreated. This will lead to data loss if there is data in the column.

*/
-- CreateEnum
CREATE TYPE "home_type_enum" AS ENUM ('single_family', 'duplex', 'condo', 'townhouse', 'apartment', 'other');

-- CreateEnum
CREATE TYPE "room_type_enum" AS ENUM ('kitchen', 'bedroom', 'bathroom', 'living_room', 'dining_room', 'office', 'garage', 'basement', 'attic', 'laundry', 'closet', 'hallway', 'patio', 'balcony', 'other');

-- CreateEnum
CREATE TYPE "item_condition_enum" AS ENUM ('excellent', 'good', 'fair', 'poor');

-- AlterTable
ALTER TABLE "homes" DROP COLUMN "home_type",
ADD COLUMN     "home_type" "home_type_enum";
