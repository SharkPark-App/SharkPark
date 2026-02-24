import { Controller, Post, Get, Body, Param, Query } from '@nestjs/common';
import { ParkingValidationService } from './parking-validation.service';
import { CreateValidationEventDto } from './dto/create-validation-event.dto';
import { StartParkingSessionDto } from './dto/start-parking-session.dto';
import { EndParkingSessionDto } from './dto/end-parking-session.dto';

@Controller('validation')
export class ParkingValidationController {
  constructor(private readonly validationService: ParkingValidationService) {}

  /**
   * Record a new validation event from mobile device
   */
  @Post('events')
  async recordEvent(@Body() dto: CreateValidationEventDto) {
    const event = await this.validationService.recordValidationEvent(dto);
    return {
      success: true,
      data: event,
    };
  }

  /**
   * Start a parking session (called when entering lot geofence)
   */
  @Post('sessions/start')
  async startSession(@Body() body: StartParkingSessionDto) {
    const session = await this.validationService.startParkingSession(body);
    return {
      success: true,
      data: session,
    };
  }

  /**
   * End a parking session (called when exiting lot geofence)
   */
  @Post('sessions/end')
  async endSession(@Body() body: EndParkingSessionDto) {
    await this.validationService.endParkingSession(body);
    return {
      success: true,
      message: 'Session ended and analysis initiated',
    };
  }

  /**
   * Get validation statistics for a specific lot
   */
  @Get('lots/:lotId/stats')
  async getLotStats(
    @Param('lotId') lotId: string,
    @Query('hours') hours?: string,
  ) {
    const hoursNumber = hours ? parseInt(hours, 10) : 24;
    const stats = await this.validationService.getLotValidationStats(lotId, hoursNumber);
    return {
      success: true,
      data: stats,
    };
  }
}
