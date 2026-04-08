import { validate } from 'class-validator';
import { CreateOccupancyEventDto } from './create-occupancy-event.dto';

describe('CreateOccupancyEventDto', () => {
  const createValid = (): CreateOccupancyEventDto => {
    const dto = new CreateOccupancyEventDto();
    dto.lot_id = 'G1';
    dto.event_type = 'ENTER';
    dto.device_id = 'abcdef12-3456-7890';
    dto.timestamp = new Date().toISOString();
    return dto;
  };

  it('should pass with valid data', async () => {
    const dto = createValid();
    const errors = await validate(dto);
    expect(errors.length).toBe(0);
  });

  it('should fail when lot_id is empty', async () => {
    const dto = createValid();
    dto.lot_id = '';
    const errors = await validate(dto);
    expect(errors.length).toBeGreaterThan(0);
  });

  it('should fail when event_type is invalid', async () => {
    const dto = createValid();
    (dto as any).event_type = 'INVALID';
    const errors = await validate(dto);
    expect(errors.some((e) => e.property === 'event_type')).toBe(true);
  });

  it('should fail when device_id is too short', async () => {
    const dto = createValid();
    dto.device_id = 'short';
    const errors = await validate(dto);
    expect(errors.some((e) => e.property === 'device_id')).toBe(true);
  });

  it('should fail when timestamp is not ISO8601', async () => {
    const dto = createValid();
    dto.timestamp = 'not-a-date';
    const errors = await validate(dto);
    expect(errors.some((e) => e.property === 'timestamp')).toBe(true);
  });

  it('should fail for timestamps too far in the past', async () => {
    const dto = createValid();
    dto.timestamp = new Date(Date.now() - 2 * 60 * 60 * 1000).toISOString(); // 2 hours ago
    const errors = await validate(dto);
    expect(errors.some((e) => e.constraints?.isRecentTimestamp)).toBe(true);
  });

  it('should fail for timestamps too far in the future', async () => {
    const dto = createValid();
    dto.timestamp = new Date(Date.now() + 10 * 60 * 1000).toISOString(); // 10 min ahead
    const errors = await validate(dto);
    expect(errors.some((e) => e.constraints?.isRecentTimestamp)).toBe(true);
  });

  it('should pass for timestamp within allowed future window', async () => {
    const dto = createValid();
    dto.timestamp = new Date(Date.now() + 2 * 60 * 1000).toISOString(); // 2 min ahead
    const errors = await validate(dto);
    expect(errors.length).toBe(0);
  });
});
