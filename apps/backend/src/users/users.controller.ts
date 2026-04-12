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
} from '@nestjs/common';
import { UsersService } from './users.service';
import { UpdateNotificationPreferencesDto } from './dto/update-notification-preferences.dto';
import { Request } from 'express';

interface AuthenticatedRequest extends Request {
  user?: { email?: string };
}

/**
 * Handles user profile and favorites management.
 * User identification is by email (userId = email@csulb.edu).
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
}
