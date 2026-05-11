import { Injectable, Logger, OnModuleInit } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import * as admin from 'firebase-admin';
import { NotificationType } from '@prisma/client';
import { PrismaService } from '../database/database.module';
import { DebugPushType, type DebugSendPushDto } from './dto/debug-send-push.dto';

export interface PushPayload {
  title: string;
  body: string;
  data?: Record<string, string>;
}

export type NotificationContext = { lotId: string } | { eventId: string };

@Injectable()
export class NotificationsService implements OnModuleInit {
  private readonly logger = new Logger(NotificationsService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly config: ConfigService,
  ) {}

  onModuleInit() {
    if (admin.apps.length > 0) return;

    const projectId = this.config.get<string>('notifications.firebaseProjectId', '');
    const clientEmail = this.config.get<string>('notifications.firebaseClientEmail', '');
    const privateKey = this.config.get<string>('notifications.firebasePrivateKey', '');

    if (projectId && clientEmail && privateKey) {
      admin.initializeApp({
        credential: admin.credential.cert({ projectId, clientEmail, privateKey }),
      });
      this.logger.log('Firebase Admin initialized');
    } else {
      this.logger.warn(
        'FIREBASE_PROJECT_ID / FIREBASE_CLIENT_EMAIL / FIREBASE_PRIVATE_KEY not set — push notifications disabled',
      );
    }
  }

  async registerPushToken(userId: string, token: string, platform: string): Promise<void> {
    await this.prisma.pushToken.upsert({
      where: { token },
      create: { user_id: userId, token, platform },
      update: { user_id: userId, platform },
    });
  }

  async registerPushTokenByEmail(email: string, token: string, platform: string): Promise<void> {
    const user = await this.prisma.user.findUniqueOrThrow({
      where: { email },
      select: { id: true },
    });
    await this.registerPushToken(user.id, token, platform);
  }

  async debugPushTestByEmail(
    email: string,
    dto: DebugSendPushDto,
  ): Promise<{ sent: boolean; pushConfigured: boolean; tokenCount: number }> {
    const user = await this.prisma.user.findUniqueOrThrow({
      where: { email },
      select: { id: true },
    });

    const tokenCount = await this.prisma.pushToken.count({
      where: { user_id: user.id },
    });
    const pushConfigured = admin.apps.length > 0;

    if (!pushConfigured || tokenCount === 0) {
      return { sent: false, pushConfigured, tokenCount };
    }

    const payload = this.buildDebugPayload(dto);
    const sent = await this.sendPush(user.id, payload);
    return { sent, pushConfigured, tokenCount };
  }

  private buildDebugPayload(dto: DebugSendPushDto): PushPayload {
    const lotId = dto.lotId ?? 'G1';

    switch (dto.type) {
      case DebugPushType.FAVORITES_FILLING:
        return {
          title: 'Favorite Lot Filling Up',
          body: `${lotId} just passed 80% occupancy.`,
          data: { type: 'favorites_filling', lotId },
        };
      case DebugPushType.FAVORITES_CLEARING:
        return {
          title: 'Favorite Lot Clearing Up',
          body: `${lotId} dropped below 30% occupancy.`,
          data: { type: 'favorites_clearing', lotId },
        };
      case DebugPushType.SURGE:
        return {
          title: 'Campus Surge Alert',
          body: 'Multiple lots are over 90% full right now.',
          data: { type: 'surge' },
        };
      case DebugPushType.EVENTS:
        return {
          title: 'Campus Event Reminder',
          body: 'A campus event starts in about 2 hours.',
          data: { type: 'events' },
        };
      default:
        return {
          title: 'SharkPark Notification Test',
          body: 'Debug push was triggered.',
        };
    }
  }

  /**
   * Remove a push token belonging to the given user. Scoped by `user_id` so
   * a hostile actor cannot evict another user's device by guessing tokens.
   * Idempotent: returns silently if the token does not exist or already
   * belongs to a different user (e.g. token was reissued after a reinstall).
   */
  async unregisterPushTokenByEmail(email: string, token: string): Promise<void> {
    const user = await this.prisma.user.findUnique({
      where: { email },
      select: { id: true },
    });
    if (!user) return;
    await this.prisma.pushToken.deleteMany({
      where: { token, user_id: user.id },
    });
  }

  /**
   * Send an FCM push to every registered device for the given user.
   * Stale/unregistered tokens are removed automatically after a failed send.
   * Returns true if at least one device received the message.
   */
  async sendPush(userId: string, payload: PushPayload): Promise<boolean> {
    if (!admin.apps.length) return false;

    const rows = await this.prisma.pushToken.findMany({
      where: { user_id: userId },
      select: { token: true },
    });
    if (rows.length === 0) return false;

    const tokens = rows.map((r) => r.token);
    const result = await admin.messaging().sendEachForMulticast({
      tokens,
      notification: { title: payload.title, body: payload.body },
      ...(payload.data ? { data: payload.data } : {}),
    });

    const STALE_CODES = new Set([
      'messaging/registration-token-not-registered',
      'messaging/invalid-registration-token',
      'messaging/invalid-argument', // when triggered by token shape
    ]);
    const stale: string[] = [];
    for (let i = 0; i < result.responses.length; i++) {
      const r = result.responses[i];
      if (r.success) continue;
      if (r.error && STALE_CODES.has(r.error.code)) {
        stale.push(tokens[i]);
      } else {
        this.logger.warn(`FCM send failed for user ${userId}: ${r.error?.code ?? 'unknown'}`);
      }
    }
    if (stale.length > 0) {
      await this.prisma.pushToken.deleteMany({ where: { token: { in: stale } } });
    }

    return result.successCount > 0;
  }

  // Note: check-then-log is not atomic; a duplicate send is possible if two cron
  // processes overlap, but runCronJob holds a per-job advisory lock so this is benign.
  async hasRecentLog(
    userId: string,
    type: NotificationType,
    windowMs: number,
    context?: NotificationContext,
  ): Promise<boolean> {
    const since = new Date(Date.now() - windowMs);
    const lotId = context && 'lotId' in context ? context.lotId : undefined;
    const eventId = context && 'eventId' in context ? context.eventId : undefined;
    const count = await this.prisma.notificationLog.count({
      where: {
        user_id: userId,
        type,
        ...(lotId !== undefined ? { lot_id: lotId } : {}),
        ...(eventId !== undefined ? { event_id: eventId } : {}),
        sent_at: { gte: since },
      },
    });
    return count > 0;
  }

  async recentlyNotifiedUsers(
    userIds: string[],
    type: NotificationType,
    windowMs: number,
    context?: NotificationContext,
  ): Promise<Set<string>> {
    if (userIds.length === 0) return new Set();
    const since = new Date(Date.now() - windowMs);
    const lotId = context && 'lotId' in context ? context.lotId : undefined;
    const eventId = context && 'eventId' in context ? context.eventId : undefined;
    const rows = await this.prisma.notificationLog.findMany({
      where: {
        user_id: { in: userIds },
        type,
        ...(lotId !== undefined ? { lot_id: lotId } : {}),
        ...(eventId !== undefined ? { event_id: eventId } : {}),
        sent_at: { gte: since },
      },
      select: { user_id: true },
    });
    return new Set(rows.map((r) => r.user_id));
  }

  async logNotification(userId: string, type: NotificationType, context?: NotificationContext): Promise<void> {
    const lotId = context && 'lotId' in context ? context.lotId : null;
    const eventId = context && 'eventId' in context ? context.eventId : null;
    await this.prisma.notificationLog.create({
      data: { user_id: userId, type, lot_id: lotId, event_id: eventId },
    });
  }

  /**
   * Retention prune: delete `notification_logs` rows older than `retentionDays`.
   *
   * The dedup window read by `wasRecentlyNotified` is bounded by an explicit
   * `gte: since` filter (millisecond-resolution `windowMs`), so older rows
   * never affect dedup behavior — they are pure history. Keeping them
   * indefinitely is a privacy-data-minimization issue (each row links a
   * user to a lot at a moment in time) and an unbounded growth source on
   * the `idx_notification_log_dedup` index.
   *
   * 90 days is comfortably wider than any current dedup window (longest is
   * 30 days for `notify-events`) and matches the retention rationale used
   * for diagnostic logs elsewhere in the stack.
   */
  async pruneOldLogs(
    retentionDays: number = 90,
  ): Promise<{ logs_deleted: number; cutoff: string }> {
    if (!Number.isFinite(retentionDays) || retentionDays < 1) {
      throw new Error(
        `pruneOldLogs: retentionDays must be >= 1, got ${retentionDays}`,
      );
    }
    const cutoff = new Date(Date.now() - retentionDays * 24 * 60 * 60 * 1000);
    const { count } = await this.prisma.notificationLog.deleteMany({
      where: { sent_at: { lt: cutoff } },
    });
    this.logger.log(
      `[retention] Pruned ${count} notification_logs older than ${retentionDays}d (cutoff=${cutoff.toISOString()})`,
    );
    return { logs_deleted: count, cutoff: cutoff.toISOString() };
  }
}
