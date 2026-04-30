import { validate } from 'class-validator';
import { CreateReportDto, IncidentType } from './create-report.dto';

describe('CreateReportDto', () => {
  const createValid = (): CreateReportDto => {
    const dto = new CreateReportDto();
    dto.lotId = 'cm0abc1230000xyz';
    dto.type = IncidentType.OTHER;
    dto.message = 'Tree branch blocking entrance';
    return dto;
  };

  it('should pass with all valid data provided', async () => {
    const dto = createValid();
    const errors = await validate(dto);
    expect(errors.length).toBe(0);
  });

  it('should pass when optional message is omitted', async () => {
    const dto = createValid();
    delete dto.message;
    const errors = await validate(dto);
    expect(errors.length).toBe(0);
  });

  it('should fail when lotId is empty', async () => {
    const dto = createValid();
    dto.lotId = '';
    const errors = await validate(dto);
    expect(errors.some((e) => e.property === 'lotId')).toBe(true);
  });

  it('should fail when lotId is missing entirely', async () => {
    const dto = createValid();
    (dto as any).lotId = undefined;
    const errors = await validate(dto);
    expect(errors.some((e) => e.property === 'lotId')).toBe(true);
  });

  it('should fail when type is invalid', async () => {
    const dto = createValid();
    (dto as any).type = 'EVEN_MORE_CAMPUS_CONSTRUCTION';
    const errors = await validate(dto);
    expect(errors.some((e) => e.property === 'type')).toBe(true);
  });

  it('should fail when type is missing entirely', async () => {
    const dto = createValid();
    (dto as any).type = undefined;
    const errors = await validate(dto);
    expect(errors.some((e) => e.property === 'type')).toBe(true);
  });

  it('should fail when message is provided but is not a string', async () => {
    const dto = createValid();
    (dto as any).message = 12345;
    const errors = await validate(dto);
    expect(errors.some((e) => e.property === 'message')).toBe(true);
  });
});