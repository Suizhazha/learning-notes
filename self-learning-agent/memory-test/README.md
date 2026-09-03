# memory-test

## 项目目标
<!-- 在这里写本项目要学习/验证的目标，例如：
- [ ] 学习 Milvus 集合的创建与向量检索
- [ ] 对比 IVFLAT / HNSW / ANNOY 索引效果
-->

## 目录结构
```
memory-test/
├── src/                 # 学习示例脚本（*.mjs）
├── .env                 # 本地环境变量（不提交）
├── .env.example         # 环境变量示例（可提交）
├── .gitignore
├── package.json
└── README.md
```

## 快速开始
```bash
# 1. 安装依赖
pnpm install

# 2. 复制环境变量模板
cp .env.example .env
# 编辑 .env 填入真实的 API Key、Milvus 地址等

# 3. 新增一个学习示例
mkdir -p src
# 在 src/ 下新建 hello.mjs 并执行 node src/hello.mjs 运行
```

## 添加依赖
```bash
pnpm add <pkg>
```

## 学习笔记
<!-- 在这里记录每天的学习要点、踩坑、参考资料链接 -->
