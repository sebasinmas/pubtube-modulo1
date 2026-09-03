export enum VideoStatus {
    BORRADOR = 'borrador',
    LISTO = 'listo',
    PROGRAMADO = 'programado',
    PUBLICADO = 'publicado'
}

export class Video {
    id: string;
    status: VideoStatus = VideoStatus.BORRADOR;
    metadata: any; // indefinido de momento
    scheduled_at: Date | null;
    youtube_url: string;

    constructor(id:string, scheduled_at: Date, youtube_url: string){
        this.id = id;
        this.scheduled_at = scheduled_at;
        this.youtube_url = youtube_url;
    }
}