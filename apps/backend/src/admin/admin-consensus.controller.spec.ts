import { AdminConsensusController } from './admin-consensus.controller';

describe('AdminConsensusController', () => {
  it('delegates to the service with the route + query params', async () => {
    const service = {
      getForLotDate: jest.fn().mockResolvedValue({
        lotId: 'l1',
        lotCode: 'G1',
        date: '2026-05-07',
        count: 0,
        groundTruthCount: 0,
        rows: [],
      }),
    };
    const controller = new AdminConsensusController(service as never);
    const r = await controller.get('G1', '2026-05-07');
    expect(service.getForLotDate).toHaveBeenCalledWith('G1', '2026-05-07');
    expect(r.lotCode).toBe('G1');
  });
});
