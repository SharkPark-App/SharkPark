import {
  Controller,
  Get,
  Post,
  Delete,
  Patch,
  Param,
  Body,
  HttpCode,
  HttpStatus,
  UseGuards
} from '@nestjs/common';
import { UsersService } from './users.service';
import { UpdateNotificationPreferencesDto } from './dto/update-notification-preferences.dto';
import { AuthGuard } from '@nestjs/passport';

/**
 * Handles user profile and favorites management.
 * User identification is by email (userId = email@csulb.edu).
 */
@Controller('users')
export class UsersController {
  constructor(private readonly usersService: UsersService) {}

  /**
   * AuthGuards affirm that a valid Azure AD user is calling these endpoints.
   * These will need to be removed if user data is to be made accessible by anyone.
   */
  @UseGuards(AuthGuard('azure-ad'))
  @Get(':userId')
  @HttpCode(HttpStatus.OK)
  async getUser(@Param('userId') userId: string) {
    const user = await this.usersService.findOne(userId);
    return {
      success: true,
      data: user,
    };
  }

  @UseGuards(AuthGuard('azure-ad'))
  @Get(':userId/favorites')
  @HttpCode(HttpStatus.OK)
  async getFavorites(@Param('userId') userId: string) {
    const favorites = await this.usersService.getFavorites(userId);
    return {
      success: true,
      user_id: userId,
      count: favorites.length,
      data: favorites.map((f) => f.lot_id),
    };
  }

  @UseGuards(AuthGuard('azure-ad'))
  @Post(':userId/favorites/:lotId')
  @HttpCode(HttpStatus.CREATED)
  async addFavorite(
    @Param('userId') userId: string,
    @Param('lotId') lotId: string,
  ) {
    await this.usersService.addFavorite(userId, lotId);
    return {
      success: true,
      message: `Added lot ${lotId} to favorites`,
    };
  }

  @UseGuards(AuthGuard('azure-ad'))
  @Delete(':userId/favorites/:lotId')
  @HttpCode(HttpStatus.OK)
  async removeFavorite(
    @Param('userId') userId: string,
    @Param('lotId') lotId: string,
  ) {
    await this.usersService.removeFavorite(userId, lotId);
    return {
      success: true,
      message: `Removed lot ${lotId} from favorites`,
    };
  }

  @UseGuards(AuthGuard('azure-ad'))
  @Patch(':userId/notifications')
  @HttpCode(HttpStatus.OK)
  async updateNotifications(
    @Param('userId') userId: string,
    @Body() preferences: UpdateNotificationPreferencesDto,
  ) {
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
