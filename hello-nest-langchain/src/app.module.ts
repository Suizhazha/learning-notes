import { Module } from '@nestjs/common';
import { AppController } from './app.controller.js';
import { AppService } from './app.service.js';
import { BookModule } from './book/book.module.js';
import { AiModule } from './ai/ai.module.js';

@Module({
  imports: [BookModule, AiModule],
  controllers: [AppController],
  providers: [AppService],
})
export class AppModule {}
