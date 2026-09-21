import 'dotenv/config'
import { Injectable } from '@nestjs/common';
import { ChatOpenAI } from '@langchain/openai';
import type { Runnable } from '@langchain/core/runnables';
import { PromptTemplate } from '@langchain/core/prompts';
import { StringOutputParser } from '@langchain/core/output_parsers';

import { CreateAiDto } from './dto/create-ai.dto.js';
import { UpdateAiDto } from './dto/update-ai.dto.js';

@Injectable()
export class AiService {
  private readonly chain: Runnable;

  constructor() {
    const prompt = PromptTemplate.fromTemplate('请回答以下问题： \n\n{query}');
    const model = new ChatOpenAI({
      temperature: 0.7,
      // 1.x 版本中 modelName 已更名为 model
      model: process.env.MODEL_NAME!,
      apiKey: process.env.OPENAI_API_KEY,
      // OpenAI SDK 的字段是 baseURL(大写 L),不是 baseUrl
      configuration: {
        baseURL: process.env.OPENAI_BASE_URL,
      },
    });

    this.chain = prompt.pipe(model).pipe(new StringOutputParser());
  }

  async runchain(query: string): Promise<string> {
    const result = await this.chain.invoke({ query });
    return result;
  }

  create(createAiDto: CreateAiDto) {
    return 'This action adds a new ai';
  }

  findAll() {
    return `This action returns all ai`;
  }

  findOne(id: number) {
    return `This action returns a #${id} ai`;
  }

  update(id: number, updateAiDto: UpdateAiDto) {
    return `This action updates a #${id} ai`;
  }

  remove(id: number) {
    return `This action removes a #${id} ai`;
  }
}
