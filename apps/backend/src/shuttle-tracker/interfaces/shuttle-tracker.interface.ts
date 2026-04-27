/**
 * Representation of one route stop.
 */
export interface MapStop {
  id: string;
  name: string;
  latitude: number;
  longitude: number;
  color: string;
}

/**
 * Representation of one joint of one route.
 */
export interface MapRoute {
  id: string;
  name: string;
  shortName: string;
  color: string;
  coordinates: { latitude: number; longitude: number }[];
}

/**
 * Representation of one shuttle.
 */
export interface MapShuttle {
  id: string;
  busName: string;
  color?: string;
  route: string;
  latitude: number;
  longitude: number;
  heading?: number;
  paxLoad: number;
  capacity: number;
}

/**
 * Representation of the ETA of one shuttle.
 */
export interface RouteArrival {
  routeId: string;
  routeName: string;
  abbreviation: string;
  color: string;
  etaMinutes: number | null;
}