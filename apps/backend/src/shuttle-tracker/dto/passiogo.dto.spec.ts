import 'reflect-metadata';
import { validate } from 'class-validator';
import { plainToInstance } from 'class-transformer';
import {
  PassioStopDto,
  PassioRouteDto,
  PassioShuttleDto,
  PassioLiveShuttleDto,
  PassioEtaDto,
} from './passiogo.dto';

describe('Passio GO! DTOs', () => {
  
  describe('PassioStopDto', () => {
    const createValidStop = () => ({
      stopId: '123',
      name: 'Student Union',
      latitude: 33.782,
      longitude: -118.112,
      routeId: 'route-1',
      color: '#ff0000',
    });

    it('should pass with valid data', async () => {
      const dto = plainToInstance(PassioStopDto, createValidStop());
      const errors = await validate(dto);
      expect(errors.length).toBe(0);
    });

    it('should pass without optional color field', async () => {
      const data = createValidStop();
      delete (data as any).color;
      
      const dto = plainToInstance(PassioStopDto, data);
      const errors = await validate(dto);
      expect(errors.length).toBe(0);
    });

    it('should fail if latitude is a string instead of a number', async () => {
      const data = { ...createValidStop(), latitude: '33.782' };
      const dto = plainToInstance(PassioStopDto, data);
      const errors = await validate(dto);
      
      expect(errors.some((e) => e.property === 'latitude')).toBe(true);
    });

    it('should fail if required fields are missing', async () => {
      const data = createValidStop();
      delete (data as any).stopId;
      
      const dto = plainToInstance(PassioStopDto, data);
      const errors = await validate(dto);
      
      expect(errors.some((e) => e.property === 'stopId')).toBe(true);
    });
  });

  describe('PassioRouteDto', () => {
    const createValidRoute = () => ({
      myid: 'route-1',
      nameOrig: 'Red Route Original',
      name: 'Red Route',
      shortName: 'RD',
      color: '#FF0000',
      serviceTimeShort: '10 min',
    });

    it('should pass with valid data', async () => {
      const dto = plainToInstance(PassioRouteDto, createValidRoute());
      const errors = await validate(dto);
      expect(errors.length).toBe(0);
    });

    it('should fail if shortName is missing', async () => {
      const data = createValidRoute();
      delete (data as any).shortName;
      
      const dto = plainToInstance(PassioRouteDto, data);
      const errors = await validate(dto);
      
      expect(errors.some((e) => e.property === 'shortName')).toBe(true);
    });
  });

  describe('PassioShuttleDto', () => {
    const createValidShuttle = () => ({
      busId: 101,
      busName: 'Shuttle 101',
      color: '#00FF00',
      routeId: 'route-2',
      route: 'Green Route',
      latitude: '33.5', // Testing sent as string
      longitude: '-118.5',
      calculatedCourse: '90',
      paxLoad: '5', // Testing transform requirement
      totalCap: '30', // Testing transform requirement
    });

    it('should pass and correctly transform string numbers to integers', async () => {
      const data = createValidShuttle();
      const dto = plainToInstance(PassioShuttleDto, data);
      
      // Verify the @Transform decorator worked
      expect(dto.paxLoad).toBe(5);
      expect(dto.totalCap).toBe(30);

      const errors = await validate(dto);
      expect(errors.length).toBe(0);
    });

    it('should fail if latitude is not a string', async () => {
      const data = { ...createValidShuttle(), latitude: 33.5 };
      const dto = plainToInstance(PassioShuttleDto, data);
      const errors = await validate(dto);
      
      expect(errors.some((e) => e.property === 'latitude')).toBe(true);
    });

    it('should pass if paxLoad and totalCap are omitted (they are optional)', async () => {
      const data = createValidShuttle();
      delete (data as any).paxLoad;
      delete (data as any).totalCap;

      const dto = plainToInstance(PassioShuttleDto, data);
      const errors = await validate(dto);
      expect(errors.length).toBe(0);
    });
  });

  describe('PassioLiveShuttleDto', () => {
    const createValidLiveShuttle = () => ({
      busId: 101,
      latitude: 33.782, // Testing sent as number
      longitude: -118.112,
      course: 180.5,
      paxLoad: 12,
      more: { driver: 'John' },
    });

    it('should pass with valid numerical data', async () => {
      const dto = plainToInstance(PassioLiveShuttleDto, createValidLiveShuttle());
      const errors = await validate(dto);
      expect(errors.length).toBe(0);
    });

    it('should fail if course is missing', async () => {
      const data = createValidLiveShuttle();
      delete (data as any).course;
      
      const dto = plainToInstance(PassioLiveShuttleDto, data);
      const errors = await validate(dto);
      
      expect(errors.some((e) => e.property === 'course')).toBe(true);
    });
  });

  describe('PassioEtaDto & Nested Validation', () => {
    const createValidEta = () => ({
      eta: '5',
      routeId: 'route-1',
      bg: '#000000',
      busName: 'Shuttle 101',
      theStop: {
        routeName: 'Red Route',
        shortName: 'RD',
      },
    });

    it('should pass with valid nested data', async () => {
      const dto = plainToInstance(PassioEtaDto, createValidEta());
      const errors = await validate(dto);
      expect(errors.length).toBe(0);
    });

    it('should fail if theStop is missing entirely', async () => {
      const data = createValidEta();
      delete (data as any).theStop;
      
      const dto = plainToInstance(PassioEtaDto, data);
      const errors = await validate(dto);
      
      expect(errors.some((e) => e.property === 'theStop')).toBe(true);
    });

    it('should fail if nested properties in theStop are invalid types', async () => {
      const data = {
        ...createValidEta(),
        theStop: {
          routeName: 123, // Should be a string
          shortName: 'RD',
        },
      };
      
      const dto = plainToInstance(PassioEtaDto, data);
      const errors = await validate(dto);
      
      // Look for the validation error within the nested object
      const stopError = errors.find((e) => e.property === 'theStop');
      expect(stopError).toBeDefined();
      expect(stopError?.children?.some((child) => child.property === 'routeName')).toBe(true);
    });

    it('should pass if eta is a number instead of a string', async () => {
      const data = { ...createValidEta(), eta: 10 };
      const dto = plainToInstance(PassioEtaDto, data);
      const errors = await validate(dto);
      expect(errors.length).toBe(0);
    });
  });
});