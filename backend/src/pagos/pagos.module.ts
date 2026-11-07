import { Module } from '@nestjs/common';
import { NotificacionesModule } from '../notificaciones/notificaciones.module';
import { PagosController } from './pagos.controller';
import { PagosService } from './pagos.service';

@Module({
  imports: [NotificacionesModule],
  controllers: [PagosController],
  providers: [PagosService],
})
export class PagosModule {}
