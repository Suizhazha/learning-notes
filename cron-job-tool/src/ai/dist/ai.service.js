"use strict";
var __decorate = (this && this.__decorate) || function (decorators, target, key, desc) {
    var c = arguments.length, r = c < 3 ? target : desc === null ? desc = Object.getOwnPropertyDescriptor(target, key) : desc, d;
    if (typeof Reflect === "object" && typeof Reflect.decorate === "function") r = Reflect.decorate(decorators, target, key, desc);
    else for (var i = decorators.length - 1; i >= 0; i--) if (d = decorators[i]) r = (c < 3 ? d(r) : c > 3 ? d(target, key, r) : d(target, key)) || r;
    return c > 3 && r && Object.defineProperty(target, key, r), r;
};
var __param = (this && this.__param) || function (paramIndex, decorator) {
    return function (target, key) { decorator(target, key, paramIndex); }
};
var __awaiter = (this && this.__awaiter) || function (thisArg, _arguments, P, generator) {
    function adopt(value) { return value instanceof P ? value : new P(function (resolve) { resolve(value); }); }
    return new (P || (P = Promise))(function (resolve, reject) {
        function fulfilled(value) { try { step(generator.next(value)); } catch (e) { reject(e); } }
        function rejected(value) { try { step(generator["throw"](value)); } catch (e) { reject(e); } }
        function step(result) { result.done ? resolve(result.value) : adopt(result.value).then(fulfilled, rejected); }
        step((generator = generator.apply(thisArg, _arguments || [])).next());
    });
};
var __generator = (this && this.__generator) || function (thisArg, body) {
    var _ = { label: 0, sent: function() { if (t[0] & 1) throw t[1]; return t[1]; }, trys: [], ops: [] }, f, y, t, g;
    return g = { next: verb(0), "throw": verb(1), "return": verb(2) }, typeof Symbol === "function" && (g[Symbol.iterator] = function() { return this; }), g;
    function verb(n) { return function (v) { return step([n, v]); }; }
    function step(op) {
        if (f) throw new TypeError("Generator is already executing.");
        while (_) try {
            if (f = 1, y && (t = op[0] & 2 ? y["return"] : op[0] ? y["throw"] || ((t = y["return"]) && t.call(y), 0) : y.next) && !(t = t.call(y, op[1])).done) return t;
            if (y = 0, t) op = [op[0] & 2, t.value];
            switch (op[0]) {
                case 0: case 1: t = op; break;
                case 4: _.label++; return { value: op[1], done: false };
                case 5: _.label++; y = op[1]; op = [0]; continue;
                case 7: op = _.ops.pop(); _.trys.pop(); continue;
                default:
                    if (!(t = _.trys, t = t.length > 0 && t[t.length - 1]) && (op[0] === 6 || op[0] === 2)) { _ = 0; continue; }
                    if (op[0] === 3 && (!t || (op[1] > t[0] && op[1] < t[3]))) { _.label = op[1]; break; }
                    if (op[0] === 6 && _.label < t[1]) { _.label = t[1]; t = op; break; }
                    if (t && _.label < t[2]) { _.label = t[2]; _.ops.push(op); break; }
                    if (t[2]) _.ops.pop();
                    _.trys.pop(); continue;
            }
            op = body.call(thisArg, _);
        } catch (e) { op = [6, e]; y = 0; } finally { f = t = 0; }
        if (op[0] & 5) throw op[1]; return { value: op[0] ? op[1] : void 0, done: true };
    }
};
var __await = (this && this.__await) || function (v) { return this instanceof __await ? (this.v = v, this) : new __await(v); }
var __asyncValues = (this && this.__asyncValues) || function (o) {
    if (!Symbol.asyncIterator) throw new TypeError("Symbol.asyncIterator is not defined.");
    var m = o[Symbol.asyncIterator], i;
    return m ? m.call(o) : (o = typeof __values === "function" ? __values(o) : o[Symbol.iterator](), i = {}, verb("next"), verb("throw"), verb("return"), i[Symbol.asyncIterator] = function () { return this; }, i);
    function verb(n) { i[n] = o[n] && function (v) { return new Promise(function (resolve, reject) { v = o[n](v), settle(resolve, reject, v.done, v.value); }); }; }
    function settle(resolve, reject, d, v) { Promise.resolve(v).then(function(v) { resolve({ value: v, done: d }); }, reject); }
};
var __asyncGenerator = (this && this.__asyncGenerator) || function (thisArg, _arguments, generator) {
    if (!Symbol.asyncIterator) throw new TypeError("Symbol.asyncIterator is not defined.");
    var g = generator.apply(thisArg, _arguments || []), i, q = [];
    return i = {}, verb("next"), verb("throw"), verb("return"), i[Symbol.asyncIterator] = function () { return this; }, i;
    function verb(n) { if (g[n]) i[n] = function (v) { return new Promise(function (a, b) { q.push([n, v, a, b]) > 1 || resume(n, v); }); }; }
    function resume(n, v) { try { step(g[n](v)); } catch (e) { settle(q[0][3], e); } }
    function step(r) { r.value instanceof __await ? Promise.resolve(r.value.v).then(fulfill, reject) : settle(q[0][2], r); }
    function fulfill(value) { resume("next", value); }
    function reject(value) { resume("throw", value); }
    function settle(f, v) { if (f(v), q.shift(), q.length) resume(q[0][0], q[0][1]); }
};
exports.__esModule = true;
exports.AiService = void 0;
var common_1 = require("@nestjs/common");
var messages_1 = require("@langchain/core/messages");
/**
 * 下面是最初版本的内联工具定义，只是保留做参考，不再实际使用。
 *
 * const database = {
 *   users: {
 *     '001': { id: '001', name: '张三', email: 'zhangsan@example.com', role: 'admin' },
 *     '002': { id: '002', name: '李四', email: 'lisi@example.com', role: 'user' },
 *     '003': { id: '003', name: '王五', email: 'wangwu@example.com', role: 'user' },
 *   },
 * };
 *
 * const queryUserArgsSchema = z.object({
 *   userId: z.string().describe('用户 ID，例如: 001, 002, 003'),
 * });
 *
 * type QueryUserArgs = {
 *   userId: string;
 * };
 *
 * const queryUserTool = tool(
 *   async ({ userId }: QueryUserArgs) => {
 *     const user = database.users[userId];
 *
 *     if (!user) {
 *       return `用户 ID ${userId} 不存在。可用的 ID: 001, 002, 003`;
 *     }
 *
 *     return `用户信息：\n- ID: ${user.id}\n- 姓名: ${user.name}\n- 邮箱: ${user.email}\n- 角色: ${user.role}`;
 *   },
 *   {
 *     name: 'query_user',
 *     description:
 *       '查询数据库中的用户信息。输入用户 ID，返回该用户的详细信息（姓名、邮箱、角色）。',
 *     schema: queryUserArgsSchema,
 *   },
 * );
 */
var AiService = /** @class */ (function () {
    function AiService(model, queryUserTool) {
        this.queryUserTool = queryUserTool;
        this.modelWithTools = model.bindTools([
            this.queryUserTool,
        ]);
    }
    AiService.prototype.runChain = function (query) {
        var _a;
        return __awaiter(this, void 0, Promise, function () {
            var messages, aiMessage, toolCalls, _i, toolCalls_1, toolCall, toolCallId, toolName, result;
            return __generator(this, function (_b) {
                switch (_b.label) {
                    case 0:
                        messages = [
                            new messages_1.SystemMessage("\u4F60\u662F\u4E00\u4E2A\u901A\u7528\u4EFB\u52A1\u52A9\u624B\uFF0C\u53EF\u4EE5\u6839\u636E\u7528\u6237\u7684\u76EE\u6807\u89C4\u5212\u6B65\u9AA4\uFF0C\u5E76\u5728\u9700\u8981\u65F6\u8C03\u7528\u5DE5\u5177\uFF1A`query_user` \u67E5\u8BE2\u6216\u6821\u9A8C\u7528\u6237\u4FE1\u606F\u3001`send_mail` \u53D1\u9001\u90AE\u4EF6\u3001`web_search` \u8FDB\u884C\u4E92\u8054\u7F51\u641C\u7D22\u3001`db_users_crud` \u8BFB\u5199\u6570\u636E\u5E93 users \u8868\u3001`time_now` \u83B7\u53D6\u5F53\u524D\u670D\u52A1\u5668\u65F6\u95F4\u3001`cron_job` \u521B\u5EFA\u548C\u7BA1\u7406\u5B9A\u65F6/\u5468\u671F\u4EFB\u52A1\uFF08`list`/`add`/`toggle`\uFF09\uFF0C\u4ECE\u800C\u5B9E\u73B0\u63D0\u9192\u3001\u5B9A\u671F\u4EFB\u52A1\u3001\u6570\u636E\u540C\u6B65\u7B49\u5404\u79CD\u81EA\u52A8\u5316\u9700\u6C42\u3002\n\n\u5B9A\u65F6\u4EFB\u52A1\u7C7B\u578B\u9009\u62E9\u89C4\u5219\uFF08\u975E\u5E38\u91CD\u8981\uFF09\uFF1A\n- \u7528\u6237\u8BF4\u201CX\u5206\u949F/\u5C0F\u65F6/\u5929\u540E\u201D\u201C\u5728\u67D0\u4E2A\u65F6\u95F4\u70B9\u201D\u201C\u5230\u70B9\u63D0\u9192\u201D\uFF08\u4E00\u6B21\u6027\uFF09=> \u7528 `cron_job` + `type=at`\uFF08\u6267\u884C\u4E00\u6B21\u540E\u81EA\u52A8\u505C\u7528\uFF09\uFF0C`at`=\u5F53\u524D\u65F6\u95F4+X \u6216\u89E3\u6790\u51FA\u7684\u65F6\u95F4\u70B9\n- \u7528\u6237\u8BF4\u201C\u6BCFX\u5206\u949F/\u6BCF\u5C0F\u65F6/\u6BCF\u5929\u201D\u201C\u5B9A\u671F/\u5FAA\u73AF/\u4E00\u76F4\u201D\uFF08\u91CD\u590D\u6267\u884C\uFF09=> \u7528 `cron_job` + `type=every`\uFF08\u6BCF\u6B21\u6267\u884C\uFF09\uFF0C`everyMs`=X\u6362\u7B97\u6210\u6BEB\u79D2\n- \u7528\u6237\u7ED9\u51FA Cron \u8868\u8FBE\u5F0F\u6216\u660E\u786E\u8BF4\u201C\u7528 cron \u8868\u8FBE\u5F0F\u201D\uFF08\u91CD\u590D\u6267\u884C\uFF09=> \u7528 `cron_job` + `type=cron`\n\n\u5728\u8C03\u7528 `cron_job.add` \u521B\u5EFA\u4EFB\u52A1\u65F6\uFF0C\u9700\u8981\u628A\u7528\u6237\u539F\u59CB\u81EA\u7136\u8BED\u8A00\u62C6\u6210\u4E24\u90E8\u5206\uFF1A\u4E00\u90E8\u5206\u662F\u201C\u4EC0\u4E48\u65F6\u5019\u6267\u884C\u201D\uFF08\u7528\u6765\u51B3\u5B9A type/at/everyMs/cron\uFF09\uFF0C\u53E6\u4E00\u90E8\u5206\u662F\u201C\u8981\u505A\u4EC0\u4E48\u4EFB\u52A1\u672C\u8EAB\u201D\u3002`instruction` \u5B57\u6BB5\u53EA\u80FD\u586B\u201C\u8981\u505A\u4EC0\u4E48\u201D\u7684\u90A3\u90E8\u5206\u6587\u672C\uFF08\u4FDD\u6301\u539F\u8BED\u8A00\u548C\u539F\u8BDD\uFF09\uFF0C\u4E0D\u80FD\u518D\u6539\u5199\u3001\u7FFB\u8BD1\u6216\u603B\u7ED3\u3002\n\n\u5F53\u7528\u6237\u8BF7\u6C42\u201C\u5728\u672A\u6765\u67D0\u4E2A\u65F6\u95F4\u70B9\u6267\u884C\u67D0\u4E2A\u52A8\u4F5C\u201D\uFF08\u4F8B\u5982\u201C1\u5206\u949F\u540E\u7ED9\u6211\u53D1\u4E00\u4E2A\u7B11\u8BDD\u5230\u90AE\u7BB1\u201D\uFF09\u65F6\uFF0C\u672C\u8F6E\u5BF9\u8BDD\u53EA\u9700\u8981\u4F7F\u7528 `cron_job` \u8BBE\u7F6E/\u66F4\u65B0\u5B9A\u65F6\u4EFB\u52A1\uFF0C\u4E0D\u8981\u5728\u5F53\u524D\u8F6E\u76F4\u63A5\u5B8C\u6210\u8FD9\u4E2A\u52A8\u4F5C\u672C\u8EAB\uFF1A\u4E0D\u8981\u76F4\u63A5\u8C03\u7528 `send_mail` \u7ED9\u4ED6\u53D1\u90AE\u4EF6\uFF0C\u4E5F\u4E0D\u8981\u5728\u5F53\u524D\u8F6E\u5C31\u771F\u6B63\u201C\u6267\u884C\u201D\u6307\u4EE4\uFF0C\u53EA\u9700\u628A\u8981\u6267\u884C\u7684\u52A8\u4F5C\u5199\u8FDB `instruction` \u91CC\uFF0C\u4EA4\u7ED9\u5C06\u6765\u7684\u5B9A\u65F6\u4EFB\u52A1\u53BB\u8DD1\u3002\n\n\u91CD\u8981\uFF1A`cron_job.add` \u7684 `instruction` \u5FC5\u987B\u662F\u81EA\u7136\u8BED\u8A00\u4EFB\u52A1\u63CF\u8FF0\uFF0C\u4E0D\u80FD\u5199\u6210\u5DE5\u5177\u8C03\u7528/\u811A\u672C\uFF08\u4F8B\u5982\u7981\u6B62 `send_mail(...)`\u3001`db_users_crud(...)`\u3001`web_search(...)`\uFF09\u3002\u5DE5\u5177\u8C03\u7528\u5E94\u8BE5\u7531\u5C06\u6765\u7684 JobAgent \u5728\u6267\u884C\u65F6\u81EA\u884C\u51B3\u5B9A\u3002\n\n\u6CE8\u610F\uFF1A\u50CF\u201C`1\u5206\u949F\u540E\u63D0\u9192\u6211\u559D\u6C34`\u201D\uFF0C\u65F6\u95F4\u76F8\u5173\u4FE1\u606F\u7528\u4E8E\u8BA1\u7B97\u4E0B\u4E00\u6B21\u6267\u884C\u65F6\u95F4\uFF0C\u800C `instruction` \u5E94\u8BE5\u662F\u201C\u63D0\u9192\u6211\u559D\u6C34\u201D\uFF1B\u672C\u8F6E\u4E0D\u9700\u8981\u7ACB\u523B\u63D0\u9192\u3002"),
                            new messages_1.HumanMessage(query),
                        ];
                        _b.label = 1;
                    case 1:
                        if (!true) return [3 /*break*/, 8];
                        return [4 /*yield*/, this.modelWithTools.invoke(messages)];
                    case 2:
                        aiMessage = _b.sent();
                        messages.push(aiMessage);
                        toolCalls = (_a = aiMessage.tool_calls) !== null && _a !== void 0 ? _a : [];
                        // 没有要调用的工具，直接把回答返回给调用方
                        if (!toolCalls.length) {
                            return [2 /*return*/, aiMessage.content];
                        }
                        _i = 0, toolCalls_1 = toolCalls;
                        _b.label = 3;
                    case 3:
                        if (!(_i < toolCalls_1.length)) return [3 /*break*/, 7];
                        toolCall = toolCalls_1[_i];
                        toolCallId = toolCall.id || '';
                        toolName = toolCall.name;
                        if (!(toolName === 'query_user')) return [3 /*break*/, 5];
                        return [4 /*yield*/, this.queryUserTool.invoke(toolCall.args)];
                    case 4:
                        result = _b.sent();
                        messages.push(new messages_1.ToolMessage({
                            tool_call_id: toolCallId,
                            name: toolName,
                            content: result
                        }));
                        return [3 /*break*/, 6];
                    case 5:
                        if (toolName === 'send_mail') {
                            // const result = await this.sendMailTool.invoke(toolCall.args);
                            messages.push(new messages_1.ToolMessage({
                                tool_call_id: toolCallId,
                                name: toolName
                            }));
                        }
                        else if (toolName === 'web_search') {
                            // const result = await this.webSearchTool.invoke(toolCall.args);
                            messages.push(new messages_1.ToolMessage({
                                tool_call_id: toolCallId,
                                name: toolName
                            }));
                        }
                        else if (toolName === 'db_users_crud') {
                            // const result = await this.dbUsersCrudTool.invoke(toolCall.args);
                            messages.push(new messages_1.ToolMessage({
                                tool_call_id: toolCallId,
                                name: toolName
                            }));
                        }
                        else if (toolName === 'time_now') {
                            // const result = await this.timeNowTool.invoke({});
                            messages.push(new messages_1.ToolMessage({
                                tool_call_id: toolCallId,
                                name: toolName
                            }));
                        }
                        else if (toolName === 'cron_job') {
                            // const result = await this.cronJobTool.invoke(toolCall.args);
                            messages.push(new messages_1.ToolMessage({
                                tool_call_id: toolCallId,
                                name: toolName
                            }));
                        }
                        _b.label = 6;
                    case 6:
                        _i++;
                        return [3 /*break*/, 3];
                    case 7: return [3 /*break*/, 1];
                    case 8: return [2 /*return*/];
                }
            });
        });
    };
    AiService.prototype.runChainStream = function (query) {
        var _a, _b, _c;
        return __asyncGenerator(this, arguments, function runChainStream_1() {
            var messages, stream, fullAIMessage, _d, _e, chunk, isToolCalling, e_1_1, toolCalls, _i, toolCalls_2, toolCall, toolCallId, toolName, result;
            var e_1, _f;
            return __generator(this, function (_g) {
                switch (_g.label) {
                    case 0:
                        messages = [
                            new messages_1.SystemMessage("\u4F60\u662F\u4E00\u4E2A\u901A\u7528\u4EFB\u52A1\u52A9\u624B\uFF0C\u53EF\u4EE5\u5728\u9700\u8981\u65F6\u8C03\u7528\u5DE5\u5177\uFF08\u5982 `query_user`\u3001`db_users_crud`\u3001`send_mail`\u3001`web_search`\u3001`time_now`\u3001`cron_job` \u7B49\uFF09\u6765\u67E5\u8BE2\u6216\u6539\u5199\u6570\u636E/\u914D\u7F6E\uFF0C\u89C4\u5212\u5E76\u6267\u884C\u5404\u79CD\u4EFB\u52A1\uFF08\u5305\u62EC\u63D0\u9192\u3001\u5B9A\u671F\u4EFB\u52A1\u548C\u4E00\u7CFB\u5217\u540E\u53F0\u64CD\u4F5C\uFF09\uFF0C\u518D\u7528\u7ED3\u679C\u56DE\u7B54\u7528\u6237\u7684\u95EE\u9898\u3002\n\n\u5B9A\u65F6\u4EFB\u52A1\u7C7B\u578B\u9009\u62E9\u89C4\u5219\uFF08\u975E\u5E38\u91CD\u8981\uFF09\uFF1A\n- \u201CX\u5206\u949F/\u5C0F\u65F6/\u5929\u540E\u201D\u201C\u5728\u67D0\u4E2A\u65F6\u95F4\u70B9\u201D\u201C\u5230\u70B9\u63D0\u9192\u201D\uFF08\u4E00\u6B21\u6027\uFF09=> `cron_job.type=at`\uFF08\u6267\u884C\u4E00\u6B21\u540E\u81EA\u52A8\u505C\u7528\uFF09\n- \u201C\u6BCFX\u5206\u949F/\u6BCF\u5C0F\u65F6/\u6BCF\u5929\u201D\u201C\u5B9A\u671F/\u5FAA\u73AF/\u4E00\u76F4\u201D\uFF08\u91CD\u590D\u6267\u884C\uFF09=> `cron_job.type=every`\uFF08\u6BCF\u6B21\u6267\u884C\uFF09\uFF0C`everyMs`=\u6BEB\u79D2\n- \u7ED9\u51FA Cron \u8868\u8FBE\u5F0F => `cron_job.type=cron`"),
                            new messages_1.HumanMessage(query),
                        ];
                        _g.label = 1;
                    case 1:
                        if (!true) return [3 /*break*/, 26];
                        return [4 /*yield*/, __await(this.modelWithTools.stream(messages))];
                    case 2:
                        stream = _g.sent();
                        fullAIMessage = null;
                        _g.label = 3;
                    case 3:
                        _g.trys.push([3, 10, 11, 16]);
                        _d = (e_1 = void 0, __asyncValues(stream));
                        _g.label = 4;
                    case 4: return [4 /*yield*/, __await(_d.next())];
                    case 5:
                        if (!(_e = _g.sent(), !_e.done)) return [3 /*break*/, 9];
                        chunk = _e.value;
                        fullAIMessage = fullAIMessage ? fullAIMessage.concat(chunk) : chunk;
                        isToolCalling = ((_b = (_a = fullAIMessage.tool_call_chunks) === null || _a === void 0 ? void 0 : _a.length) !== null && _b !== void 0 ? _b : 0) > 0;
                        if (!(!isToolCalling && chunk.content)) return [3 /*break*/, 8];
                        return [4 /*yield*/, __await(chunk.content)];
                    case 6: return [4 /*yield*/, _g.sent()];
                    case 7:
                        _g.sent();
                        _g.label = 8;
                    case 8: return [3 /*break*/, 4];
                    case 9: return [3 /*break*/, 16];
                    case 10:
                        e_1_1 = _g.sent();
                        e_1 = { error: e_1_1 };
                        return [3 /*break*/, 16];
                    case 11:
                        _g.trys.push([11, , 14, 15]);
                        if (!(_e && !_e.done && (_f = _d["return"]))) return [3 /*break*/, 13];
                        return [4 /*yield*/, __await(_f.call(_d))];
                    case 12:
                        _g.sent();
                        _g.label = 13;
                    case 13: return [3 /*break*/, 15];
                    case 14:
                        if (e_1) throw e_1.error;
                        return [7 /*endfinally*/];
                    case 15: return [7 /*endfinally*/];
                    case 16:
                        if (!!fullAIMessage) return [3 /*break*/, 18];
                        return [4 /*yield*/, __await(void 0)];
                    case 17: return [2 /*return*/, _g.sent()];
                    case 18:
                        messages.push(fullAIMessage);
                        toolCalls = (_c = fullAIMessage.tool_calls) !== null && _c !== void 0 ? _c : [];
                        if (!!toolCalls.length) return [3 /*break*/, 20];
                        return [4 /*yield*/, __await(void 0)];
                    case 19: return [2 /*return*/, _g.sent()];
                    case 20:
                        _i = 0, toolCalls_2 = toolCalls;
                        _g.label = 21;
                    case 21:
                        if (!(_i < toolCalls_2.length)) return [3 /*break*/, 25];
                        toolCall = toolCalls_2[_i];
                        toolCallId = toolCall.id || '';
                        toolName = toolCall.name;
                        if (!(toolName === 'query_user')) return [3 /*break*/, 23];
                        return [4 /*yield*/, __await(this.queryUserTool.invoke(toolCall.args))];
                    case 22:
                        result = _g.sent();
                        messages.push(new messages_1.ToolMessage({
                            tool_call_id: toolCallId,
                            name: toolName,
                            content: result
                        }));
                        return [3 /*break*/, 24];
                    case 23:
                        if (toolName === 'send_mail') {
                            // const result = await this.sendMailTool.invoke(toolCall.args);
                            messages.push(new messages_1.ToolMessage({
                                tool_call_id: toolCallId,
                                name: toolName
                            }));
                        }
                        else if (toolName === 'web_search') {
                            // const result = await this.webSearchTool.invoke(toolCall.args);
                            messages.push(new messages_1.ToolMessage({
                                tool_call_id: toolCallId,
                                name: toolName
                            }));
                        }
                        else if (toolName === 'db_users_crud') {
                            // const result = await this.dbUsersCrudTool.invoke(toolCall.args);
                            messages.push(new messages_1.ToolMessage({
                                tool_call_id: toolCallId,
                                name: toolName
                            }));
                        }
                        else if (toolName === 'time_now') {
                            // const result = await this.timeNowTool.invoke({});
                            messages.push(new messages_1.ToolMessage({
                                tool_call_id: toolCallId,
                                name: toolName
                            }));
                        }
                        else if (toolName === 'cron_job') {
                            // const result = await this.cronJobTool.invoke(toolCall.args);
                            messages.push(new messages_1.ToolMessage({
                                tool_call_id: toolCallId,
                                name: toolName
                            }));
                        }
                        _g.label = 24;
                    case 24:
                        _i++;
                        return [3 /*break*/, 21];
                    case 25: return [3 /*break*/, 1];
                    case 26: return [2 /*return*/];
                }
            });
        });
    };
    AiService = __decorate([
        common_1.Injectable(),
        __param(0, common_1.Inject('CHAT_MODEL')),
        __param(1, common_1.Inject('QUERY_USER_TOOL'))
    ], AiService);
    return AiService;
}());
exports.AiService = AiService;
