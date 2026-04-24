import { apiService } from './base';
import { MapRoute, MapStop, MapShuttle } from '../../types/transit';

export const TransitService = {
  
  async getRoutesAndStops(): Promise<{ routes: MapRoute[], stops: MapStop[] }> {
    const routesResponse = await apiService.get<MapRoute[]>('/transit/routes');
    const stopsResponse = await apiService.get<MapStop[]>('/transit/stops');
    
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
    const response = await apiService.get<MapShuttle[]>('/transit/shuttles');  
    return response.data;
  }
};