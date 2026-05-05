import {
  Controller,
  Post,
  Delete,
  Body,
  Req,
  HttpCode,
  HttpStatus,
  UnauthorizedException,
} from '@nestjs/common';
import { Request } from 'express';
import { NotificationsService } from './notifications.service';
import { RegisterPushTokenDto } from './dto/register-push-token.dto';
import { UnregisterPushTokenDto } from './dto/unregister-push-token.dto';

interface AuthenticatedRequest extends Request {
  user?: { email?: string };
}

@Controller('users')
export class NotificationsController {
  constructor(private readonly notificationsService: NotificationsService) {}

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
}

