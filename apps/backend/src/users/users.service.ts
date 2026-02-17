import { Injectable, NotFoundException, Logger } from '@nestjs/common';
import { PrismaService } from '../database/database.module';
import type { UserType } from '@prisma/client';
import type { UserResponse } from './interfaces/user.interface';

/**
 * Service for user profile and favorites management.
 * Users are identified by their CSULB email address.
 */
@Injectable()
export class UsersService {
  private readonly logger = new Logger(UsersService.name);

  constructor(private readonly prisma: PrismaService) {}

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
        phone: user.phone,
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

  /** Updates user's notification preferences. */
  async updateNotificationPreferences(
    userId: string,
    preferences: Record<string, boolean>,
  ): Promise<UserResponse> {
    const user = await this.prisma.user.findUnique({ where: { email: userId } });
    if (!user) {
      throw new NotFoundException(`User ${userId} not found`);
    }

    try {
      await this.prisma.user.update({
        where: { email: userId },
        data: { notification_preferences: preferences },
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
          phone: existingUser.phone,
          notification_preferences: existingUser.notification_preferences,
          created_at: existingUser.created_at,
          last_login: now,
          favorites: existingUser.favorites.map((f) => f.lot_id),
        };
      }

      // Determine user type from email
      const userType: UserType = email.includes('@student') ? 'STUDENT' : 'EMPLOYEE';

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
        phone: newUser.phone,
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
}
