import { InternalServerErrorException } from '@nestjs/common';
import { parseStorageUrl, supabaseAdmin } from '../supabase';

export type UploadedFile = {
  buffer: Buffer;
  originalname: string;
  mimetype: string;
  size?: number;
};

export const ALLOWED_IMAGE_TYPES = [
  'image/jpeg',
  'image/jpg',
  'image/png',
  'image/webp',
];
export const MAX_IMAGE_BYTES = 5 * 1024 * 1024;

/** Sube una imagen y devuelve la URL con el formato que guarda la base de datos. */
export async function uploadProfilePhoto(
  bucket: string,
  path: string,
  file: UploadedFile,
) {
  const { error } = await supabaseAdmin.storage
    .from(bucket)
    .upload(path, file.buffer, {
      contentType: file.mimetype === 'image/jpg' ? 'image/jpeg' : file.mimetype,
      upsert: true,
    });

  if (error) {
    throw new InternalServerErrorException(
      error.message || 'No se pudo subir la imagen al almacenamiento.',
    );
  }

  return supabaseAdmin.storage.from(bucket).getPublicUrl(path).data.publicUrl;
}

/** Borra un archivo guardado; si falla no interrumpe el flujo que lo llamó. */
export async function removeStoredFile(url?: string | null) {
  const parsed = parseStorageUrl(url);
  if (!parsed) {
    return;
  }

  await supabaseAdmin.storage
    .from(parsed.bucket)
    .remove([parsed.path])
    .catch(() => undefined);
}
