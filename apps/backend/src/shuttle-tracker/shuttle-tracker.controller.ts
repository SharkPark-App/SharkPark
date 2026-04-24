import { Controller, Get } from '@nestjs/common';
import { ShuttleTrackerService } from './shuttle-tracker.service';

/** Controller for live shuttle tracking */
@Controller('transit')
export class ShuttleTrackerController {
  constructor(private readonly shuttleTrackerService: ShuttleTrackerService) {}

  /** Get list of active shuttles */
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
  @Get('stops')
  getStops() {
    const stops = this.shuttleTrackerService.getCurrentStops();

    return {
      success: true,
      data: stops,
      count: stops.length,
    };
  }
}