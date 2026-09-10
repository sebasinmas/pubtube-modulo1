export enum VideoStatus {
  BORRADOR = 'borrador',
  LISTO = 'listo',
  PROGRAMADO = 'programado',
  PUBLICADO = 'publicado',
}

export class Video {
  id: string;
  status = VideoStatus.BORRADOR;
  metadata: any; // hay que declarar si es algun dato especifico
  scheduled_at: Date | null;
  youtube_url: string;

  constructor(
    id: string,
    metadata: any,
    scheduled_at: Date,
    youtube_url: string,
  ) {
    this.id = id;
    this.metadata = metadata;
    this.scheduled_at = scheduled_at;
    this.youtube_url = youtube_url;
  }
}
