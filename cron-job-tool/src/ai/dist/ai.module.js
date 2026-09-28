"use strict";
var __decorate = (this && this.__decorate) || function (decorators, target, key, desc) {
    var c = arguments.length, r = c < 3 ? target : desc === null ? desc = Object.getOwnPropertyDescriptor(target, key) : desc, d;
    if (typeof Reflect === "object" && typeof Reflect.decorate === "function") r = Reflect.decorate(decorators, target, key, desc);
    else for (var i = decorators.length - 1; i >= 0; i--) if (d = decorators[i]) r = (c < 3 ? d(r) : c > 3 ? d(target, key, r) : d(target, key)) || r;
    return c > 3 && r && Object.defineProperty(target, key, r), r;
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
exports.__esModule = true;
exports.AiModule = void 0;
var common_1 = require("@nestjs/common");
var ai_service_js_1 = require("./ai.service.js");
var ai_controller_js_1 = require("./ai.controller.js");
var tools_1 = require("@langchain/core/tools");
var zod_1 = require("zod");
var user_service_js_1 = require("./user.service.js");
var config_1 = require("@nestjs/config");
var openai_1 = require("@langchain/openai");
// import { UsersModule } from '../users/users.module.js';
// import { ToolModule } from '../tool/tool.module.js';
var AiModule = /** @class */ (function () {
    function AiModule() {
    }
    AiModule = __decorate([
        common_1.Module({
            // imports: [UsersModule, ToolModule],
            controllers: [ai_controller_js_1.AiController],
            providers: [
                ai_service_js_1.AiService,
                user_service_js_1.UserService,
                {
                    provide: 'CHAT_MODEL',
                    useFactory: function (config) { return new openai_1.ChatOpenAI({
                        model: config.get('MODEL_NAME'),
                        apiKey: config.get('API_KEY'),
                        temperature: config.get('TEMPERATURE') || 0.7,
                        configuration: {
                            baseURL: config.get('BASE_URL')
                        }
                    }); },
                    inject: [config_1.ConfigService]
                },
                {
                    provide: 'QUERY_USER_TOOL',
                    useFactory: function (userService) {
                        var queryUserArgsSchema = zod_1.z.object({
                            userId: zod_1.z.string().describe('用户 ID，例如: 001, 002, 003')
                        });
                        return tools_1.tool(function (_a) {
                            var userId = _a.userId;
                            return __awaiter(void 0, void 0, void 0, function () {
                                var user, availableIds;
                                return __generator(this, function (_b) {
                                    user = userService.findOne(userId);
                                    if (!user) {
                                        availableIds = userService
                                            .findAll()
                                            .map(function (u) { return u.id; })
                                            .join(', ');
                                        return [2 /*return*/, "\u7528\u6237 ID " + userId + " \u4E0D\u5B58\u5728\u3002\u53EF\u7528\u7684 ID: " + availableIds];
                                    }
                                    return [2 /*return*/, "\u7528\u6237\u4FE1\u606F\uFF1A\n- ID: " + user.id + "\n- \u59D3\u540D: " + user.name + "\n- \u90AE\u7BB1: " + user.email + "\n- \u89D2\u8272: " + user.role];
                                });
                            });
                        }, {
                            name: 'query_user',
                            description: '查询数据库中的用户信息。输入用户 ID，返回该用户的详细信息（姓名、邮箱、角色）。',
                            schema: queryUserArgsSchema
                        });
                    },
                    inject: [user_service_js_1.UserService]
                },
            ]
        })
    ], AiModule);
    return AiModule;
}());
exports.AiModule = AiModule;
