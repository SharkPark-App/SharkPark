import { apiService } from './base';
import API_CONFIG from './config';
import type {
  ReliabilityScore,
  ReliabilityScoreSummary,
  ReliabilityConfig,
} from '../../types/reliability';

class ReliabilityApiService {
  async getLotReliability(lotId: string): Promise<ReliabilityScore> {
    const endpoint = `${API_CONFIG.BASE_URL}/api/v1/reliability/lots/${lotId}`;
    const response = await apiService.get<ReliabilityScore>(endpoint);
    return response.data;
  }

  async getAllLotsReliability(): Promise<ReliabilityScoreSummary[]> {
    const endpoint = `${API_CONFIG.BASE_URL}/api/v1/reliability/lots`;
    const response = await apiService.get<ReliabilityScoreSummary[]>(endpoint);
    return response.data;
  }

  async getReliabilityConfig(): Promise<ReliabilityConfig> {
    const endpoint = `${API_CONFIG.BASE_URL}/api/v1/reliability/config`;
    const response = await apiService.get<ReliabilityConfig>(endpoint);
    return response.data;
  }
}

export const reliabilityApiService = new ReliabilityApiService();
export default reliabilityApiService;
