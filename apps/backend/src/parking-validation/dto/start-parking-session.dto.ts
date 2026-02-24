export interface StartParkingSessionDto {
  userId: string;
  lotId: string;
  latitude: number;
  longitude: number;
  timestamp?: string;
  deviceHash?: string;
}
