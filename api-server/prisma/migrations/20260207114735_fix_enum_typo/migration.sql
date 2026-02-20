/*
  Warnings:

  - The `status` column on the `Deployment` table would be dropped and recreated. This will lead to data loss if there is data in the column.

*/
-- CreateEnum
CREATE TYPE "DeploymentStatus" AS ENUM ('NOT_STARTED', 'QUEUED', 'IN_PROGRESS', 'READY', 'FAILED');

-- AlterTable
ALTER TABLE "Deployment" DROP COLUMN "status",
ADD COLUMN     "status" "DeploymentStatus" NOT NULL DEFAULT 'NOT_STARTED';

-- DropEnum
DROP TYPE "DeplymentStatus";
