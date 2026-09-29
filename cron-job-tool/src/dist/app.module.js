"use strict";
var __decorate = (this && this.__decorate) || function (decorators, target, key, desc) {
    var c = arguments.length, r = c < 3 ? target : desc === null ? desc = Object.getOwnPropertyDescriptor(target, key) : desc, d;
    if (typeof Reflect === "object" && typeof Reflect.decorate === "function") r = Reflect.decorate(decorators, target, key, desc);
    else for (var i = decorators.length - 1; i >= 0; i--) if (d = decorators[i]) r = (c < 3 ? d(r) : c > 3 ? d(target, key, r) : d(target, key)) || r;
    return c > 3 && r && Object.defineProperty(target, key, r), r;
};
exports.__esModule = true;
exports.AppModule = void 0;
var common_1 = require("@nestjs/common");
var config_1 = require("@nestjs/config");
var mailer_1 = require("@nestjs-modules/mailer");
var app_controller_js_1 = require("./app.controller.js");
var app_service_js_1 = require("./app.service.js");
var ai_module_js_1 = require("./ai/ai.module.js");
var AppModule = /** @class */ (function () {
    function AppModule() {
    }
    AppModule = __decorate([
        common_1.Module({
            imports: [
                ai_module_js_1.AiModule,
                config_1.ConfigModule.forRoot({
                    isGlobal: true,
                    envFilePath: '.env'
                }),
                mailer_1.MailerModule.forRootAsync({
                    inject: [config_1.ConfigService],
                    useFactory: function (config) { return ({
                        transport: {
                            host: config.get('MAIL_HOST'),
                            port: config.get('MAIL_PORT'),
                            secure: config.get('MAIL_SECURE') === 'true',
                            auth: {
                                user: config.get('MAIL_USER'),
                                pass: config.get('MAIL_PASSWORD')
                            }
                        },
                        defaults: {
                            from: config.get('MAIL_FROM')
                        }
                    }); },
                    imports: [config_1.ConfigModule]
                }),
            ],
            controllers: [app_controller_js_1.AppController],
            providers: [app_service_js_1.AppService]
        })
    ], AppModule);
    return AppModule;
}());
exports.AppModule = AppModule;
