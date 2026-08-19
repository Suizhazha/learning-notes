import "dotenv/config";
import { ChatOpenAI } from "@langchain/openai";
import { tool } from "@langchain/core/tools";
import {
  HumanMessage,
  SystemMessage,
  ToolMessage,
} from "@langchain/core/messages";
import fs from "node:fs/promises";
import { z } from "zod";

const model = new ChatOpenAI({
  modelName: process.env.MODEL_NAME || "qwen-coder-turbo",
  apiKey: process.env.OPENAI_API_KEY,
  temperature: 0,
  configuration: {
    baseURL: process.env.OPENAI_BASE_URL,
  },
});

const readFileTool = tool(
  async ({ filePath }) => {
    const content = await fs.readFile(filePath, "utf-8");
    console.log(
      `  [工具调用] read_file("${filePath}") - 成功读取 ${content.length} 字节`,
    );
    return `文件内容:\n${content}`;
  },
  {
    name: "read_file",
    description:
      "用此工具来读取文件内容。当用户要求读取文件、查看代码、分析文件内容时，调用此工具。输入文件路径（可以是相对路径或绝对路径）。",
    schema: z.object({
      filePath: z.string().describe("要读取的文件路径"),
    }),
  },
);

const tools = [readFileTool];

const modelWithTools = model.bindTools(tools);

const messages = [
  new SystemMessage(
    `你是一个代码助手，可以使用工具读取文件并解释代码。

    工作流程：
    1. 用户要求读取文件时，立即调用 read_file 工具
    2. 等待工具返回文件内容
    3. 基于文件内容进行分析和解释

    可用工具：
    - read_file: 读取文件内容（使用此工具来获取文件内容）
    `,
  ),
  new HumanMessage("请读取 src/tool-file-read.mjs 文件内容并解释代码"),
];

let response = await modelWithTools.invoke(messages);
// console.log('第一次调用模型:',response?.content);
messages.push(response);

while (response?.tool_calls?.length > 0) {
  console.log(`检测到${response?.tool_calls?.length}个工具调用`);

  const toolResults = await Promise.all(
    response?.tool_calls?.map(async (toolCall) => {
      // 根据工具名称找到对应的工具
      const tool = tools?.find((tool) => tool?.name === toolCall?.name);

      if (!tool) {
        console.error(`未找到工具: ${toolCall?.name}`);
        return null;
      }

      console.log(`执行工具: ${toolCall?.name}`);
      console.log("执行工具参数:", JSON.stringify(toolCall?.args));

      try {
        // 调用工具
        return await tool?.invoke(toolCall?.args);
      } catch (error) {
        console.error(`工具调用失败: ${toolCall?.name}`);
        console.error(error);
        return null;
      }
    }),
  );

  // 将工具调用结果添加到消息中
  response?.tool_calls?.forEach((toolCall, index) => {
    messages.push(
      new ToolMessage({
        content: toolResults[index],
        tool_call_id: toolCall?.id,
        // name: toolCall?.name,
      }),
    );
  });

  // 再次调用模型，继续推理
  response = await modelWithTools.invoke(messages);
}

console.log("\n最终响应:\n");
console.log(response?.content);
