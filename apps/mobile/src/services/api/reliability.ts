import { apiService } from './base';
import type {
  ReliabilityScore,
  ReliabilityScoreSummary,
  ReliabilityConfig,
} from '../../types/reliability';

class ReliabilityApiService {
  async getLotReliability(lotId: string): Promise<ReliabilityScore> {
    const response = await apiService.get<ReliabilityScore>(`/reliability/lots/${lotId}`);
    return response.data;
  }

  async getAllLotsReliability(): Promise<ReliabilityScoreSummary[]> {
    const response = await apiService.get<ReliabilityScoreSummary[]>('/reliability/lots');
    return response.data;
  }

  async getReliabilityConfig(): Promise<ReliabilityConfig> {
    const response = await apiService.get<ReliabilityConfig>('/reliability/config');
    return response.data;
  }
}

export const reliabilityApiService = new ReliabilityApiService();
export default reliabilityApiService;
