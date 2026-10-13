import { Injectable, InternalServerErrorException } from '@nestjs/common';
import { getSignedStorageUrl, supabaseAdmin } from '../supabase';

export type UploadedBarberoPhotoFile = {
  buffer: Buffer;
  originalname: string;
  mimetype: string;
};

export type UploadedClientePhotoFile = UploadedBarberoPhotoFile;

const BARBERO_BUCKETS = [
  process.env.SUPABASE_STORAGE_BUCKET_BARBEROS || 'barberos',
  process.env.SUPABASE_STORAGE_BUCKET_BARBERO || 'barbero',
  process.env.SUPABASE_STORAGE_BUCKET_PUBLIC || 'public',
];

const CLIENTE_BUCKETS = [
  process.env.SUPABASE_STORAGE_BUCKET_CLIENTES || 'clientes',
  process.env.SUPABASE_STORAGE_BUCKET_CLIENTE || 'cliente',
  process.env.SUPABASE_STORAGE_BUCKET_PUBLIC || 'public',
];

@Injectable()
export class CatalogosService {
  async barberias() {
    const { data, error } = await supabaseAdmin
      .from('barberia')
      .select(
        `
          id_barberia,
          nombre,
          descripcion,
          direccion,
          telefono,
          email,
          logo_url,
          activo
        `,
      )
      .eq('activo', true)
      .order('nombre', { ascending: true });

    if (error) {
      throw new InternalServerErrorException(error.message);
    }

    return Promise.all((data || []).map((barberia: any) => this.mapBarberia(barberia)));
  }

  async barberiaById(id: string) {
    const { data, error } = await supabaseAdmin
      .from('barberia')
      .select(
        `
          id_barberia,
          nombre,
          descripcion,
          direccion,
          telefono,
          email,
          logo_url,
          activo
        `,
      )
      .eq('id_barberia', id)
      .single();

    if (error) {
      throw new InternalServerErrorException(error.message);
    }

    return this.mapBarberia(data);
  }

  async barberos(idBarberia?: string) {
    let request = supabaseAdmin
      .from('barbero')
      .select(
        `
          id_barbero,
          id_barberia,
          nombre_barbero,
          foto_perfil,
          promedio_calificacion,
          activo,
          barberia:barberia(id_barberia, nombre, logo_url),
          barbero_procedimiento(
            procedimiento:procedimiento(id_procedimiento, nombre, precio, duracion_minutos)
          )
        `,
      )
      .eq('activo', true)
      .order('nombre_barbero', { ascending: true });

    if (idBarberia) {
      request = request.eq('id_barberia', idBarberia);
    }

    const { data, error } = await request;

    if (error) {
      throw new InternalServerErrorException(error.message);
    }

    return Promise.all((data || []).map((barbero: any) => this.mapBarbero(barbero)));
  }

  async barberoById(id: string) {
    const { data, error } = await supabaseAdmin
      .from('barbero')
      .select(
        `
          id_barbero,
          id_barberia,
          nombre_barbero,
          foto_perfil,
          promedio_calificacion,
          activo,
          barberia:barberia(id_barberia, nombre, logo_url),
          barbero_procedimiento(
            procedimiento:procedimiento(id_procedimiento, nombre, precio, duracion_minutos)
          )
        `,
      )
      .eq('id_barbero', id)
      .single();

    if (error) {
      throw new InternalServerErrorException(error.message);
    }

    return this.mapBarbero(data);
  }

  private async uploadToBucket(
    buckets: string[],
    fileName: string,
    file: UploadedBarberoPhotoFile,
  ) {
    let lastError: any = null;

    for (const bucket of buckets) {
      const { error: uploadError } = await supabaseAdmin.storage
        .from(bucket)
        .upload(fileName, file.buffer, {
          contentType: file.mimetype,
          upsert: true,
        });

      if (!uploadError) {
        const { data: publicData } = await supabaseAdmin.storage
          .from(bucket)
          .getPublicUrl(fileName);

        return { url: publicData.publicUrl };
      }

      lastError = uploadError;
      if (!uploadError.message?.includes('Bucket not found')) {
        break;
      }
    }

    throw new InternalServerErrorException(
      lastError?.message || 'No se pudo subir la imagen al almacenamiento.',
    );
  }

  async uploadBarberoPhoto(id: string, file: UploadedBarberoPhotoFile) {
    if (!file || !file.buffer) {
      throw new InternalServerErrorException('No se recibió ninguna imagen.');
    }

    const fileExtension = file.originalname.split('.').pop() || 'jpg';
    const fileName = `barberos/${id}-${Date.now()}.${fileExtension}`;
    const { url: photoUrl } = await this.uploadToBucket(
      BARBERO_BUCKETS,
      fileName,
      file,
    );
    const signedUrl = await getSignedStorageUrl(photoUrl);

    const { error: updateError } = await supabaseAdmin
      .from('barbero')
      .update({ foto_perfil: photoUrl })
      .eq('id_barbero', id);

    if (updateError) {
      throw new InternalServerErrorException(updateError.message);
    }

    return { url: signedUrl || photoUrl };
  }

  async uploadClientePhoto(id: string, file: UploadedClientePhotoFile) {
    if (!file || !file.buffer) {
      throw new InternalServerErrorException('No se recibió ninguna imagen.');
    }

    const fileExtension = file.originalname.split('.').pop() || 'jpg';
    const fileName = `clientes/${id}-${Date.now()}.${fileExtension}`;
    const { url: photoUrl } = await this.uploadToBucket(
      CLIENTE_BUCKETS,
      fileName,
      file,
    );
    const signedUrl = await getSignedStorageUrl(photoUrl);

    const { error: updateError } = await supabaseAdmin
      .from('cliente')
      .update({ foto_perfil: photoUrl })
      .eq('id_cliente', id);

    if (updateError) {
      throw new InternalServerErrorException(updateError.message);
    }

    return { url: signedUrl || photoUrl };
  }

  async procedimientos(idBarberia?: string) {
    let request = supabaseAdmin
      .from('procedimiento')
      .select('id_procedimiento, id_barberia, nombre, descripcion, precio, duracion_minutos')
      .eq('activo', true)
      .order('nombre', { ascending: true });

    if (idBarberia) {
      request = request.eq('id_barberia', idBarberia);
    }

    const { data, error } = await request;

    if (error) {
      throw new InternalServerErrorException(error.message);
    }

    return (data || []).map((item: any) => ({
      id: item.id_procedimiento,
      idBarberia: item.id_barberia,
      nombre: item.nombre,
      descripcion: item.descripcion || '',
      precio: Number(item.precio || 0),
      duracionMinutos: item.duracion_minutos,
    }));
  }

  async disponibilidades(idBarbero: string) {
    const { data, error } = await supabaseAdmin
      .from('disponibilidad_barbero')
      .select('id_disponibilidad, id_barbero, dia_semana, hora_inicio, hora_fin, activo')
      .eq('id_barbero', idBarbero)
      .eq('activo', true)
      .order('dia_semana', { ascending: true })
      .order('hora_inicio', { ascending: true });

    if (error) {
      throw new InternalServerErrorException(error.message);
    }

    return (data || []).map((item: any) => ({
      id: item.id_disponibilidad,
      idBarbero: item.id_barbero,
      diaSemana: item.dia_semana,
      horaInicio: item.hora_inicio,
      horaFin: item.hora_fin,
      activo: item.activo,
    }));
  }

  private async mapBarberia(barberia: any) {
    return {
      id: barberia.id_barberia,
      nombre: barberia.nombre,
      descripcion: barberia.descripcion || '',
      direccion: barberia.direccion || '',
      telefono: barberia.telefono || '',
      email: barberia.email || '',
      logo: await getSignedStorageUrl(barberia.logo_url),
      activo: barberia.activo,
    };
  }

  private async mapBarbero(barbero: any) {
    const barberia = Array.isArray(barbero.barberia)
      ? barbero.barberia[0]
      : barbero.barberia;

    return {
      id: barbero.id_barbero,
      idBarberia: barbero.id_barberia,
      barberia: barberia
        ? {
            id: barberia.id_barberia,
            nombre: barberia.nombre,
            logo: await getSignedStorageUrl(barberia.logo_url),
          }
        : null,
      nombre: barbero.nombre_barbero,
      foto: await getSignedStorageUrl(barbero.foto_perfil),
      promedioCalificacion: Number(barbero.promedio_calificacion || 0),
      especialidades: (barbero.barbero_procedimiento || [])
        .map((item: any) => item.procedimiento)
        .filter(Boolean)
        .map((item: any) => ({
          id: item.id_procedimiento,
          nombre: item.nombre,
          precio: Number(item.precio || 0),
          duracionMinutos: item.duracion_minutos,
        })),
      horarioLaboral: 'Disponibilidad configurable por barbero',
    };
  }
}
