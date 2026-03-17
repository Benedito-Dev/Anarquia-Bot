"use strict";
var __createBinding = (this && this.__createBinding) || (Object.create ? (function(o, m, k, k2) {
    if (k2 === undefined) k2 = k;
    var desc = Object.getOwnPropertyDescriptor(m, k);
    if (!desc || ("get" in desc ? !m.__esModule : desc.writable || desc.configurable)) {
      desc = { enumerable: true, get: function() { return m[k]; } };
    }
    Object.defineProperty(o, k2, desc);
}) : (function(o, m, k, k2) {
    if (k2 === undefined) k2 = k;
    o[k2] = m[k];
}));
var __setModuleDefault = (this && this.__setModuleDefault) || (Object.create ? (function(o, v) {
    Object.defineProperty(o, "default", { enumerable: true, value: v });
}) : function(o, v) {
    o["default"] = v;
});
var __importStar = (this && this.__importStar) || (function () {
    var ownKeys = function(o) {
        ownKeys = Object.getOwnPropertyNames || function (o) {
            var ar = [];
            for (var k in o) if (Object.prototype.hasOwnProperty.call(o, k)) ar[ar.length] = k;
            return ar;
        };
        return ownKeys(o);
    };
    return function (mod) {
        if (mod && mod.__esModule) return mod;
        var result = {};
        if (mod != null) for (var k = ownKeys(mod), i = 0; i < k.length; i++) if (k[i] !== "default") __createBinding(result, mod, k[i]);
        __setModuleDefault(result, mod);
        return result;
    };
})();
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
const discord_js_1 = require("discord.js");
const dotenv_1 = __importDefault(require("dotenv"));
const db_1 = require("./database/db");
const farmCommand = __importStar(require("./commands/farm"));
const estoqueCommand = __importStar(require("./commands/estoque"));
const membroCommand = __importStar(require("./commands/membro"));
const vendaCommand = __importStar(require("./commands/venda"));
const caixaCommand = __importStar(require("./commands/caixa"));
dotenv_1.default.config();
const TOKEN = process.env.DISCORD_TOKEN;
const GUILD_ID = process.env.GUILD_ID;
if (!TOKEN) {
    console.error("DISCORD_TOKEN nao encontrado no .env");
    process.exit(1);
}
if (!GUILD_ID) {
    console.error("GUILD_ID nao encontrado no .env");
    process.exit(1);
}
(0, db_1.initDatabase)();
console.log("Banco de dados inicializado.");
const commands = [farmCommand, estoqueCommand, membroCommand, vendaCommand, caixaCommand];
const commandMap = new discord_js_1.Collection();
for (const cmd of commands) {
    commandMap.set(cmd.data.name, cmd);
}
async function registerCommands() {
    const rest = new discord_js_1.REST({ version: "10" }).setToken(TOKEN);
    try {
        console.log("Registrando slash commands...");
        const clientId = Buffer.from(TOKEN.split(".")[0], "base64").toString();
        await rest.put(discord_js_1.Routes.applicationGuildCommands(clientId, GUILD_ID), {
            body: commands.map((cmd) => cmd.data.toJSON()),
        });
        console.log(`${commands.length} slash commands registrados!`);
    }
    catch (error) {
        console.error("Erro ao registrar commands:", error);
    }
}
const client = new discord_js_1.Client({
    intents: [
        discord_js_1.GatewayIntentBits.Guilds,
        discord_js_1.GatewayIntentBits.GuildMembers,
        discord_js_1.GatewayIntentBits.GuildMessages,
    ],
});
let botReady = false;
client.once("ready", () => {
    console.log(`Bot online como ${client.user?.tag}`);
    botReady = true;
});
client.on("interactionCreate", async (interaction) => {
    if (!interaction.isChatInputCommand())
        return;
    if (!botReady)
        return;
    const command = commandMap.get(interaction.commandName);
    if (!command)
        return;
    try {
        await command.execute(interaction);
    }
    catch (error) {
        console.error(`Erro no comando ${interaction.commandName}:`, error);
        try {
            const msg = { content: "Ocorreu um erro ao executar este comando." };
            if (interaction.replied || interaction.deferred) {
                await interaction.followUp({ ...msg, ephemeral: true });
            }
            else {
                await interaction.reply({ ...msg, ephemeral: true });
            }
        }
        catch {
            // Ignora
        }
    }
});
registerCommands().then(() => {
    client.login(TOKEN);
});
