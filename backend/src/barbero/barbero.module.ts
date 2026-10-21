import { Module } from '@nestjs/common';
import { AccountsModule } from '../common/accounts.module';
import { BarberoController } from './barbero.controller';
import { BarberoService } from './barbero.service';

@Module({
  imports: [AccountsModule],
  controllers: [BarberoController],
  providers: [BarberoService],
})
export class BarberoModule {}
