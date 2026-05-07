import { Controller, Get, Param, ParseIntPipe } from '@nestjs/common';
import { Throttle } from '@nestjs/throttler';
import { ShuttleTrackerService } from './shuttle-tracker.service';
import { Public } from '../auth/public.decorator';

/** Controller for live shuttle tracking */
// Throttled to prevent abuse of PassioGO! connection on our behalf (could potentially break feature)
@Public()
@Controller('transit')
@Throttle({ default: { limit: 30, ttl: 60_000 } })
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

  /** Get list of ETAs for shuttles on route to specified stop */
  @Get('etas/:stopId')
  async getETAs(@Param('stopId', ParseIntPipe) stopId: number) {
    const etas = await this.shuttleTrackerService.getStopETAs(stopId.toString());

    return {
      success: true,
      data: etas,
      count: etas.length,
    };
  }
}