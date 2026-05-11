import {
  Controller,
  Post,
  Delete,
  Body,
  Req,
  HttpCode,
  HttpStatus,
  UnauthorizedException,
  ForbiddenException,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { Request } from 'express';
import { NotificationsService } from './notifications.service';
import { RegisterPushTokenDto } from './dto/register-push-token.dto';
import { UnregisterPushTokenDto } from './dto/unregister-push-token.dto';
import { DebugSendPushDto } from './dto/debug-send-push.dto';

interface AuthenticatedRequest extends Request {
  user?: { email?: string };
}

@Controller('users')
export class NotificationsController {
  constructor(
    private readonly notificationsService: NotificationsService,
    private readonly configService: ConfigService,
  ) {}

  /**
   * Register/refresh a device push token for the authenticated user.
   * Upserting on token means re-registering after an app reinstall is safe.
   */
  @Post('me/push-token')
  @HttpCode(HttpStatus.NO_CONTENT)
  async registerPushToken(
    @Req() req: AuthenticatedRequest,
    @Body() dto: RegisterPushTokenDto,
  ): Promise<void> {
    const email = req.user?.email;
    if (!email) {
      throw new UnauthorizedException('Authenticated user email missing');
    }
    await this.notificationsService.registerPushTokenByEmail(email, dto.token, dto.platform);
  }

  /**
   * Unregister a device push token on logout / device handoff. Scoped to
   * the authenticated user so a malicious client cannot evict another
   * user's token. Idempotent — deleting a non-existent or already-rotated
   * token is a no-op.
   */
  @Delete('me/push-token')
  @HttpCode(HttpStatus.NO_CONTENT)
  async unregisterPushToken(
    @Req() req: AuthenticatedRequest,
    @Body() dto: UnregisterPushTokenDto,
  ): Promise<void> {
    const email = req.user?.email;
    if (!email) {
      throw new UnauthorizedException('Authenticated user email missing');
    }
    await this.notificationsService.unregisterPushTokenByEmail(email, dto.token);
  }

  /**
   * Dev-only endpoint: trigger a real backend -> FCM push send for the
   * authenticated user, useful for validating delivery and tap routing.
   */
  @Post('me/push-test')
  @HttpCode(HttpStatus.OK)
  async sendPushTest(
    @Req() req: AuthenticatedRequest,
    @Body() dto: DebugSendPushDto,
  ): Promise<{ sent: boolean; pushConfigured: boolean; tokenCount: number }> {
    const isProduction = this.configService.get<string>('NODE_ENV') === 'production';
    const debugPushEnabled = this.configService.get<string>('ENABLE_DEBUG_PUSH_TEST') === 'true';
    if (isProduction || !debugPushEnabled) {
      throw new ForbiddenException('Push test endpoint is disabled (set ENABLE_DEBUG_PUSH_TEST=true in non-production environments)');
    }

    const email = req.user?.email;
    if (!email) {
      throw new UnauthorizedException('Authenticated user email missing');
    }

    return this.notificationsService.debugPushTestByEmail(email, dto);
  }
}

