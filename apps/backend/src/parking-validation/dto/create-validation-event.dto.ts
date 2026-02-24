import { ValidationEventType, BluetoothState } from '@prisma/client';

export interface CreateValidationEventDto {
  userId: string;
  lotId: string;
  eventType: ValidationEventType;
  latitude: number;
  longitude: number;
  speed?: number;
  accuracy?: number;
  bluetoothState?: BluetoothState;
  timestamp?: string;
  deviceHash?: string;
  rawData?: Record<string, unknown>;
}
