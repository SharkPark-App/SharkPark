import { Injectable, Logger, OnModuleInit } from '@nestjs/common';
import * as admin from 'firebase-admin';
import { PrismaService } from '../database/database.module';

export interface PushPayload {
  title: string;
  body: string;
  data?: Record<string, string>;
}

@Injectable()
export class NotificationsService implements OnModuleInit {
  private readonly logger = new Logger(NotificationsService.name);

  constructor(private readonly prisma: PrismaService) {}

  onModuleInit() {
    if (admin.apps.length > 0) return;

    const projectId = process.env.FIREBASE_PROJECT_ID;
    const clientEmail = process.env.FIREBASE_CLIENT_EMAIL;
    const privateKey = process.env.FIREBASE_PRIVATE_KEY?.replace(/\\n/g, '\n');

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

    const stale = result.responses.flatMap((r, i) => (r.success ? [] : [tokens[i]]));
    if (stale.length > 0) {
      await this.prisma.pushToken.deleteMany({ where: { token: { in: stale } } });
    }

    return result.successCount > 0;
  }

  async hasRecentLog(
    userId: string,
    type: string,
    windowMs: number,
    contextId?: string,
  ): Promise<boolean> {
    const since = new Date(Date.now() - windowMs);
    const count = await this.prisma.notificationLog.count({
      where: {
        user_id: userId,
        type,
        ...(contextId ? { lot_id: contextId } : {}),
        sent_at: { gte: since },
      },
    });
    return count > 0;
  }

  async logNotification(userId: string, type: string, contextId?: string): Promise<void> {
    await this.prisma.notificationLog.create({
      data: { user_id: userId, type, lot_id: contextId ?? null },
    });
  }
}
