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

export interface UserDataExport {
  exported_at: Date;
  profile: {
    email: string;
    first_name: string;
    last_name: string;
    user_type: string;
    phone: string | null;
    notification_preferences: unknown;
    created_at: Date;
    last_login: Date | null;
  };
  favorites: { lot_id: string; added_at: Date }[];
  // `token_preview` is the last 6 chars of the raw FCM/APNs token (e.g. "…aB3xY9").
  // The full token is never returned by /me/data — see UsersService.exportUserData
  // for rationale. The preview is enough for a user to identify which device a
  // registration belongs to without exposing a value that can be used to send
  // unauthenticated push notifications.
  push_tokens: { token_preview: string; platform: string; registered_at: Date }[];
  reports: { lot_id: string; type: string; message: string | null; submitted_at: Date }[];
  notification_logs: { type: string; lot_id: string | null; sent_at: Date }[];
}
