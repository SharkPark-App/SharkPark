import {
  Controller,
  Post,
  Body,
  Req,
  HttpCode,
  HttpStatus,
  ForbiddenException,
} from '@nestjs/common';
import { Request } from 'express';
import { NotificationsService } from './notifications.service';
import { RegisterPushTokenDto } from './dto/register-push-token.dto';

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
      throw new ForbiddenException('Authenticated user email missing');
    }
    await this.notificationsService.registerPushTokenByEmail(email, dto.token, dto.platform);
  }
}
