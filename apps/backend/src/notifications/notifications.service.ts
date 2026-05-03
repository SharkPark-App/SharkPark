import { Injectable, Logger, OnModuleInit } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import * as admin from 'firebase-admin';
import { NotificationType } from '@prisma/client';
import { PrismaService } from '../database/database.module';

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
}
