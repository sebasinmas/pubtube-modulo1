"""Módulo 1 – Gestión de Contenidos: esqueleto de API con FastAPI."""

import uuid
from typing import List, Optional

from fastapi import FastAPI, File, Query, UploadFile, status
from fastapi.responses import JSONResponse
from pydantic import BaseModel

app = FastAPI(
    title="Módulo 1 – Gestión de Contenidos",
    description="API REST para la gestión, almacenamiento y versionado de contenido multimedia.",
    version="0.1.0",
)


class MetadataRequest(BaseModel):
    title: str
    description: Optional[str] = None
    tags: Optional[List[str]] = []
    visibility: Optional[str] = "private"


class UploadResponse(BaseModel):
    status: str
    contentId: str


class MetadataResponse(BaseModel):
    status: str
    version: int


class ContentListResponse(BaseModel):
    status: str
    items: List[dict]
    page: int


@app.post("/api/content", response_model=UploadResponse, status_code=status.HTTP_201_CREATED, tags=["Contenido"])
async def upload_content(
    file: UploadFile = File(...),
    thumbnail: Optional[UploadFile] = File(None),
) -> JSONResponse:
    """Recibe un archivo de contenido vía multipart y retorna el ID generado."""
    content_id = str(uuid.uuid4())
    return JSONResponse(
        status_code=status.HTTP_201_CREATED,
        content={"status": "ok", "contentId": content_id},
    )


@app.put("/api/content/{id}/metadata", response_model=MetadataResponse, status_code=status.HTTP_200_OK, tags=["Contenido"])
async def update_metadata(id: str, body: MetadataRequest) -> JSONResponse:
    """Crea una nueva versión de metadatos para el contenido indicado."""
    return JSONResponse(
        status_code=status.HTTP_200_OK,
        content={"status": "ok", "version": 1},
    )


@app.get("/api/content", response_model=ContentListResponse, status_code=status.HTTP_200_OK, tags=["Contenido"])
async def list_content(
    status_filter: Optional[str] = Query(None, alias="status"),
    page: int = Query(1, ge=1),
    size: int = Query(10, ge=1, le=100),
) -> JSONResponse:
    """Retorna una lista paginada de contenidos con filtros opcionales."""
    return JSONResponse(
        status_code=status.HTTP_200_OK,
        content={"status": "ok", "items": [], "page": page},
    )


if __name__ == "__main__":
    import uvicorn
    uvicorn.run("main:app", host="0.0.0.0", port=8000, reload=True)
