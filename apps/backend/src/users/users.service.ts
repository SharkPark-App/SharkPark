import { Injectable, NotFoundException, Logger } from '@nestjs/common';
import { createHash } from 'crypto';
import { PrismaService } from '../database/database.module';
import type { UserType } from '@prisma/client';
import type { UserResponse, UserDataExport } from './interfaces/user.interface';
import type { UpdateNotificationPreferencesDto } from './dto/update-notification-preferences.dto';

/**
 * Returns the last 6 chars of a push token, prefixed with an ellipsis.
 * Used by /me/data to disclose token existence without leaking a value
 * that can be used to send unauthenticated push notifications.
 */
function maskToken(token: string): string {
  if (token.length <= 6) return '\u2026' + token;
  return '\u2026' + token.slice(-6);
}

/**
 * Service for user profile and favorites management.
 * Users are identified by their CSULB email address.
 */
@Injectable()
export class UsersService {
  private readonly logger = new Logger(UsersService.name);

  constructor(private readonly prisma: PrismaService) {}

  /**
   * SHA-256(salt:email) — same salt as occupancy-event device hashing.
   * Used for audit-log actor identification so the row carries no
   * reversible PII after the user is deleted.
   */
  private hashEmail(email: string): string {
    const salt = process.env.DEVICE_HASH_SALT || 'dev-unsalted';
    return createHash('sha256').update(`${salt}:${email.toLowerCase()}`).digest('hex');
  }


  /** Retrieves user profile with their favorited parking lots. */
  async findOne(userId: string): Promise<UserResponse> {
    try {
      const user = await this.prisma.user.findUnique({
        where: { email: userId },
        include: { favorites: true },
      });

      if (!user) {
        throw new NotFoundException(`User ${userId} not found`);
      }

      return {
        id: user.id,
        email: user.email,
        first_name: user.first_name,
        last_name: user.last_name,
        user_type: user.user_type,
        notification_preferences: user.notification_preferences,
        created_at: user.created_at,
        last_login: user.last_login,
        favorites: user.favorites.map((f) => f.lot_id),
      };
    } catch (error) {
      if (error instanceof NotFoundException) {
        throw error;
      }
      this.logger.error(`Failed to fetch user ${userId}`, error);
      throw error;
    }
  }

  /** Retrieves user's favorite lots. */
  async getFavorites(userId: string): Promise<{ lot_id: string; added_at: Date }[]> {
    const user = await this.prisma.user.findUnique({ where: { email: userId } });
    if (!user) {
      throw new NotFoundException(`User ${userId} not found`);
    }

    const favorites = await this.prisma.userFavorite.findMany({
      where: { user_id: user.id },
      include: { lot: true },
    });

    return favorites.map(f => ({
      lot_id: f.lot.lot_id,
      added_at: f.added_at,
    }));
  }

  /** Adds a parking lot to user's favorites. */
  async addFavorite(userId: string, lotId: string): Promise<void> {
    // Verify user exists
    const user = await this.prisma.user.findUnique({ where: { email: userId } });
    if (!user) {
      throw new NotFoundException(`User ${userId} not found`);
    }

    // Find the lot by human-readable lot_id
    const lot = await this.prisma.lot.findFirst({ where: { lot_id: lotId } });
    if (!lot) {
      throw new NotFoundException(`Lot ${lotId} not found`);
    }

    try {
      await this.prisma.userFavorite.upsert({
        where: { user_id_lot_id: { user_id: user.id, lot_id: lot.id } },
        update: {},
        create: { user_id: user.id, lot_id: lot.id },
      });
      this.logger.log(`Added favorite ${lotId} for user ${userId}`);
    } catch (error) {
      this.logger.error(`Failed to add favorite ${lotId} for user ${userId}`, error);
      throw error;
    }
  }

  /** Removes a parking lot from user's favorites. */
  async removeFavorite(userId: string, lotId: string): Promise<void> {
    const user = await this.prisma.user.findUnique({ where: { email: userId } });
    if (!user) {
      throw new NotFoundException(`User ${userId} not found`);
    }

    const lot = await this.prisma.lot.findFirst({ where: { lot_id: lotId } });
    if (!lot) {
      throw new NotFoundException(`Lot ${lotId} not found`);
    }

    try {
      await this.prisma.userFavorite.deleteMany({
        where: { user_id: user.id, lot_id: lot.id },
      });
      this.logger.log(`Removed favorite ${lotId} for user ${userId}`);
    } catch (error) {
      this.logger.error(`Failed to remove favorite ${lotId} for user ${userId}`, error);
      throw error;
    }
  }

  /** Updates user's notification preferences. Merges with existing preferences. */
  async updateNotificationPreferences(
    userId: string,
    preferences: UpdateNotificationPreferencesDto,
  ): Promise<UserResponse> {
    const user = await this.prisma.user.findUnique({ where: { email: userId } });
    if (!user) {
      throw new NotFoundException(`User ${userId} not found`);
    }

    try {
      // Merge incoming partial preferences with existing ones
      const existing = (user.notification_preferences ?? {}) as Record<string, boolean>;
      const merged = { ...existing, ...preferences };

      await this.prisma.user.update({
        where: { email: userId },
        data: { notification_preferences: merged },
      });
      this.logger.log(`Updated notification preferences for user ${userId}`);
      return this.findOne(userId);
    } catch (error) {
      this.logger.error(`Failed to update notification preferences for user ${userId}`, error);
      throw error;
    }
  }

  /** Updates a user profile, or creates one if nonexistent. */
  async findOrCreateUser(email: string, firstName: string, lastName: string): Promise<UserResponse> {
    const now = new Date();

    try {
      // Try to find existing user
      const existingUser = await this.prisma.user.findUnique({
        where: { email },
        include: { favorites: true },
      });

      if (existingUser) {
        // Update last_login
        await this.prisma.user.update({
          where: { email },
          data: { last_login: now },
        });

        return {
          id: existingUser.id,
          email: existingUser.email,
          first_name: existingUser.first_name,
          last_name: existingUser.last_name,
          user_type: existingUser.user_type,
          notification_preferences: existingUser.notification_preferences,
          created_at: existingUser.created_at,
          last_login: now,
          favorites: existingUser.favorites.map((f) => f.lot_id),
        };
      }

      // Determine user type from email domain. STUDENT is the @student.csulb.edu
      // sub-domain; everything else under csulb.edu is treated as EMPLOYEE.
      // Note: this column is metadata-only and gates no endpoint (see
      // docs/api-access-tiers.md).
      const userType: UserType = email.toLowerCase().endsWith('@student.csulb.edu')
        ? 'STUDENT'
        : 'EMPLOYEE';

      // Get default school (CSULB)
      const school = await this.prisma.school.findFirst({
        where: { short_name: 'CSULB' },
      });

      if (!school) {
        throw new Error('Default school (CSULB) not found. Run seed first.');
      }

      const newUser = await this.prisma.user.create({
        data: {
          school_id: school.id,
          email,
          first_name: firstName,
          last_name: lastName,
          user_type: userType,
          last_login: now,
          notification_preferences: {
            favorites_filling: false,
            favorites_clearing: false,
            surge_alerts: false,
            event_alerts: false,
          },
        },
      });

      this.logger.log(`Created new user: ${email}`);

      return {
        id: newUser.id,
        email: newUser.email,
        first_name: newUser.first_name,
        last_name: newUser.last_name,
        user_type: newUser.user_type,
        notification_preferences: newUser.notification_preferences,
        created_at: newUser.created_at,
        last_login: newUser.last_login,
        favorites: [],
      };
    } catch (error) {
      this.logger.error(`Failed to find or create profile for user ${email}`, error);
      throw error;
    }
  }

  /** Returns short-term predictions for each of the user's favorited lots. */
  async getForecast(email: string): Promise<{
    user_id: string;
    generated_at: string;
    lots: Array<{
      lot_id: string;
      predictions: Array<{
        target_time: string;
        predicted_occupancy: number;
        confidence_lower: number;
        confidence_upper: number;
        model_version: string;
      }>;
    }>;
  }> {
    const user = await this.prisma.user.findUnique({
      where: { email },
      include: { favorites: { include: { lot: true } } },
    });
    if (!user) {
      throw new NotFoundException(`User ${email} not found`);
    }

    const now = new Date();
    const favsByLotId = new Map(user.favorites.map((fav) => [fav.lot.id, fav.lot.lot_id]));

    const allPredictions = await this.prisma.predictionShortTerm.findMany({
      where: { lot_id: { in: [...favsByLotId.keys()] }, target_time: { gte: now } },
      orderBy: { target_time: 'asc' },
    });

    // Group predictions by lot, capped at 20 per lot to match per-lot endpoint pattern
    const byLot = new Map<string, typeof allPredictions>();
    for (const p of allPredictions) {
      const bucket = byLot.get(p.lot_id) ?? [];
      if (bucket.length < 20) bucket.push(p);
      byLot.set(p.lot_id, bucket);
    }

    const lots = [...favsByLotId.entries()].map(([internalId, lotId]) => ({
      lot_id: lotId,
      predictions: (byLot.get(internalId) ?? []).map((p) => ({
        target_time: p.target_time.toISOString(),
        predicted_occupancy: p.predicted_occupancy,
        confidence_lower: p.confidence_lower,
        confidence_upper: p.confidence_upper,
        model_version: p.model_version,
      })),
    }));

    return { user_id: email, generated_at: now.toISOString(), lots };
  }

  /**
   * Returns all data held for the authenticated user (GDPR Art. 15 /
   * CCPA §1798.110 export). Writes a USER_DATA_EXPORTED audit row with
   * a hashed actor identifier in the same call so the export is
   * auditable without storing reversible PII.
   *
   * Internal database `id` is intentionally omitted; lot references use
   * the human-readable `lot_id` (e.g. "G1") rather than internal UUIDs.
   */
  async exportUserData(email: string): Promise<UserDataExport> {
    // Audit row + read live in the same interactive $transaction so a half-success
    // (data returned but no audit row, or an audit row for a ghost user) is not
    // possible. If the user lookup misses, the throw rolls back the audit write.
    // Mirrors the durability guarantee deleteUser() gets from its $transaction.
    // Bounded reads. The export is a single in-memory NestJS response; an
    // attacker (or buggy client) replaying /me/data against a long-lived
    // account with thousands of notification_logs/reports could OOM the
    // worker. Caps are well above any realistic legitimate value:
    //   favorites          → 100  (campus has ~50 lots)
    //   push_tokens        → 50   (typical user has 1–3 devices)
    //   reports            → 1000 (a heavy reporter ≈ 1–2/week for years)
    //   notification_logs  → 5000 (~4 notifs/week × 4 years ≈ 832)
    // If a user is ever truncated, they will see the most recent rows in
    // each list (orderBy ... desc); follow-up paginated export is tracked
    // separately. The caps satisfy GDPR Art. 15 in practice while bounding
    // worst-case memory on the API worker.
    const user = await this.prisma.$transaction(async (tx) => {
      const found = await tx.user.findUnique({
        where: { email },
        include: {
          favorites: {
            include: { lot: { select: { lot_id: true } } },
            orderBy: { added_at: 'desc' },
            take: 100,
          },
          push_tokens: {
            select: { token: true, platform: true, created_at: true },
            orderBy: { created_at: 'desc' },
            take: 50,
          },
          reports: {
            include: { lot: { select: { lot_id: true } } },
            orderBy: { created_at: 'desc' },
            take: 1000,
          },
          notification_logs: {
            include: { lot: { select: { lot_id: true } } },
            orderBy: { sent_at: 'desc' },
            take: 5000,
          },
        },
      });
      if (!found) {
        throw new NotFoundException(`User ${email} not found`);
      }
      await tx.auditEvent.create({
        data: {
          event_type: 'USER_DATA_EXPORTED',
          actor_hash: this.hashEmail(email),
        },
      });
      return found;
    });

    return {
      exported_at: new Date(),
      profile: {
        email: user.email,
        first_name: user.first_name,
        last_name: user.last_name,
        user_type: user.user_type,
        notification_preferences: user.notification_preferences,
        created_at: user.created_at,
        last_login: user.last_login,
      },
      favorites: user.favorites.map((f) => ({
        lot_id: f.lot.lot_id,
        added_at: f.added_at,
      })),
      // Push tokens are intentionally redacted: the raw FCM/APNs token can be
      // used by anyone who holds it to send unauthenticated push notifications
      // until the OS rotates it. Disclosing platform + last-6 + registered_at
      // is sufficient to satisfy GDPR Art. 15 ("what we hold") without making
      // the export file weaponizable if it leaks (e.g. via the user's cloud
      // sync). Users can revoke any token by uninstalling or signing out.
      push_tokens: user.push_tokens.map((t) => ({
        token_preview: maskToken(t.token),
        platform: t.platform,
        registered_at: t.created_at,
      })),
      reports: user.reports.map((r) => ({
        lot_id: r.lot.lot_id,
        type: r.type,
        message: r.message,
        submitted_at: r.created_at,
      })),
      notification_logs: user.notification_logs.map((n) => ({
        type: n.type,
        lot_id: n.lot?.lot_id ?? null,
        sent_at: n.sent_at,
      })),
    };
  }

  /**
   * Hard-deletes a user and cascades to favorites, occupancy events, notification
   * logs, and reports (per schema FK rules).
   * Writes a USER_DELETED audit row in the same transaction so a deletion
   * is auditable even after the row is gone. The audit row stores only
   * SHA-256(salt:email), no reversible PII.
   *
   * Apple App Store has required this since 2022 for any app with login.
   */
  async deleteUser(userId: string): Promise<void> {
    const user = await this.prisma.user.findUnique({ where: { email: userId } });
    if (!user) {
      throw new NotFoundException(`User ${userId} not found`);
    }

    const actorHash = this.hashEmail(userId);

    try {
      await this.prisma.$transaction([
        this.prisma.auditEvent.create({
          data: {
            event_type: 'USER_DELETED',
            actor_hash: actorHash,
            metadata: { user_type: user.user_type },
          },
        }),
        this.prisma.user.delete({ where: { email: userId } }),
      ]);
      this.logger.log(`Deleted user ${userId} (actor_hash=${actorHash.slice(0, 8)}…)`);
    } catch (error) {
      this.logger.error(`Failed to delete user ${userId}`, error);
      throw error;
    }
  }
}
