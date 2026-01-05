import { ParkingLotUI } from '../types/ui';
import { scalePosition } from '../utils/mapUtils';

const rawParkingLots = [
  { id: 'G1', name: 'G1', occupancy: 45, category: 'general', position: { x: 325, y: 569 } },
  { id: 'G2', name: 'G2', occupancy: 67, category: 'general', position: { x: 217, y: 378 } },
  { id: 'G3', name: 'G3', occupancy: 78, category: 'general', position: { x: 453, y: 463 } },
  { id: 'G4', name: 'G4', occupancy: 82, category: 'general', position: { x: 392, y: 340 } },
  { id: 'G5', name: 'G5', occupancy: 56, category: 'general', position: { x: 512, y: 315 } },
  { id: 'G6', name: 'G6', occupancy: 91, category: 'general', position: { x: 476, y: 264 } },
  { id: 'G7', name: 'G7', occupancy: 73, category: 'general', position: { x: 480, y: 182 } },
  { id: 'G8', name: 'G8', occupancy: 64, category: 'general', position: { x: 480, y: 110 } },
  { id: 'G9', name: 'G9', occupancy: 88, category: 'general', position: { x: 480, y: 49 } },
  { id: 'G10', name: 'G10', occupancy: 45, category: 'general', position: { x: 271, y: 72 } },
  { id: 'G11', name: 'G11', occupancy: 92, category: 'general', position: { x: 568, y: 82 } },
  { id: 'G12', name: 'G12', occupancy: 89, category: 'general', position: { x: 890, y: 83 } },
  { id: 'G13', name: 'G13', occupancy: 71, category: 'general', position: { x: 1036, y: 97 } },
  { id: 'G14', name: 'G14', occupancy: 58, category: 'general', position: { x: 1036, y: 214 } },
  { id: 'PVN', name: 'Palo Verde N.', occupancy: 65, category: 'general', position: { x: 975, y: 83 } },
  { id: 'PVS', name: 'Palo Verde S.', occupancy: 65, category: 'general', position: { x: 975, y: 200 } },
  { id: 'PYR', name: 'Pyramid', occupancy: 79, category: 'general', position: { x: 568, y: 264 } },
  { id: 'E1', name: 'E1', occupancy: 85, category: 'employee', position: { x: 501, y: 411 } },
  { id: 'E2', name: 'E2', occupancy: 72, category: 'employee', position: { x: 654, y: 485 } },
  { id: 'E3', name: 'E3', occupancy: 68, category: 'employee', position: { x: 774, y: 406 } },
  { id: 'E4', name: 'E4', occupancy: 91, category: 'employee', position: { x: 811, y: 320 } },
  { id: 'E5', name: 'E5', occupancy: 33, category: 'employee', position: { x: 947, y: 284 } },
  { id: 'E6', name: 'E6', occupancy: 76, category: 'employee', position: { x: 1028, y: 484 } },
  { id: 'E7', name: 'E7', occupancy: 82, category: 'employee', position: { x: 811, y: 768 } },
  { id: 'E8', name: 'E8', occupancy: 59, category: 'employee', position: { x: 741, y: 980 } },
  { id: 'E9', name: 'E9', occupancy: 87, category: 'employee', position: { x: 610, y: 956 } },
  { id: 'E10', name: 'E10', occupancy: 64, category: 'employee', position: { x: 598, y: 733 } },
  { id: 'E11', name: 'E11', occupancy: 71, category: 'employee', position: { x: 598, y: 612 } },
] as const;

// transform lot's position to scale for current device
export const parkingLots: ParkingLotUI[] = rawParkingLots.map(lot => ({
  ...lot,
  position: scalePosition(lot.position.x, lot.position.y),
}));