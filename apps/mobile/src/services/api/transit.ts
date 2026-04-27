import { apiService } from './base';
import { MapRoute, MapStop, MapShuttle, RouteArrival } from '../../types/transit';
import { API_CONFIG } from './config'

export const TransitService = {
  
  async getRoutesAndStops(): Promise<{ routes: MapRoute[], stops: MapStop[] }> {
    const routesResponse = await apiService.get<MapRoute[]>(API_CONFIG.ENDPOINTS.TRANSIT_ROUTES);
    const stopsResponse = await apiService.get<MapStop[]>(API_CONFIG.ENDPOINTS.TRANSIT_STOPS);
    
    if (__DEV__) {
      console.log('[transitService] Routes Data:', routesResponse.data);
      console.log('[transitService] Stops Data:', stopsResponse.data);
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
      console.log(`[transitService] Retrieved Stop ${stopId} Data:`, response.data);
    }

    return response.data;
  }
};