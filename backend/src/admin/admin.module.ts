import { Module } from '@nestjs/common';
import { AccountsModule } from '../common/accounts.module';
import { AdminController } from './admin.controller';
import { AdminService } from './admin.service';

@Module({
  imports: [AccountsModule],
  controllers: [AdminController],
  providers: [AdminService],
})
export class AdminModule {}
