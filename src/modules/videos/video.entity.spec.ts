import { describe, it, expect } from 'vitest';
import { Video, VideoStatus } from './video.entity.js';
import { videoStatusEnum } from '../../db/schema.js';

describe('Video entity', () => {
  it('nace en estado "borrador"', () => {
    const video = new Video('id-1', null, new Date(), '');

    expect(video.status).toBe(VideoStatus.BORRADOR);
  });

  it('VideoStatus coincide con el enum video_status de la BD, en el mismo orden', () => {
    expect(Object.values(VideoStatus)).toEqual(videoStatusEnum.enumValues);
  });
});
