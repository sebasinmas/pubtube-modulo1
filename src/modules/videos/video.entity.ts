export enum VideoStatus {
  BORRADOR = 'borrador',
  LISTO = 'listo',
  PROGRAMADO = 'programado',
  PUBLICADO = 'publicado',
}

export enum VideoVisibility {
  PUBLIC = 'public',
  PRIVATE = 'private',
  UNLISTED = 'unlisted',
}

export interface VideoMetadata {
  id: string; // ID de la versión
  version: number;
  title: string;
  description: string | null;
  tags: string[] | null;
  visibility: VideoVisibility;
  createdAt: Date;
}

export class Video {
  id: string;
  status = VideoStatus.BORRADOR;
  metadata: VideoMetadata | null;
  scheduled_at: Date | null;
  youtube_url: string | null;

  constructor(
    id: string,
    metadata: VideoMetadata | null = null,
    scheduled_at: Date | null = null,
    youtube_url: string | null = null,
  ) {
    this.id = id;
    this.metadata = metadata;
    this.scheduled_at = scheduled_at;
    this.youtube_url = youtube_url;
  }
}
