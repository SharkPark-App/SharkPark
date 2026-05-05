import {
  Controller,
  Get,
  Post,
  Delete,
  Patch,
  Param,
  Body,
  Req,
  HttpCode,
  HttpStatus,
  ForbiddenException,
  UseGuards,
} from '@nestjs/common';
import { Throttle } from '@nestjs/throttler';
import { UsersService } from './users.service';
import { UpdateNotificationPreferencesDto } from './dto/update-notification-preferences.dto';
import { ContributorGuard } from '../auth/contributor.guard';
import { Request } from 'express';

interface AuthenticatedRequest extends Request {
  user?: { email?: string };
}

/**
 * Handles user profile and favorites management.
 * User identification is by email (userId = email@csulb.edu).
 *
 * Push-token registration (POST me/push-token) lives in NotificationsController
 * to keep firebase-admin scoped to NotificationsModule.
 */
@Controller('users')
export class UsersController {
  constructor(private readonly usersService: UsersService) {}

  /** Verify the authenticated user matches the :userId param to prevent IDOR. */
  private assertOwner(req: AuthenticatedRequest, userId: string): void {
    if (req.user?.email !== userId) {
      throw new ForbiddenException('You can only access your own resources');
    }
  }

  /**
   * Personalized short-term forecast for the caller's favorite lots.
   * Requires both Azure AD authentication (global AzureAdGuard) and an
   * active contributor ping (ContributorGuard).
   */
  @Get('me/forecast')
  @UseGuards(ContributorGuard)
  @HttpCode(HttpStatus.OK)
  async getForecast(@Req() req: AuthenticatedRequest) {
    const email = req.user?.email;
    if (!email) {
      throw new ForbiddenException('Authenticated user email missing');
    }
    const data = await this.usersService.getForecast(email);
    return { success: true, data };
  }

  /**
   * Returns all data the backend holds for the authenticated user
   * (GDPR Art. 15 / CCPA §1798.110 portable export). Caller is identified
   * from the JWT (no :userId param → no IDOR surface). Writes a
   * USER_DATA_EXPORTED audit row with the same SHA-256(salt:email) actor
   * hash used for USER_DELETED, so an export is auditable without storing
   * reversible PII.
   *
   * Heavily throttled (3 / hour / IP) because the response is a multi-table
   * dump and each call writes an audit row — neither should be hammerable.
   * GDPR compliance does not require unlimited export attempts; ICO guidance
   * permits refusing "manifestly unfounded or excessive" repeat requests.
   */
  @Get('me/data')
  @Throttle({ default: { limit: 3, ttl: 3_600_000 } })
  @HttpCode(HttpStatus.OK)
  async getMyData(@Req() req: AuthenticatedRequest) {
    const email = req.user?.email;
    if (!email) {
      throw new ForbiddenException('Authenticated user email missing');
    }
    const data = await this.usersService.exportUserData(email);
    return { success: true, data };
  }

  @Get(':userId')
  @HttpCode(HttpStatus.OK)
  async getUser(@Req() req: AuthenticatedRequest, @Param('userId') userId: string) {
    this.assertOwner(req, userId);
    const user = await this.usersService.findOne(userId);
    return {
      success: true,
      data: user,
    };
  }

  @Get(':userId/favorites')
  @HttpCode(HttpStatus.OK)
  async getFavorites(@Req() req: AuthenticatedRequest, @Param('userId') userId: string) {
    this.assertOwner(req, userId);
    const favorites = await this.usersService.getFavorites(userId);
    return {
      success: true,
      user_id: userId,
      count: favorites.length,
      data: favorites.map((f) => f.lot_id),
    };
  }

  @Post(':userId/favorites/:lotId')
  @HttpCode(HttpStatus.CREATED)
  async addFavorite(
    @Req() req: AuthenticatedRequest,
    @Param('userId') userId: string,
    @Param('lotId') lotId: string,
  ) {
    this.assertOwner(req, userId);
    await this.usersService.addFavorite(userId, lotId);
    return {
      success: true,
      message: `Added lot ${lotId} to favorites`,
    };
  }

  @Delete(':userId/favorites/:lotId')
  @HttpCode(HttpStatus.OK)
  async removeFavorite(
    @Req() req: AuthenticatedRequest,
    @Param('userId') userId: string,
    @Param('lotId') lotId: string,
  ) {
    this.assertOwner(req, userId);
    await this.usersService.removeFavorite(userId, lotId);
    return {
      success: true,
      message: `Removed lot ${lotId} from favorites`,
    };
  }

  @Patch(':userId/notifications')
  @HttpCode(HttpStatus.OK)
  async updateNotifications(
    @Req() req: AuthenticatedRequest,
    @Param('userId') userId: string,
    @Body() preferences: UpdateNotificationPreferencesDto,
  ) {
    this.assertOwner(req, userId);
    const user = await this.usersService.updateNotificationPreferences(
      userId,
      preferences,
    );
    return {
      success: true,
      data: user,
    };
  }

  /**
   * Hard-deletes the caller's account (App Store Guideline 5.1.1(v) requirement
   * for any app with login). Cascades to favorites; writes a USER_DELETED
   * audit row with a hashed actor identifier (no reversible PII).
   *
   * Mobile clients should call DELETE /users/me; the explicit :userId form
   * exists for parity with the rest of the controller and is IDOR-protected.
   */
  @Delete('me')
  @HttpCode(HttpStatus.NO_CONTENT)
  async deleteMe(@Req() req: AuthenticatedRequest): Promise<void> {
    const email = req.user?.email;
    if (!email) {
      throw new ForbiddenException('Authenticated user email missing');
    }
    await this.usersService.deleteUser(email);
  }

  @Delete(':userId')
  @HttpCode(HttpStatus.NO_CONTENT)
  async deleteUser(
    @Req() req: AuthenticatedRequest,
    @Param('userId') userId: string,
  ): Promise<void> {
    this.assertOwner(req, userId);
    await this.usersService.deleteUser(userId);
  }
}
