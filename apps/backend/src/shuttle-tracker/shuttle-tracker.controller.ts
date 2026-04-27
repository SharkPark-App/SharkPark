import { Controller, Get, Query, BadRequestException } from '@nestjs/common';
import { ShuttleTrackerService } from './shuttle-tracker.service';
import { Public } from '../auth/public.decorator';

/** Controller for live shuttle tracking */
@Controller('transit')
export class ShuttleTrackerController {
  constructor(private readonly shuttleTrackerService: ShuttleTrackerService) {}

  /** Get list of active shuttles */
  @Public()
  @Get('shuttles')
  getShuttles() {
    const shuttles = this.shuttleTrackerService.getCurrentShuttles();

    return {
      success: true,
      data: shuttles,
      count: shuttles.length,
    };
  }

  /** Get list of current routes */
  @Public()
  @Get('routes')
  getRoutes() {
    const routes = this.shuttleTrackerService.getCurrentRoutes();

    return {
      success: true,
      data: routes,
      count: routes.length,
    };
  }

  /** Get list of current stops */
  @Public()
  @Get('stops')
  getStops() {
    const stops = this.shuttleTrackerService.getCurrentStops();

    return {
      success: true,
      data: stops,
      count: stops.length,
    };
  }

  /** Get list of ETAs for shuttles on route to specified stop */
  @Public()
  @Get('etas')
  async getETAs(@Query('stopId') stopId: string) {
    if (!stopId) {
      throw new BadRequestException('stopId query parameter is required');
    }

    const etas = await this.shuttleTrackerService.getStopETAs(stopId);

    return {
      success: true,
      data: etas,
      count: etas.length,
    };
  }
}