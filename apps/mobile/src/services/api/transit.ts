import { apiService } from './base';
import { MapRoute, MapStop, MapShuttle, RouteArrival } from '../../types/transit';
import { API_CONFIG } from './config'

export const TransitService = {
  
  async getRoutesAndStops(): Promise<{ routes: MapRoute[], stops: MapStop[] }> {
    const routesResponse = await apiService.get<MapRoute[]>(API_CONFIG.ENDPOINTS.TRANSIT_ROUTES);
    const stopsResponse = await apiService.get<MapStop[]>(API_CONFIG.ENDPOINTS.TRANSIT_STOPS);
    
    if (__DEV__) {
      !routesResponse.success? console.log(`[transitService] Failed to load routes`)
      : console.log(`[transitService] Successfully loaded ${routesResponse.count} routes`)
      
      !stopsResponse.success? console.log(`[transitService] Failed to load stops`)
      : console.log(`[transitService] Successfully loaded ${stopsResponse.count} stops`)
    }

    return {
      routes: routesResponse.data,
      stops: stopsResponse.data
    };
  },

  async getLiveShuttles(): Promise<MapShuttle[]> {
    const response = await apiService.get<MapShuttle[]>(API_CONFIG.ENDPOINTS.TRANSIT_SHUTTLES);  
    return response.data;
  },

  async getStopETAs(stopId: string): Promise<RouteArrival[]> {
    const response = await apiService.get<RouteArrival[]>(API_CONFIG.ENDPOINTS.TRANSIT_ETAS(stopId));

    if (__DEV__) {
      response.success? console.log(`[transitService] Retrieved ETAs for Stop ${stopId}`)
      : console.log(`[transitService] Failed to retrieve ETAs for Stop ${stopId}`)
    }

    return response.data;
  }
};