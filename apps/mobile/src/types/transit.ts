/** Reflections of rsepective backend types */

export interface MapStop {
  id: string;
  name: string;
  latitude: number;
  longitude: number;
  routeId: string;
  color: string;
}

export interface MapRoute {
  id: string;
  name: string;
  shortName: string;
  color: string;
  status: string;
  coordinates: { latitude: number; longitude: number }[];
}

export interface MapShuttle {
  id: string;
  busName: string;
  color?: string;
  routeId: string;
  route: string;
  latitude: number;
  longitude: number;
  heading?: number;
  paxLoad: number;
  capacity: number;
}

export interface ShuttleLocationUpdate {
  id: string;
  latitude: number;
  longitude: number;
  heading: number;
  paxLoad: number;
}

export interface RouteArrival {
  routeId: string;
  routeName: string;
  abbreviation: string;
  color: string;
  etaMinutes: number | null;
}