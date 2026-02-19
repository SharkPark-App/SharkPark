import type { User as PrismaUser, UserFavorite as PrismaUserFavorite } from '@prisma/client';

/**
 * Re-export Prisma types for convenience.
 */
export type User = PrismaUser;
export type UserFavorite = PrismaUserFavorite;

export interface UserResponse {
  id: string;
  email: string;
  first_name: string;
  last_name: string;
  user_type: string;
  phone: string | null;
  notification_preferences: unknown;
  created_at: Date;
  last_login: Date | null;
  favorites: string[];
}
