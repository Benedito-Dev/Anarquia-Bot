"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.data = void 0;
exports.execute = execute;
const discord_js_1 = require("discord.js");
const db_1 = __importDefault(require("../database/db"));
const semana_1 = require("../utils/semana");
exports.data = new discord_js_1.SlashCommandBuilder()
    .setName("caixa")
    .setDescription("Caixa da familia")
    .addSubcommand((sub) => sub.setName("ver").setDescription("Ver saldo e movimentacoes do caixa"))
    .addSubcommand((sub) => sub
    .setName("sacar")
    .setDescription("Retirar do caixa (admin)")
    .addIntegerOption((opt) => opt
    .setName("valor")
    .setDescription("Valor a retirar")
    .setRequired(true)
    .setMinValue(1))
    .addStringOption((opt) => opt
    .setName("motivo")
    .setDescription("Motivo da retirada")
    .setRequired(true)))
    .addSubcommand((sub) => sub
    .setName("depositar")
    .setDescription("Depositar no caixa (admin)")
    .addIntegerOption((opt) => opt
    .setName("valor")
    .setDescription("Valor a depositar")
    .setRequired(true)
    .setMinValue(1))
    .addStringOption((opt) => opt
    .setName("motivo")
    .setDescription("Motivo do deposito")
    .setRequired(true)));
async function execute(interaction) {
    const subcommand = interaction.options.getSubcommand();
    if (subcommand === "ver") {
        await ver(interaction);
    }
    else if (subcommand === "sacar") {
        await sacar(interaction);
    }
    else if (subcommand === "depositar") {
        await depositar(interaction);
    }
}
async function ver(interaction) {
    const caixa = db_1.default.prepare("SELECT saldo FROM caixa LIMIT 1").get();
    const totalVendas = db_1.default
        .prepare("SELECT COALESCE(SUM(valor_familia), 0) as total, COUNT(*) as qtd FROM vendas")
        .get();
    const totalSaques = db_1.default
        .prepare("SELECT COALESCE(SUM(ABS(valor)), 0) as total FROM caixa_log WHERE tipo = 'saque'")
        .get();
    const totalDepositos = db_1.default
        .prepare("SELECT COALESCE(SUM(valor), 0) as total FROM caixa_log WHERE tipo = 'deposito'")
        .get();
    // Ultimas movimentacoes
    const logs = db_1.default
        .prepare("SELECT tipo, valor, descricao, criado_em FROM caixa_log ORDER BY id DESC LIMIT 5")
        .all();
    let movimentacoes = "";
    if (logs.length > 0) {
        for (const log of logs) {
            const emoji = log.tipo === "venda" ? "📈" : log.tipo === "saque" ? "📤" : "📥";
            const sinal = log.valor > 0 ? "+" : "";
            movimentacoes += `${emoji} ${sinal}$${log.valor.toLocaleString()} — ${log.descricao ?? log.tipo} (${log.criado_em})\n`;
        }
    }
    else {
        movimentacoes = "Nenhuma movimentacao ainda.";
    }
    const embed = new discord_js_1.EmbedBuilder()
        .setColor(caixa.saldo > 0 ? 0x2ecc71 : 0xe74c3c)
        .setTitle("Caixa da Familia")
        .addFields({ name: "💰 Saldo atual", value: `**$${caixa.saldo.toLocaleString()}**`, inline: true }, { name: "📈 Total vendas", value: `$${totalVendas.total.toLocaleString()} (${totalVendas.qtd} vendas)`, inline: true }, { name: "\u200b", value: "\u200b", inline: true }, { name: "📥 Depositos", value: `$${totalDepositos.total.toLocaleString()}`, inline: true }, { name: "📤 Saques", value: `$${totalSaques.total.toLocaleString()}`, inline: true }, { name: "\u200b", value: "\u200b", inline: true }, { name: "Ultimas movimentacoes", value: movimentacoes })
        .setTimestamp();
    await interaction.reply({ embeds: [embed] });
}
async function sacar(interaction) {
    const admin = db_1.default
        .prepare("SELECT * FROM membros WHERE discord_id = ?")
        .get(interaction.user.id);
    if (!admin || !semana_1.CARGOS_ADMIN.includes(admin.cargo.toLowerCase())) {
        await interaction.reply({ content: "Apenas **Sublider ou Lider** pode sacar do caixa.", ephemeral: true });
        return;
    }
    const valor = interaction.options.getInteger("valor", true);
    const motivo = interaction.options.getString("motivo", true);
    const caixa = db_1.default.prepare("SELECT saldo FROM caixa LIMIT 1").get();
    if (caixa.saldo < valor) {
        await interaction.reply({
            content: `Saldo insuficiente. Caixa tem $${caixa.saldo.toLocaleString()}, tentou sacar $${valor.toLocaleString()}.`,
            ephemeral: true,
        });
        return;
    }
    db_1.default.transaction(() => {
        db_1.default.prepare("UPDATE caixa SET saldo = saldo - ?").run(valor);
        db_1.default.prepare("INSERT INTO caixa_log (tipo, valor, descricao, membro_discord_id) VALUES (?, ?, ?, ?)").run("saque", -valor, motivo, interaction.user.id);
    })();
    const embed = new discord_js_1.EmbedBuilder()
        .setColor(0xe74c3c)
        .setTitle("Saque Realizado")
        .addFields({ name: "Valor", value: `$${valor.toLocaleString()}`, inline: true }, { name: "Motivo", value: motivo, inline: true }, { name: "Novo saldo", value: `$${(caixa.saldo - valor).toLocaleString()}`, inline: true })
        .setFooter({ text: `Por ${admin.nome}` })
        .setTimestamp();
    await interaction.reply({ embeds: [embed] });
}
async function depositar(interaction) {
    const admin = db_1.default
        .prepare("SELECT * FROM membros WHERE discord_id = ?")
        .get(interaction.user.id);
    if (!admin || !semana_1.CARGOS_ADMIN.includes(admin.cargo.toLowerCase())) {
        await interaction.reply({ content: "Apenas **Sublider ou Lider** pode depositar no caixa.", ephemeral: true });
        return;
    }
    const valor = interaction.options.getInteger("valor", true);
    const motivo = interaction.options.getString("motivo", true);
    const caixa = db_1.default.prepare("SELECT saldo FROM caixa LIMIT 1").get();
    db_1.default.transaction(() => {
        db_1.default.prepare("UPDATE caixa SET saldo = saldo + ?").run(valor);
        db_1.default.prepare("INSERT INTO caixa_log (tipo, valor, descricao, membro_discord_id) VALUES (?, ?, ?, ?)").run("deposito", valor, motivo, interaction.user.id);
    })();
    const embed = new discord_js_1.EmbedBuilder()
        .setColor(0x2ecc71)
        .setTitle("Deposito Realizado")
        .addFields({ name: "Valor", value: `$${valor.toLocaleString()}`, inline: true }, { name: "Motivo", value: motivo, inline: true }, { name: "Novo saldo", value: `$${(caixa.saldo + valor).toLocaleString()}`, inline: true })
        .setFooter({ text: `Por ${admin.nome}` })
        .setTimestamp();
    await interaction.reply({ embeds: [embed] });
}
