import { describe, it, expect, vi } from 'vitest';
import { BadRequestException } from '@nestjs/common';
import { VideoStateService } from './video-state.service.js';

function createMockDb(videoEncontrado: any) {
  return {
    select: vi.fn().mockReturnValue({
      from: vi.fn().mockReturnValue({
        where: vi.fn().mockReturnValue({
          limit: vi.fn().mockResolvedValue(videoEncontrado ? [videoEncontrado] : []),
        }),
      }),
    }),
    update: vi.fn(),
  };
}

describe('VideoStateService.marcarComoProgramado', () => {
  it('rechaza si el video está en borrador', async () => {

    const videoFalso = { id: 'abc', status: 'borrador' };
    const mockDb = createMockDb(videoFalso);
    const mockBroker = { publish: vi.fn() };
    const service = new VideoStateService(mockDb as any, mockBroker as any);
    await expect(service.marcarComoProgramado('abc', new Date('2027-01-01'))).rejects.toThrow(BadRequestException);

    expect(mockBroker.publish).not.toHaveBeenCalled();
    expect(mockDb.update).not.toHaveBeenCalled();
  });


  it('rechaza si la fecha no es futura', async () => {
  const videoFalso = { id: 'abc', status: 'listo' };
  const mockDb = createMockDb(videoFalso);
  const mockBroker = { publish: vi.fn() };
  const service = new VideoStateService(mockDb as any, mockBroker as any);

  const fechaPasada = new Date('2020-01-01'); 
  await expect(service.marcarComoProgramado('abc', fechaPasada)).rejects.toThrow(BadRequestException);
});

});