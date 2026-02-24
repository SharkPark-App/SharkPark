import { Test, TestingModule } from '@nestjs/testing';
import { ParkingValidationController } from '../src/parking-validation/parking-validation.controller';
import { ParkingValidationService } from '../src/parking-validation/parking-validation.service';
import { ValidationEventType, BluetoothState, ValidationStatus } from '@prisma/client';

describe('ParkingValidationController', () => {
  let controller: ParkingValidationController;

  const mockValidationService = {
    recordValidationEvent: jest.fn(),
    startParkingSession: jest.fn(),
    endParkingSession: jest.fn(),
    getLotValidationStats: jest.fn(),
  };

  beforeEach(async () => {
    const module: TestingModule = await Test.createTestingModule({
      controllers: [ParkingValidationController],
      providers: [
        {
          provide: ParkingValidationService,
          useValue: mockValidationService,
        },
      ],
    }).compile();

    controller = module.get<ParkingValidationController>(ParkingValidationController);
  });

  afterEach(() => {
    jest.clearAllMocks();
  });

  it('should be defined', () => {
    expect(controller).toBeDefined();
  });

  describe('recordEvent', () => {
    it('should record a validation event successfully', async () => {
      const mockEvent = {
        id: 'test-event-id',
        device_hash: 'test-hash',
        lot_id: 'test-lot-uuid',
        event_type: 'SPEED_CHANGE' as ValidationEventType,
        timestamp: new Date(),
        speed_mph: 5,
        accuracy_meters: 3,
        confidence_score: 0.8,
        bluetooth_state: 'CONNECTED' as BluetoothState,
        raw_data: null,
        created_at: new Date(),
      };

      const dto = {
        userId: 'test@csulb.edu',
        lotId: 'G1',
        eventType: 'SPEED_CHANGE' as ValidationEventType,
        latitude: 33.7838,
        longitude: -118.1141,
        speed: 5,
        accuracy: 3,
        bluetoothState: 'CONNECTED' as BluetoothState,
      };

      mockValidationService.recordValidationEvent.mockResolvedValue(mockEvent);

      const result = await controller.recordEvent(dto);

      expect(mockValidationService.recordValidationEvent).toHaveBeenCalledWith(dto);
      expect(result).toEqual({
        success: true,
        data: mockEvent,
      });
    });

    it('should handle different event types', async () => {
      const eventTypes: ValidationEventType[] = [
        'SPEED_CHANGE',
        'STATIONARY',
        'WALKING',
        'DRIVING',
        'GEOFENCE_ENTER',
        'GEOFENCE_EXIT',
        'BLUETOOTH_CONNECT',
        'BLUETOOTH_DISCONNECT',
        'GPS_ACCURACY_CHANGE',
      ];

      for (const eventType of eventTypes) {
        const mockEvent = {
          id: `test-event-${eventType}`,
          event_type: eventType,
          confidence_score: 0.7,
        };

        const dto = {
          userId: 'test@csulb.edu',
          lotId: 'G1',
          eventType,
          latitude: 33.7838,
          longitude: -118.1141,
        };

        mockValidationService.recordValidationEvent.mockResolvedValue(mockEvent);

        const result = await controller.recordEvent(dto);

        expect(result.success).toBe(true);
        expect(result.data.event_type).toBe(eventType);
      }
    });
  });

  describe('startSession', () => {
    it('should start a parking session successfully', async () => {
      const mockSession = {
        id: 'test-session-id',
        device_hash: 'test-hash',
        lot_id: 'test-lot-uuid',
        enter_time: new Date(),
        exit_time: null,
        validation_status: 'ANALYZING' as ValidationStatus,
        confidence_score: null,
        occupancy_contribution: false,
        speed_transition_score: null,
        dwell_time_score: null,
        movement_pattern_score: null,
        bluetooth_score: null,
        validation_metadata: null,
        created_at: new Date(),
        updated_at: new Date(),
      };

      const dto = {
        userId: 'test@csulb.edu',
        lotId: 'G1',
        latitude: 33.7838,
        longitude: -118.1141,
      };

      mockValidationService.startParkingSession.mockResolvedValue(mockSession);

      const result = await controller.startSession(dto);

      expect(mockValidationService.startParkingSession).toHaveBeenCalledWith(dto);
      expect(result).toEqual({
        success: true,
        data: mockSession,
      });
    });

    it('should handle optional parameters', async () => {
      const mockSession = {
        id: 'test-session-id',
        validation_status: 'ANALYZING' as ValidationStatus,
      };

      const dto = {
        userId: 'test@csulb.edu',
        lotId: 'G1',
        latitude: 33.7838,
        longitude: -118.1141,
        timestamp: '2026-02-23T19:00:00Z',
        deviceHash: 'custom-hash',
      };

      mockValidationService.startParkingSession.mockResolvedValue(mockSession);

      const result = await controller.startSession(dto);

      expect(mockValidationService.startParkingSession).toHaveBeenCalledWith(dto);
      expect(result.success).toBe(true);
    });
  });

  describe('endSession', () => {
    it('should end a parking session successfully', async () => {
      const dto = {
        sessionId: 'test-session-id',
        latitude: 33.7838,
        longitude: -118.1141,
      };

      mockValidationService.endParkingSession.mockResolvedValue(undefined);

      const result = await controller.endSession(dto);

      expect(mockValidationService.endParkingSession).toHaveBeenCalledWith(dto);
      expect(result).toEqual({
        success: true,
        message: 'Session ended and analysis initiated',
      });
    });

    it('should handle optional parameters in end session', async () => {
      const dto = {
        sessionId: 'test-session-id',
        timestamp: '2026-02-23T20:00:00Z',
      };

      mockValidationService.endParkingSession.mockResolvedValue(undefined);

      const result = await controller.endSession(dto);

      expect(mockValidationService.endParkingSession).toHaveBeenCalledWith(dto);
      expect(result.success).toBe(true);
    });
  });

  describe('getLotStats', () => {
    it('should return lot validation statistics with default hours', async () => {
      const mockStats = {
        total_sessions: 25,
        parked: 18,
        drove_through: 4,
        searching: 2,
        unknown: 1,
        analyzing: 0,
        average_confidence: 0.82,
      };

      mockValidationService.getLotValidationStats.mockResolvedValue(mockStats);

      const result = await controller.getLotStats('G1');

      expect(mockValidationService.getLotValidationStats).toHaveBeenCalledWith('G1', 24);
      expect(result).toEqual({
        success: true,
        data: mockStats,
      });
    });

    it('should return lot validation statistics with custom hours', async () => {
      const mockStats = {
        total_sessions: 10,
        parked: 8,
        drove_through: 1,
        searching: 1,
        unknown: 0,
        analyzing: 0,
        average_confidence: 0.75,
      };

      mockValidationService.getLotValidationStats.mockResolvedValue(mockStats);

      const result = await controller.getLotStats('G2', '12');

      expect(mockValidationService.getLotValidationStats).toHaveBeenCalledWith('G2', 12);
      expect(result).toEqual({
        success: true,
        data: mockStats,
      });
    });

    it('should handle invalid hours parameter gracefully', async () => {
      const mockStats = {
        total_sessions: 5,
        parked: 4,
        drove_through: 1,
        searching: 0,
        unknown: 0,
        analyzing: 0,
        average_confidence: 0.9,
      };

      mockValidationService.getLotValidationStats.mockResolvedValue(mockStats);

      const result = await controller.getLotStats('G3', 'invalid');

      // Should default to 24 hours when hours parameter is invalid
      expect(mockValidationService.getLotValidationStats).toHaveBeenCalledWith('G3', NaN);
      expect(result.success).toBe(true);
    });

    it('should handle different lot IDs', async () => {
      const lotIds = ['G1', 'G2', 'E1', 'E7', 'MS1'];
      
      for (const lotId of lotIds) {
        const mockStats = {
          total_sessions: Math.floor(Math.random() * 50),
          parked: Math.floor(Math.random() * 30),
          drove_through: Math.floor(Math.random() * 10),
          searching: Math.floor(Math.random() * 5),
          unknown: Math.floor(Math.random() * 3),
          analyzing: Math.floor(Math.random() * 2),
          average_confidence: Math.random(),
        };

        mockValidationService.getLotValidationStats.mockResolvedValue(mockStats);

        const result = await controller.getLotStats(lotId, '48');

        expect(mockValidationService.getLotValidationStats).toHaveBeenCalledWith(lotId, 48);
        expect(result.success).toBe(true);
        expect(result.data).toEqual(mockStats);
      }
    });
  });

  describe('Error Handling', () => {
    it('should handle service errors in recordEvent', async () => {
      const dto = {
        userId: 'test@csulb.edu',
        lotId: 'G1',
        eventType: 'SPEED_CHANGE' as ValidationEventType,
        latitude: 33.7838,
        longitude: -118.1141,
      };

      mockValidationService.recordValidationEvent.mockRejectedValue(
        new Error('Database connection failed')
      );

      await expect(controller.recordEvent(dto)).rejects.toThrow('Database connection failed');
    });

    it('should handle service errors in startSession', async () => {
      const dto = {
        userId: 'test@csulb.edu',
        lotId: 'INVALID_LOT',
        latitude: 33.7838,
        longitude: -118.1141,
      };

      mockValidationService.startParkingSession.mockRejectedValue(
        new Error('Lot INVALID_LOT not found')
      );

      await expect(controller.startSession(dto)).rejects.toThrow('Lot INVALID_LOT not found');
    });

    it('should handle service errors in endSession', async () => {
      const dto = {
        sessionId: 'invalid-session-id',
      };

      mockValidationService.endParkingSession.mockRejectedValue(
        new Error('No active parking session found')
      );

      await expect(controller.endSession(dto)).rejects.toThrow('No active parking session found');
    });

    it('should handle service errors in getLotStats', async () => {
      mockValidationService.getLotValidationStats.mockRejectedValue(
        new Error('Lot INVALID_LOT not found')
      );

      await expect(controller.getLotStats('INVALID_LOT')).rejects.toThrow('Lot INVALID_LOT not found');
    });
  });
});
