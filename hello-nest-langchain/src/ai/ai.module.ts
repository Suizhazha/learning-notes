import { Module } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { ChatOpenAI } from '@langchain/openai';
import { AiService } from './ai.service.js';
import { AiController } from './ai.controller.js';
@Module({
  controllers: [AiController],
  providers: [AiService,
    {
      provide: 'CHAT_SERVICE',
      useFactory: (config: ConfigService) => new ChatOpenAI({
        model: config.get('MODEL_NAME'),
        apiKey: config.get('API_KEY'),
        temperature: config.get('TEMPERATURE') || 0.7,
        configuration: {
          baseURL: config.get('BASE_URL'),
        },
      }),
      inject: [ConfigService],
    }
  ],
})
export class AiModule {}
