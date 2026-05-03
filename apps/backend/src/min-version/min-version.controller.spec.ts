import { Test, TestingModule } from '@nestjs/testing';
import { MinVersionController } from './min-version.controller';

describe('MinVersionController', () => {
  let controller: MinVersionController;

  beforeEach(async () => {
    const module: TestingModule = await Test.createTestingModule({
      controllers: [MinVersionController],
    }).compile();

    controller = module.get<MinVersionController>(MinVersionController);
  });

  it('returns success with ios and android version info', () => {
    const result = controller.getMinVersion();

    expect(result.success).toBe(true);
    expect(result.data.ios).toEqual(
      expect.objectContaining({ min: expect.any(String), current: expect.any(String) }),
    );
    expect(result.data.android).toEqual(
      expect.objectContaining({ min: expect.any(String), current: expect.any(String) }),
    );
  });
});
