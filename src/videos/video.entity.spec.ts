import { describe, it, expect, beforeEach} from 'vitest';
import {Video} from './video.entity.js';

describe('Video Entity', () => {
    let video: Video; 
    beforeEach(() =>{
        video = new Video('1', 'ajdjakd', (new Date), 'link');
    });

    it('el video debe instanciarse con un id', () =>{
        expect(video).toHaveProperty('id');
    });
    it('el video debe instanciarse con un atributo status', () =>{
        expect(video).toHaveProperty('status');
    });
    it('el video debe instanciarse con metadata', () =>{
        expect(video).toHaveProperty('metadata');
    });
    it('el video debe instanciarse con fecha de creacion', () =>{
        expect(video).toHaveProperty('scheduled_at');
    });
    it('el video debe instanciarse con link de youtube', () =>{
        expect(video).toHaveProperty('youtube_url');
    });

    it('video deberia instanciarse en con el atributo en modo "borrador" por defecto', () =>{
        expect(video.status).toBe('borrador');
    });
});